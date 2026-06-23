# Android 自动填充误触发优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收紧 `StructureParser` 的字段识别逻辑，减少普通输入框被误判为用户名/密码字段导致的自动填充误触发。

**Architecture:** 在 `StructureParser` 内新增 `FieldDetectionRules` 集中管理信号与否定词，并新增可测试的 `detectFields` 纯函数；`parse()` 与 `extractSaveData()` 复用该函数。上层服务与响应构建器保持不变。

**Tech Stack:** Kotlin, Android SDK (`AssistStructure`, `AutofillId`, `InputType`), JUnit 4, MockK。

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `apps/android/app/src/main/java/com/pwbook/service/autofill/StructureParser.kt` | 新增字段检测规则、可测试的 `detectFields` 函数，重构 `findUsernameField`/`findPasswordField` 以复用规则。 |
| `apps/android/app/src/test/java/com/pwbook/service/autofill/StructureParserTest.kt` | 对 `detectFields` 覆盖搜索框、评论框、标准登录、仅邮箱、弱文本框+密码、边界否定词等场景。 |

---

### Task 1: 编写失败的单元测试

**Files:**
- Create: `apps/android/app/src/test/java/com/pwbook/service/autofill/StructureParserTest.kt`

- [ ] **Step 1.1: 创建测试文件骨架**

```kotlin
package com.pwbook.service.autofill

import android.text.InputType
import android.view.autofill.AutofillId
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class StructureParserTest {

    private fun field(
        autofillHints: List<String> = emptyList(),
        htmlInfo: String? = null,
        htmlAttributes: Map<String, String> = emptyMap(),
        inputType: Int = InputType.TYPE_CLASS_TEXT,
        className: String? = null,
        textValue: String? = null,
        index: Int = 0
    ): AutofillField {
        return AutofillField(
            id = mockk<AutofillId>(relaxed = true),
            autofillHints = autofillHints,
            htmlInfo = htmlInfo,
            htmlAttributes = htmlAttributes,
            inputType = inputType,
            className = className,
            textValue = textValue,
            index = index
        )
    }
}
```

- [ ] **Step 1.2: 添加搜索页不应识别为用户名的测试**

```kotlin
    @Test
    fun `搜索框单独存在时不识别为用户名`() {
        val fields = listOf(
            field(htmlAttributes = mapOf("type" to "text", "id" to "q"), index = 0)
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNull(username)
        assertNull(password)
    }
```

- [ ] **Step 1.3: 添加评论框不应识别的测试**

```kotlin
    @Test
    fun `评论框单独存在时不识别为用户名`() {
        val fields = listOf(
            field(htmlAttributes = mapOf("type" to "text", "id" to "comment"), index = 0)
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNull(username)
        assertNull(password)
    }
```

- [ ] **Step 1.4: 添加标准登录页识别测试**

```kotlin
    @Test
    fun `标准用户名密码登录页正确识别`() {
        val fields = listOf(
            field(
                htmlAttributes = mapOf("type" to "text", "id" to "username"),
                index = 0
            ),
            field(
                htmlAttributes = mapOf("type" to "password", "id" to "password"),
                inputType = InputType.TYPE_TEXT_VARIATION_PASSWORD,
                index = 1
            )
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNotNull(username)
        assertNotNull(password)
        assertEquals("username", username?.htmlAttributes?.get("id"))
        assertEquals("password", password?.htmlAttributes?.get("id"))
    }
```

- [ ] **Step 1.5: 添加仅邮箱字段识别测试**

```kotlin
    @Test
    fun `仅邮箱字段时识别为用户名`() {
        val fields = listOf(
            field(htmlAttributes = mapOf("type" to "email", "id" to "email"), index = 0)
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNotNull(username)
        assertNull(password)
        assertEquals("email", username?.htmlAttributes?.get("id"))
    }
```

- [ ] **Step 1.6: 添加弱文本框+密码回退测试**

```kotlin
    @Test
    fun `无强用户名信号但存在密码时取密码前最近文本框`() {
        val fields = listOf(
            field(
                htmlAttributes = mapOf("type" to "text", "id" to "field1"),
                index = 0
            ),
            field(
                htmlAttributes = mapOf("type" to "password", "id" to "password"),
                inputType = InputType.TYPE_TEXT_VARIATION_PASSWORD,
                index = 1
            )
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNotNull(username)
        assertNotNull(password)
        assertEquals("field1", username?.htmlAttributes?.get("id"))
    }
```

- [ ] **Step 1.7: 添加否定词边界测试**

```kotlin
    @Test
    fun `命中否定词的字段不参与识别`() {
        val fields = listOf(
            field(
                htmlAttributes = mapOf("type" to "text", "id" to "search-user"),
                index = 0
            ),
            field(
                htmlAttributes = mapOf("type" to "password", "id" to "password"),
                inputType = InputType.TYPE_TEXT_VARIATION_PASSWORD,
                index = 1
            )
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNull(username)
        assertNotNull(password)
    }
```

- [ ] **Step 1.8: 运行测试确认失败**

Run:
```bash
cd apps/android
./gradlew :app:testDebugUnitTest --tests "com.pwbook.service.autofill.StructureParserTest"
```

Expected: 编译失败，`detectFields` 未找到。

---

### Task 2: 实现字段检测规则与可测试函数

**Files:**
- Modify: `apps/android/app/src/main/java/com/pwbook/service/autofill/StructureParser.kt`

- [ ] **Step 2.1: 新增 `FieldDetectionRules` 对象**

在 `StructureParser` 中 `ParsedStructure`/`AutofillField` 数据类之后、object 之前插入：

```kotlin
internal object FieldDetectionRules {

    // 命中后字段直接退出用户名/密码候选
    val negativeKeywords: Set<String> = setOf(
        "search", "query", "q", "keyword", "find",
        "chat", "message", "comment", "subject", "title"
    )

    fun isNegative(field: AutofillField): Boolean {
        val haystacks = buildList {
            addAll(field.autofillHints)
            addAll(field.htmlAttributes.values)
        }.map { it.lowercase() }

        return haystacks.any { haystack ->
            negativeKeywords.any { keyword ->
                if (keyword.length == 1) {
                    haystack == keyword
                } else {
                    haystack.contains(keyword)
                }
            }
        }
    }

    fun isStrongUsernameSignal(field: AutofillField): Boolean {
        val hintsLower = field.autofillHints.map { it.lowercase() }
        if (hintsLower.any {
                it.contains("username") ||
                it.contains("email") ||
                it.contains("login") ||
                it.contains("account")
            }) {
            return true
        }
        if (field.htmlAttributes["type"]?.lowercase() == "email") return true
        if ((field.inputType and InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS) != 0 ||
            (field.inputType and InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) != 0
        ) {
            return true
        }
        return false
    }

    fun isPasswordSignal(field: AutofillField): Boolean {
        val hintsLower = field.autofillHints.map { it.lowercase() }
        if (hintsLower.any {
                it.contains("password") ||
                it.contains("pwd") ||
                it.contains("pass")
            }) {
            return true
        }
        if (field.htmlAttributes["type"]?.lowercase() == "password") return true
        if ((field.inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0 ||
            (field.inputType and InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD) != 0 ||
            (field.inputType and InputType.TYPE_NUMBER_VARIATION_PASSWORD) != 0
        ) {
            return true
        }
        return false
    }
}
```

- [ ] **Step 2.2: 新增 `detectFields` 函数**

在 `StructureParser` 中新增以下 `internal` 函数（放在 `parse` 函数附近即可）：

```kotlin
    internal fun detectFields(
        fields: List<AutofillField>
    ): Pair<AutofillField?, AutofillField?> {
        val filtered = fields.filterNot { FieldDetectionRules.isNegative(it) }
        val passwordField = filtered.find { FieldDetectionRules.isPasswordSignal(it) }

        val usernameField = filtered.find { FieldDetectionRules.isStrongUsernameSignal(it) }
            ?: passwordField?.let { pwd ->
                filtered.filter { it.index < pwd.index }
                    .filterNot { FieldDetectionRules.isPasswordSignal(it) }
                    .filter { isTextField(it) }
                    .lastOrNull()
            }

        return usernameField to passwordField
    }
```

- [ ] **Step 2.3: 重构 `findUsernameField` 复用 `detectFields`**

将现有 `findUsernameField` 替换为：

```kotlin
    private fun findUsernameField(fields: List<AutofillField>): AutofillField? {
        return detectFields(fields).first
    }
```

- [ ] **Step 2.4: 重构 `findPasswordField` 复用 `detectFields`**

将现有 `findPasswordField` 替换为：

```kotlin
    private fun findPasswordField(fields: List<AutofillField>): AutofillField? {
        return detectFields(fields).second
    }
```

- [ ] **Step 2.5: 删除旧 `findUsernameField` 和 `findPasswordField` 的冗余实现**

确保原 `findUsernameField` 的长实现和原 `findPasswordField` 的长实现已被替换，只保留对 `detectFields` 的调用。

- [ ] **Step 2.6: 运行测试确认通过**

Run:
```bash
cd apps/android
./gradlew :app:testDebugUnitTest --tests "com.pwbook.service.autofill.StructureParserTest"
```

Expected: 6 个测试全部通过。

---

### Task 3: 在 `parse()` 中增加调试日志（可选但建议）

**Files:**
- Modify: `apps/android/app/src/main/java/com/pwbook/service/autofill/StructureParser.kt`

- [ ] **Step 3.1: 在 `parse()` 中记录被否定词过滤的字段**

在 `parse()` 中，构造完 `fields` 后、`detectFields` 前加入：

```kotlin
        val negativeFields = fields.filter { FieldDetectionRules.isNegative(it) }
        if (negativeFields.isNotEmpty()) {
            android.util.Log.d(
                "StructureParser",
                "Filtered negative fields: ${negativeFields.map { it.htmlAttributes }}"
            )
        }
```

- [ ] **Step 3.2: 运行测试确认未破坏现有行为**

Run:
```bash
cd apps/android
./gradlew :app:testDebugUnitTest --tests "com.pwbook.service.autofill.StructureParserTest"
```

Expected: 全部通过。

---

### Task 4: 运行更广泛的单元测试并检查编译

**Files:**
- 无需修改文件。

- [ ] **Step 4.1: 运行整个 JVM 单元测试套件**

Run:
```bash
cd apps/android
./gradlew :app:testDebugUnitTest
```

Expected: 现有 `UriMatcherTest` 等测试继续通过；`StructureParserTest` 新增 6 个测试通过。

- [ ] **Step 4.2: 确认 Kotlin 代码可编译**

Run:
```bash
cd apps/android
./gradlew :app:compileDebugKotlin
```

Expected: BUILD SUCCESSFUL。

---

### Task 5: 提交实现

- [ ] **Step 5.1: 暂存变更**

```bash
git add apps/android/app/src/main/java/com/pwbook/service/autofill/StructureParser.kt
git add apps/android/app/src/test/java/com/pwbook/service/autofill/StructureParserTest.kt
```

- [ ] **Step 5.2: 提交**

```bash
git commit -m "$(cat <<'EOF'
fix(android): 收紧自动填充字段识别，减少普通输入框误触发

- 新增 FieldDetectionRules 集中管理用户名/密码信号与否定词
- 普通 <input type="text"> 仅在有密码字段时才被识别为用户名
- 搜索/聊天/评论等否定关键词字段不再参与识别
- 新增 StructureParserTest 覆盖常见误触发与正常登录场景
EOF
)"
```

---

## 自检清单

**Spec coverage:**
- [x] 收紧字段识别规则：Task 2 通过 `FieldDetectionRules` + `detectFields` 实现。
- [x] 否定关键词过滤：Task 2 `isNegative` 实现。
- [x] `type="text"` 降级为弱信号：Task 2 `detectFields` 仅在 `passwordField != null` 时才回退文本框。
- [x] 强用户名信号保留：Task 2 `isStrongUsernameSignal` 实现。
- [x] 上层服务不变：Task 2 只修改 `StructureParser`，未改动 `PwBookAutofillService`/`FillResponseBuilder`/`AutofillFillResponseBuilder`。
- [x] 单元测试覆盖：Task 1 覆盖搜索、评论、标准登录、仅邮箱、弱文本框+密码、否定词边界。

**Placeholder scan:**
- [x] 无 TBD/TODO/"实现 later"/"适当处理"等占位符。
- [x] 每个步骤包含完整代码或命令。

**Type consistency:**
- [x] `detectFields` 签名与测试中调用一致：`List<AutofillField> -> Pair<AutofillField?, AutofillField?>`。
- [x] `FieldDetectionRules` 函数签名在实现中保持一致。

## 执行交接

Plan complete and saved to `docs/superpowers/plans/2026-06-21-android-autofill-optimization-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
