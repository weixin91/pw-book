# Android Autofill 解锁后返回原 App 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Android Autofill 「解锁 Password Book」 路径,使指纹 / 主密码解锁直接在原 App 之上完成,不再跳转到 Password Book 主界面。

**Architecture:** 新增独立的 `AutofillUnlockActivity`(透明 + 不绘制 UI),作为 Autofill 框架 `setAuthentication` PendingIntent 的目标;只承载 BiometricPrompt 或主密码 AlertDialog,解锁后 `setResult(RESULT_OK) + finish()` 让焦点回到原 App。`PwBookAutofillService.buildUnlockResponse` 从指向 `MainActivity` 的 launcher Intent 改为指向新 Activity。

**Tech Stack:** Kotlin 2.1,Android FragmentActivity,Hilt,BiometricPrompt(`androidx.biometric`),AlertDialog,Android Autofill Framework。

参考 spec:`docs/superpowers/specs/2026-05-16-android-autofill-unlock-return-design.md`

---

## File Structure

文件改动总览:

- **新建** `apps/android/app/src/main/java/com/pwbook/service/autofill/AutofillUnlockActivity.kt`
- **修改** `apps/android/app/src/main/res/values/themes.xml` — 追加 `Theme.Transparent.Autofill` 子主题
- **修改** `apps/android/app/src/main/AndroidManifest.xml` — 注册新 Activity
- **修改** `apps/android/app/src/main/java/com/pwbook/service/autofill/PwBookAutofillService.kt` — `buildUnlockResponse` 指向新 Activity

不涉及:`packages/shared-types/` / 后端 / Edge 扩展 / Prisma schema / 测试代码。

**测试策略**(沿用 spec 决策):新 Activity 是粘合层,核心逻辑(`BiometricUnlockManager.authenticateAndUnlock` / `UnlockVaultUseCase.unlock` / `VaultSession.unlock`)已有覆盖。本计划不写 Robolectric / Instrumentation 单元测试,改为 Task 5 的人工验收清单。每个改动 Task 用 `./gradlew :app:assembleDebug` 验证编译。

---

## Task 1: 追加 `Theme.Transparent.Autofill` 子主题

**Files:**
- Modify: `apps/android/app/src/main/res/values/themes.xml`

**目标**:为新 Activity 提供完全透明 + 无切换动画的窗口主题,且**不**修改 `Theme.Transparent` 本身(避免影响 `CredentialProviderUnlockActivity`)。

- [ ] **Step 1: 在 `Theme.Transparent` 之后追加新子主题**

修改 `apps/android/app/src/main/res/values/themes.xml`,在 `</resources>` 之前插入:

```xml
    <style name="Theme.Transparent.Autofill" parent="Theme.Transparent">
        <item name="android:windowAnimationStyle">@null</item>
    </style>
```

修改后整个 `themes.xml` 应该是:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.PwBook" parent="android:Theme.Material.Light.NoActionBar" />

    <style name="Theme.Transparent" parent="android:Theme.Material.Light.NoActionBar">
        <item name="android:windowIsTranslucent">true</item>
        <item name="android:windowBackground">@android:color/transparent</item>
        <item name="android:windowContentOverlay">@null</item>
        <item name="android:windowNoTitle">true</item>
        <item name="android:windowIsFloating">false</item>
        <item name="android:backgroundDimEnabled">false</item>
    </style>

    <style name="Theme.Transparent.Autofill" parent="Theme.Transparent">
        <item name="android:windowAnimationStyle">@null</item>
    </style>
</resources>
```

- [ ] **Step 2: 验证资源能编译**

Run(在仓库根):
```bash
cd apps/android && ./gradlew :app:processDebugResources
```

Expected:`BUILD SUCCESSFUL`,无 `error: resource style/Theme.Transparent not found` 之类报错。

- [ ] **Step 3: Commit**

```bash
git add apps/android/app/src/main/res/values/themes.xml
git commit -m "feat(android): 添加 Theme.Transparent.Autofill 子主题"
```

---

## Task 2: 创建 `AutofillUnlockActivity`

**Files:**
- Create: `apps/android/app/src/main/java/com/pwbook/service/autofill/AutofillUnlockActivity.kt`

**目标**:完整实现 Autofill 场景的解锁 Activity。模式参照 `CredentialProviderUnlockActivity.kt:23-107`,关键差异:不调用 `recordUserVerification()`(非 WebAuthn UV 场景),不触发同步。

- [ ] **Step 1: 创建 Activity 文件,写完整代码**

新建 `apps/android/app/src/main/java/com/pwbook/service/autofill/AutofillUnlockActivity.kt`,完整内容:

```kotlin
package com.pwbook.service.autofill

import android.app.AlertDialog
import android.os.Bundle
import android.widget.EditText
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.pwbook.data.datasource.BiometricUnlockManager
import com.pwbook.domain.VaultSession
import com.pwbook.domain.usecase.UnlockVaultUseCase
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Autofill 场景下的保险库解锁 Activity。
 *
 * 透明 Activity；不绘制任何 UI,只承载 BiometricPrompt 与 主密码 AlertDialog。
 * 解锁成功后 setResult(RESULT_OK)+finish(),焦点回到触发 Autofill 的原 App;
 * Autofill 框架收到 RESULT_OK 但 result intent 不含 EXTRA_AUTHENTICATION_RESULT,
 * 不主动填充,由用户重新点字段触发新一轮 onFillRequest(此时已解锁,返回真正的候选)。
 */
@AndroidEntryPoint
class AutofillUnlockActivity : FragmentActivity() {

    @Inject lateinit var biometricUnlockManager: BiometricUnlockManager
    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var unlockVaultUseCase: UnlockVaultUseCase

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 故意不调用 setContent / setContentView:保持窗口透明,只浮系统弹窗。

        if (vaultSession.isUnlocked.value) {
            setResult(RESULT_OK)
            finish()
            return
        }

        if (biometricUnlockManager.canAuthenticate() &&
            biometricUnlockManager.isBiometricEnabled()
        ) {
            lifecycleScope.launch {
                val result = biometricUnlockManager.authenticateAndUnlock(
                    this@AutofillUnlockActivity
                )
                result.fold(
                    onSuccess = {
                        // authenticateAndUnlock 内部已调用 VaultSession.unlock
                        setResult(RESULT_OK)
                        finish()
                    },
                    onFailure = { e ->
                        Timber.w(e, "Biometric unlock failed, falling back to password")
                        showPasswordDialog()
                    }
                )
            }
        } else {
            showPasswordDialog()
        }
    }

    private fun showPasswordDialog() {
        val editText = EditText(this).apply {
            hint = "主密码"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }

        AlertDialog.Builder(this)
            .setTitle("解锁保险库")
            .setMessage("请输入主密码以填充凭据")
            .setView(editText)
            .setCancelable(false)
            .setPositiveButton("解锁") { _, _ ->
                val password = editText.text.toString()
                if (password.isEmpty()) {
                    setResult(RESULT_CANCELED)
                    finish()
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    val result = unlockVaultUseCase.unlock(password)
                    result.fold(
                        onSuccess = { userKey ->
                            vaultSession.unlock(userKey)
                            setResult(RESULT_OK)
                            finish()
                        },
                        onFailure = { e ->
                            Timber.e(e, "Password unlock failed")
                            setResult(RESULT_CANCELED)
                            finish()
                        }
                    )
                }
            }
            .setNegativeButton("取消") { _, _ ->
                setResult(RESULT_CANCELED)
                finish()
            }
            .setOnCancelListener {
                setResult(RESULT_CANCELED)
                finish()
            }
            .show()
    }
}
```

- [ ] **Step 2: 编译验证(预期会失败,因为 Manifest 还未注册)**

Run:
```bash
cd apps/android && ./gradlew :app:assembleDebug
```

Expected:`BUILD SUCCESSFUL`(Kotlin 编译通过即可;Manifest 检查在 manifest merger 阶段,缺注册不会阻塞 assembleDebug,但运行时会找不到 Activity)。如果出现 `Unresolved reference: …` 或 `BiometricUnlockManager` 注入相关编译错误,检查 import 与依赖是否拼对(参考 `CredentialProviderUnlockActivity.kt:8-12`)。

- [ ] **Step 3: Commit**

```bash
git add apps/android/app/src/main/java/com/pwbook/service/autofill/AutofillUnlockActivity.kt
git commit -m "feat(android): 新增 AutofillUnlockActivity 处理自动填充解锁"
```

---

## Task 3: AndroidManifest 注册 `AutofillUnlockActivity`

**Files:**
- Modify: `apps/android/app/src/main/AndroidManifest.xml`

**目标**:把新 Activity 注册到 manifest,设置主题为 `Theme.Transparent.Autofill`。

- [ ] **Step 1: 在 `CredentialProviderUnlockActivity` 声明之后追加新 Activity**

在 `apps/android/app/src/main/AndroidManifest.xml` 中,找到这一行:

```xml
        <activity
            android:name=".service.credential.CredentialProviderUnlockActivity"
            android:exported="false"
            android:excludeFromRecents="true"
            android:theme="@style/Theme.Transparent" />
```

在它的紧后方,`<provider` 之前插入:

```xml
        <activity
            android:name=".service.autofill.AutofillUnlockActivity"
            android:exported="false"
            android:excludeFromRecents="true"
            android:theme="@style/Theme.Transparent.Autofill" />
```

- [ ] **Step 2: 编译并合并 manifest**

Run:
```bash
cd apps/android && ./gradlew :app:processDebugManifest
```

Expected:`BUILD SUCCESSFUL`。检查 `app/build/intermediates/merged_manifest/debug/AndroidManifest.xml`(如存在)包含 `AutofillUnlockActivity` 节点。

- [ ] **Step 3: 完整 debug 构建**

Run:
```bash
cd apps/android && ./gradlew :app:assembleDebug
```

Expected:`BUILD SUCCESSFUL`。

- [ ] **Step 4: Commit**

```bash
git add apps/android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): 注册 AutofillUnlockActivity 到 manifest"
```

---

## Task 4: 修改 `PwBookAutofillService.buildUnlockResponse` 指向新 Activity

**Files:**
- Modify: `apps/android/app/src/main/java/com/pwbook/service/autofill/PwBookAutofillService.kt:223-267`

**目标**:把 `buildUnlockResponse` 内的 PendingIntent 从指向 launcher Intent(走 MainActivity)改为指向 `AutofillUnlockActivity`,并删除不再需要的 SharedPreferences 写入与 requestId 生成。

- [ ] **Step 1: 替换 `buildUnlockResponse` 整个方法体**

打开 `apps/android/app/src/main/java/com/pwbook/service/autofill/PwBookAutofillService.kt`,找到 `private fun buildUnlockResponse(parsed: ParsedStructure): FillResponse?` 方法(约 line 223-267),把整个方法体替换为:

```kotlin
    private fun buildUnlockResponse(parsed: ParsedStructure): FillResponse? {
        if (parsed.usernameId == null && parsed.passwordId == null) return null

        val intent = android.content.Intent(this, AutofillUnlockActivity::class.java)

        val pendingIntent = android.app.PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )

        val remoteViews = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, "解锁 Password Book")
        }

        val datasetBuilder = Dataset.Builder(remoteViews)
            .setAuthentication(pendingIntent.intentSender)

        // 必须至少设置一个 field,否则 build() 会抛 IllegalStateException
        parsed.usernameId?.let { id ->
            datasetBuilder.setValue(id, AutofillValue.forText(""))
        }
        parsed.passwordId?.let { id ->
            datasetBuilder.setValue(id, AutofillValue.forText(""))
        }

        return FillResponse.Builder()
            .addDataset(datasetBuilder.build())
            .build()
    }
```

与原版相比的删除项(对照确认):

- 删除 `val requestId = UUID.randomUUID().toString()`
- 删除 `getSharedPreferences("pwbook_autofill", Context.MODE_PRIVATE).edit().putString("last_autofill_request_id", requestId).apply()` 整段。
- 删除 `packageManager.getLaunchIntentForPackage(packageName)?.addFlags(...)?.apply { putExtra("autofill_mode", "unlock"); putExtra("autofill_uri", parsed.uriString); putExtra("autofill_request_id", requestId) } ?: return null` 整段,改用 `Intent(this, AutofillUnlockActivity::class.java)`。
- 不再需要 `FLAG_ACTIVITY_NEW_TASK`:PendingIntent 作为 authentication 由 Autofill 框架在 transient task 中拉起。

- [ ] **Step 2: 移除未使用的 `UUID` import**

在该文件顶部 import 区域(约 line 33)找到:

```kotlin
import java.util.UUID
```

删除该行。`UUID` 在此文件其它位置无使用(已确认整个文件仅 `buildUnlockResponse` 用到)。

> 若 Kotlin 编译时仍报"unused import"或保留 import 不报错都可接受;真正的判据是构建通过。

- [ ] **Step 3: 编译验证**

Run:
```bash
cd apps/android && ./gradlew :app:assembleDebug
```

Expected:`BUILD SUCCESSFUL`,无 unresolved reference / 未使用 import 错误。

- [ ] **Step 4: 跑现有单元测试,确保未破坏其他逻辑**

Run:
```bash
cd apps/android && ./gradlew :app:testDebugUnitTest
```

Expected:`BUILD SUCCESSFUL`。若 `PwBookAutofillServiceTest`(若存在)对 PendingIntent 内部细节做了断言,可能失败;此时需要更新断言到 `AutofillUnlockActivity::class.java`。若无相关测试,本步即纯回归保护。

- [ ] **Step 5: Commit**

```bash
git add apps/android/app/src/main/java/com/pwbook/service/autofill/PwBookAutofillService.kt
git commit -m "fix(android): 自动填充解锁指向独立 AutofillUnlockActivity,解锁后焦点回原 App"
```

---

## Task 5: 手动验收(必须在物理设备 / 模拟器上执行)

**Files:** 无代码改动;只做验收。

**前置**:已安装本次构建的 debug APK(`apps/android/app/build/outputs/apk/debug/app-debug.apk`),保险库**已注册并锁定**(从主 App 锁定一次,或重启进程让 `VaultSession.isUnlocked` 为 false)。建议至少在一台启用了指纹的真机上验证视觉效果。

- [ ] **Step 1: 安装 debug APK**

Run(USB 调试已连接):
```bash
cd apps/android && ./gradlew :app:installDebug
```

Expected:`BUILD SUCCESSFUL`,设备上 Password Book 已更新。确认在 Android 设置中 Password Book 仍是默认 Autofill 服务。

- [ ] **Step 2: 场景 A — 生物识别解锁,视觉无感**

操作:

1. 锁屏后重新解锁,确保 Password Book 保险库处于锁定态。
2. 打开 Chrome,访问任意带登录表单的页面(例如 `https://login.live.com`)。
3. 聚焦用户名或密码输入框,触发 Autofill IME。
4. 点击「解锁 Password Book」。

验证:

- [ ] 系统指纹弹窗直接浮在 Chrome 页面之上,**过程中不出现 Password Book 主界面、解锁界面或闪屏**。
- [ ] 完成指纹验证后,弹窗消失,焦点立刻回到 Chrome。
- [ ] 切到「最近任务」列表,确认 Password Book 不在最近任务中。
- [ ] 在 Chrome 内重新点同一输入框,IME 上方应展示真正的候选 dataset(已解锁)。

- [ ] **Step 3: 场景 B — 取消生物识别后用主密码解锁**

操作:重复 Step 2 第 1-4 步,但在指纹弹窗出现时按返回 / 取消。

验证:

- [ ] 弹出主密码 AlertDialog(浮在 Chrome 之上,无 Password Book 主界面)。
- [ ] 输入正确主密码 → 「解锁」→ AlertDialog 关闭,焦点回 Chrome。
- [ ] 重新点字段,IME 展示真实候选 dataset。

- [ ] **Step 4: 场景 C — 主密码错误**

操作:重复 Step 2,在主密码 AlertDialog 中输入错误密码,点「解锁」。

验证:

- [ ] AlertDialog 关闭,Activity 退出,焦点回到 Chrome。
- [ ] Chrome 表单字段未被填充。
- [ ] 再次点击 Autofill,「解锁 Password Book」仍出现(状态仍是锁定)。

- [ ] **Step 5: 场景 D — 用户取消 AlertDialog**

操作:重复 Step 2 进入主密码 AlertDialog,点「取消」。

验证:

- [ ] AlertDialog 关闭,焦点回 Chrome,字段未填充。

- [ ] **Step 6: 场景 E — 主入口不受影响**

操作:从桌面点击 Password Book 图标启动主 App。

验证:

- [ ] 启动后正常显示登录 / 解锁 / VaultList 等主流程,无任何 autofill 相关界面残留。
- [ ] 解锁后 VaultList 行为正常。

- [ ] **Step 7: 场景 F — 已解锁状态下的 Autofill 路径未受影响**

操作:保险库已解锁,在 Chrome 表单字段触发 Autofill。

验证:

- [ ] IME 直接展示候选 dataset 与「打开密码库」选项(不出现「解锁 Password Book」)。
- [ ] 选择某条 dataset 能正常填入用户名 / 密码。
- [ ] 「打开密码库」(select 路径)行为与改动前一致 — 本次未变更,只需确认未破坏。

- [ ] **Step 8: 验收结论**

- 全部场景通过 → 提交后可发版。
- 若任一场景失败:回到对应 Task,定位代码层级,**不**用 `--no-verify` 绕过 hook,**不**做 destructive 操作;修复后重新 Commit。

本 Task 不产生 commit。

---

## Self-Review 备忘(给 Plan 作者复盘用)

执行者无需阅读以下内容。这是 plan 写完后的自审记录:

- **Spec 覆盖**:spec 的 5 个「关键改动」对应 Task 1-4;spec 的「测试 / 验收」对应 Task 5;spec 的「错误处理」表对应 Task 2 内 Activity 代码中的 fold 分支;spec 的「不在本次范围」全部排除在外。
- **类型一致**:`vaultSession.isUnlocked.value: Boolean`、`biometricUnlockManager.authenticateAndUnlock(activity): Result<Unit>`、`unlockVaultUseCase.unlock(password): Result<ByteArray>`、`vaultSession.unlock(key: ByteArray)`,均与 spec 中签名一致(已在 `BiometricUnlockManager.kt`、`VaultSession.kt`、`UnlockVaultUseCase.kt` 中验证)。
- **占位符扫描**:无 TBD / TODO / "appropriate error handling"。所有代码块均完整可拷贝。
