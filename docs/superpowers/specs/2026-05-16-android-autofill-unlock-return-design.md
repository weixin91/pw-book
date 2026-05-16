# Android 自动填充：解锁后返回原 App

**日期**：2026-05-16
**作用域**：`apps/android/`，仅修复 Autofill 服务下的「解锁 Password Book」路径

## 问题

Android Autofill 触发时，若 Password Book 保险库处于锁定状态，`PwBookAutofillService.onFillRequest` 会返回一个带 `setAuthentication(PendingIntent)` 的 `FillResponse`，让系统在用户点击「解锁 Password Book」时拉起本 App 的解锁界面。

当前实现（`PwBookAutofillService.kt:223-267`）把 `PendingIntent` 指向 `packageManager.getLaunchIntentForPackage(packageName)`，也就是把 `MainActivity` 当作普通启动入口拉起。`MainActivity` 解锁成功后通过 `AppNavHost` 跳转到 `VaultList`，并不会 `setResult` / `finish`，结果是：

- 解锁后焦点仍停留在 Password Book，原 App 被推到后台；
- 用户必须手动切回原 App，再次点输入框才能看到候选凭据。

期望体验：

- 点击「解锁 Password Book」后，**视觉上直接在原 App 上弹出系统指纹/人脸识别弹窗**，不出现 Password Book 的任何界面。
- 解锁完成后焦点立刻回到原 App。
- 仅当生物识别不可用或失败回退时，才在原 App 之上叠一个轻量主密码 AlertDialog（无法避免的可见 UI）。

## 设计

### 总体方案

新增独立的 `AutofillUnlockActivity`（位于 `com.pwbook.service.autofill` 包），作为 Autofill 场景的解锁入口。它与现有的 `CredentialProviderUnlockActivity` 是平行对位的两个 Activity，分别承担 `AutofillService` 与 `CredentialProviderService` 两条系统服务的解锁回流；两者不复用代码，但行为模式相同。

`PwBookAutofillService.buildUnlockResponse` 把 `PendingIntent` 改为指向 `AutofillUnlockActivity`，不再走 `MainActivity` 的 launcher Intent。`MainActivity` / `AppNavHost` 中现存的 `autofill_mode=unlock` 处理代码保留为遗留死路径，本次范围限定不做清理。

### 关键改动

#### 1. 新增 `AutofillUnlockActivity`

文件：`apps/android/app/src/main/java/com/pwbook/service/autofill/AutofillUnlockActivity.kt`

模板参照 `CredentialProviderUnlockActivity.kt:23-107`，整体结构：

- `@AndroidEntryPoint` + `FragmentActivity`
- 依赖注入：`BiometricUnlockManager` / `VaultSession` / `UnlockVaultUseCase`
- **窗口策略（视觉关键）**：
  - 使用 `Theme.Transparent.Autofill`（见 §3），保持窗口完全透明、不绘制任何内容、无 Activity 切换动画。
  - `onCreate` **不调用 `setContent` / `setContentView`**，让本 Activity 仅作为 BiometricPrompt 与 AlertDialog 的宿主，背景始终是触发 Autofill 的原 App 窗口。
- `onCreate`：
  - 已解锁（`vaultSession.isUnlocked.value == true`）→ `setResult(RESULT_OK) + finish()` 直接返回。
  - 生物识别可用且启用（`canAuthenticate() && isBiometricEnabled()`）→ 调用 `biometricUnlockManager.authenticateAndUnlock(this)`：
    - 成功 → `setResult(RESULT_OK) + finish()`（`authenticateAndUnlock` 内部已调用 `VaultSession.unlock`）。
    - 失败/取消 → 回退到主密码 AlertDialog。
  - 否则直接进入主密码 AlertDialog。
- 主密码 AlertDialog：
  - `EditText`（`inputType = TYPE_CLASS_TEXT or TYPE_TEXT_VARIATION_PASSWORD`）
  - 「解锁」按钮：成功 → `vaultSession.unlock(userKey) + setResult(RESULT_OK) + finish()`；失败 → `setResult(RESULT_CANCELED) + finish()`。
  - 「取消」按钮 / 遮罩取消 → `setResult(RESULT_CANCELED) + finish()`。
  - `setCancelable(false)` 与 `CredentialProviderUnlockActivity` 一致，避免误关。

刻意排除：
- **不**调用 `syncManager.launchFullSync()`。Autofill 触发非常频繁，每次解锁都拉全量同步代价过高；同步由用户主动进入主 App 或 `SyncWorker` 后台触发即可。`CredentialProviderUnlockActivity` 同样未触发同步。
- **不**调用 `vaultSession.recordUserVerification()`，因为这条路径用于普通凭据填充，不属于 WebAuthn UV 场景。

#### 2. 修改 `PwBookAutofillService.buildUnlockResponse`

文件：`apps/android/app/src/main/java/com/pwbook/service/autofill/PwBookAutofillService.kt:223-267`

变更点：

- 删除 `getSharedPreferences("pwbook_autofill", ...).edit().putString("last_autofill_request_id", requestId).apply()`：unlock 路径不需要回写 request id。
- `Intent` 由 `packageManager.getLaunchIntentForPackage(packageName)?.addFlags(FLAG_ACTIVITY_NEW_TASK)?.apply { putExtra(...) }` 改为：
  ```kotlin
  val intent = Intent(this, AutofillUnlockActivity::class.java)
  ```
  不需要 `FLAG_ACTIVITY_NEW_TASK`（PendingIntent 作为 authentication 由 Autofill 框架在 transient task 中拉起）。
- 不再 `putExtra("autofill_mode"|"autofill_uri"|"autofill_request_id", …)`。
- 移除局部变量 `requestId` 与对应的 `UUID.randomUUID().toString()` 调用。
- `PendingIntent.getActivity(...)` 的 flag 维持 `FLAG_UPDATE_CURRENT or FLAG_IMMUTABLE`。
- 其余逻辑（`RemoteViews` 文案 `"解锁 Password Book"`、`datasetBuilder.setValue(usernameId/passwordId, AutofillValue.forText(""))` 占位）保持不变。

#### 3. 新增主题 `Theme.Transparent.Autofill`

文件：`apps/android/app/src/main/res/values/themes.xml`

在 `Theme.Transparent` 之后追加专用子主题，**不修改** `Theme.Transparent` 本身（避免影响 `CredentialProviderUnlockActivity`）：

```xml
<style name="Theme.Transparent.Autofill" parent="Theme.Transparent">
    <item name="android:windowAnimationStyle">@null</item>
</style>
```

- 继承 `Theme.Transparent` 已有的透明 / 无标题 / 无 dim 配置。
- `windowAnimationStyle=@null` 去除 Activity 进出场切换动画，让用户在原 App 上点击「解锁 Password Book」后视觉上没有屏幕跳转，仅看到系统 BiometricPrompt 直接浮现。

#### 4. AndroidManifest 注册新 Activity

文件：`apps/android/app/src/main/AndroidManifest.xml`

紧邻 `CredentialProviderUnlockActivity` 声明后追加：

```xml
<activity
    android:name=".service.autofill.AutofillUnlockActivity"
    android:exported="false"
    android:excludeFromRecents="true"
    android:theme="@style/Theme.Transparent.Autofill" />
```

- `exported=false`：PendingIntent 来自本进程，无需对外暴露。
- `excludeFromRecents=true`：解锁交互不进最近任务列表。
- `Theme.Transparent.Autofill`：透明窗口 + 无切换动画，使 BiometricPrompt / AlertDialog 直接浮在原 App 之上。

#### 5. 不变之处

- `MainActivity` / `AppNavHost` / `UnlockScreen` / `UnlockViewModel` 全部不动。
- 「打开密码库」（`select`）路径不动：该路径目前 `setResult(RESULT_OK)` 时不携带 `EXTRA_AUTHENTICATION_RESULT`，存在另一个填充失败问题，但不在本次范围内。
- Credential Provider / Passkey 流程不动。
- `SaveRequestHandler` 与凭据保存路径不动。

### 数据流

锁定状态下的端到端流程：

```
原 App 字段获焦
   │
   ▼
PwBookAutofillService.onFillRequest
   │  vaultSession.getUserKey() == null
   ▼
buildUnlockResponse → FillResponse(Dataset.setAuthentication(PendingIntent → AutofillUnlockActivity))
   │
   ▼
用户点击「解锁 Password Book」
   │
   ▼
Android 框架在 transient task 中拉起 AutofillUnlockActivity
   │
   ├─ 已解锁  → setResult(RESULT_OK) + finish()
   ├─ 生物识别 → 成功 → setResult(RESULT_OK) + finish()
   │                  失败 → AlertDialog
   └─ AlertDialog → 主密码正确 → setResult(RESULT_OK) + finish()
                  主密码错误/取消 → setResult(RESULT_CANCELED) + finish()
   │
   ▼
Android 框架：result intent 不含 EXTRA_AUTHENTICATION_RESULT
   → 不填充字段
   → 关闭 transient task
   → 焦点回到原 App
   │
   ▼
用户重新点字段（或当前已聚焦字段触发新一轮）
   │
   ▼
onFillRequest 再次执行，此时 vaultSession.getUserKey() != null
   → 返回真正的候选 Dataset 列表
```

关键点：`AutofillUnlockActivity` 是独立 Activity，不挂在 MainActivity 的 NavHost 之下，因此解锁过程中不会出现「密码库主界面闪现 → 跳回原 App」的视觉跳变。

### 错误处理

| 场景 | 处理 |
|------|------|
| `UnlockVaultUseCase.unlock` 抛异常 | `Timber.e` 打印 + `setResult(RESULT_CANCELED) + finish()` |
| `authenticateAndUnlock` 失败但非取消 | `Timber.w` 打印 + 回退到主密码 AlertDialog |
| 用户输错密码 | AlertDialog 关闭 → `setResult(RESULT_CANCELED) + finish()`，由用户重新触发 autofill 重试（轻量交互的取舍） |
| 用户取消 / 关闭对话框 | `setResult(RESULT_CANCELED) + finish()` |
| 已登录但未注册生物识别 | 直接走主密码 AlertDialog |
| 未登录（无 access token） | 本设计不特殊处理；解锁会失败并 `RESULT_CANCELED`，焦点回原 App，用户需进入主 App 完成登录。Autofill 入口不承担登录功能。 |

### 测试 / 验收

**手动验收场景（必须）**：

- A. 保险库锁定状态下，在 Chrome 网页中聚焦 username/password 字段 → 点「解锁 Password Book」→ 走生物识别 → 验证：
  - **视觉上指纹/人脸识别弹窗直接浮在原 Chrome 页面之上，过程中不出现 Password Book 任何界面**；
  - 解锁后焦点立刻回 Chrome，Password Book 不在前台、不在最近任务列表。
- B. 同上，取消生物识别 → 弹主密码 AlertDialog → 输入正确密码 → 焦点回 Chrome。
- C. 同上，输错主密码 → AlertDialog 关闭 → 焦点回 Chrome，字段未填充（符合「轻量」决策）。
- D. 同上，点 AlertDialog 的「取消」→ 焦点回 Chrome，字段未填充。
- E. 用户从桌面图标手动打开主 App → 登录 / 解锁 / 主流程行为不受影响（MainActivity 不再被 autofill 路径污染）。
- F. 保险库已解锁时，autofill 直接展示候选 dataset 与「打开密码库」选项（本次未变更）。
- G. 「打开密码库」（select）路径行为与改动前一致（本次未变更）。

**自动化测试**：

- 不为 `AutofillUnlockActivity` 写 Robolectric / Instrumentation 测试：它是粘合层，核心逻辑（`UnlockVaultUseCase` / `BiometricUnlockManager` / `VaultSession`）已有覆盖。
- 若 `PwBookAutofillServiceTest` 或同类断言对 `buildUnlockResponse` 内部 PendingIntent 目标 class 做了校验，更新到 `AutofillUnlockActivity::class.java`；若无此类断言则无需变动。

### 风险与权衡

- **风险**：用户输错主密码一次就退出 AlertDialog，需要重新点 autofill 触发整个流程。
  **缓解**：符合用户选择的「AlertDialog 轻量」风格；错误率低；后续若反馈差再改为同 AlertDialog 内重试。
- **风险**：`Theme.Transparent` 在不同 Android 版本下 AlertDialog 视觉表现可能略有差异。
  **缓解**：`CredentialProviderUnlockActivity` 已经在生产中使用同一主题，路径成熟。
- **风险（视觉无感不绝对）**：部分 OEM 在 BiometricPrompt 之下叠加深色 dim 层，会盖住背景的原 App；少数设备在透明 Activity 启动瞬间仍可能有 1–2 帧切换动画（即便 `windowAnimationStyle=@null`）。
  **缓解**：绝大多数原生与主流 OEM 设备表现符合预期；OEM 层的渲染差异非我们可控，验收阶段在主力机型上确认即可，不阻塞发布。
- **风险**：生物识别失败回退到主密码 AlertDialog 时，会真实出现 Password Book 风格的对话框，无法做到「完全无感」。
  **缓解**：这是必要的交互（主密码必须输入），仍叠在原 App 之上，且对话框风格轻量；用户选择「AlertDialog 轻量」风格时已默认接受此取舍。
- **取舍**：不复用 `MainActivity` 与 Compose `UnlockScreen`。代码量略增（一个新 Activity ≈ 100 行），但隔离干净，不需要在 NavHost 与 launcher 行为之间塞 autofill 分支。
- **取舍**：unlock 路径不携带 `requestId` / `uri` / `package` 等上下文，所以解锁后不能「顺手填充」。换得的好处是流程极简且与用户「只回焦点不主动填」的诉求一致。

### 不在本次范围

- 「打开密码库」（select）路径的填充缺陷（result intent 缺 `EXTRA_AUTHENTICATION_RESULT`）。
- 「解锁后自动填充第一条 / 选择候选」体验（用户已明确排除）。
- Credential Provider / Passkey 流程。
- access token 过期的特殊引导。
- 任何 UI 组件（`UnlockScreen`、Compose 主题等）的重构。
