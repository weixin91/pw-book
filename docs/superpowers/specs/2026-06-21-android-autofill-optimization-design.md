# Android 自动填充误触发优化设计

## 背景

Android 端 `PwBookAutofillService` 经常在非登录输入框触发凭据填充。根因位于 `StructureParser.kt`：

- 普通 `<input type="text">` 被当作用户名信号。
- 只要识别出用户名或密码任一字段，就会进入填充流程。
- 没有否定关键词过滤，搜索框、聊天框、评论框等容易被误判。

本设计仅优化字段识别层，不改变「始终显示打开保险库」和「忽略站点仅作用于保存提示」的现有产品原则。

## 目标

- 降低搜索/聊天/评论等普通文本框被识别为用户名的概率。
- 保持正常登录页、邮箱登录页的识别成功率。
- 改动集中、可测试、风险低。

## 非目标

- 不修改 Edge 扩展的自动填充逻辑。
- 不引入复杂的页面上下文分析或机器学习模型。
- 不改变「无匹配凭据时仍显示打开保险库」的行为。
- 不改变「忽略站点仅抑制保存提示」的行为。

## 方案选择

### 方案 A：收紧字段识别规则（选中）

- 将 `<input type="text">` 降级为「弱用户名信号」，仅当页面存在密码字段时才启用。
- 增加否定关键词过滤，命中后该字段不参与用户名/密码识别。
- 强用户名信号（`type="email"`、`autofill` hint、`inputType` 邮箱变体）仍然有效。

**优点**：实现简单、定位清晰、单测友好、风险低。
**缺点**：对极端复杂的非标准登录页可能不如上下文分析方案保守。

### 方案 B：增加表单上下文判断

- 额外检查 `<form>` 标签、提交按钮、登录相关文案。

**优点**：误触发率更低。
**缺点**：实现复杂，HTML/WebView 解析依赖强，可能漏掉某些登录页。

### 方案 C：置信度打分模型

- 给字段按多信号打分，超过阈值才触发。

**优点**：最灵活。
**缺点**：对于这个场景过重，需要调参与数据支撑。

**结论**：采用方案 A，并在字段识别函数内部保持可扩展结构，便于后续如需引入方案 B 信号时低成本接入。

## 详细设计

### 改动文件

- `apps/android/app/src/main/java/com/pwbook/service/autofill/StructureParser.kt`
- 新增 `apps/android/app/src/test/java/com/pwbook/service/autofill/StructureParserTest.kt`

### 不变文件

- `PwBookAutofillService.kt`
- `FillResponseBuilder.kt`
- `AutofillFillResponseBuilder.kt`
- `UriMatcher.kt`
- `SaveRequestHandler.kt`

### StructureParser 变更

#### 新增 `FieldDetectionRules`

在 `StructureParser` 中新增内部规则对象，集中管理信号与否定词：

```kotlin
internal object FieldDetectionRules {
    // 命中后字段直接退出用户名/密码候选
    val negativeKeywords = setOf(
        "search", "query", "q", "keyword", "find",
        "chat", "message", "comment", "subject", "title"
    )

    // 强用户名信号：单独存在即可识别为用户名
    fun isStrongUsernameSignal(field: AutofillField): Boolean

    // 弱用户名信号：只有在存在密码字段时才考虑
    fun isWeakUsernameSignal(field: AutofillField): Boolean

    fun isPasswordSignal(field: AutofillField): Boolean

    fun isNegative(field: AutofillField): Boolean
}
```

#### 否定词应用范围

对以下属性做大小写不敏感匹配：

- 多字符关键词：在 `id`、`name`、`class`、placeholder、`autocomplete`、Android hint / `autofillHints` 中做子串匹配。
- 单字符关键词（如 `q`）：只做完整 token 或完整属性值匹配，避免单字母过度过滤。

注意：不否定 `autofill` hint 中的 `username`、`email`、`password` 等标准值本身。

#### 信号分级

**强用户名信号**：

- `type="email"`
- `autofill` hint 包含 `username`、`email`、`login`、`account`
- Android `inputType` 为 `TYPE_TEXT_VARIATION_EMAIL_ADDRESS` 或 `TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS`

**弱用户名信号**：

- `type="text"`
- HTML `id`/`name` 包含 `user`、`login`（且未命中强信号时）

**密码信号**：

- `type="password"`
- `autofill` hint 包含 `password`、`pwd`、`pass`
- Android `inputType` 为 `TYPE_TEXT_VARIATION_PASSWORD`、`TYPE_TEXT_VARIATION_WEB_PASSWORD`、`TYPE_NUMBER_VARIATION_PASSWORD`

#### 识别流程

1. 遍历 `AssistStructure`，构造 `AutofillField` 列表。
2. 过滤命中否定词的字段。
3. 扫描密码信号字段，得到 `passwordId`。
4. 扫描用户名字段：
   - 优先匹配强信号字段。
   - 若无强信号但 `passwordId != null`，启用弱信号，按「密码前最近文本框」回退。
5. 返回 `ParsedStructure(usernameId, passwordId, allFields)`。

### 对现有行为的影响

- `PwBookAutofillService.onFillRequest` 的 early exit 条件不变：`usernameId == null && passwordId == null` 时直接返回。
- 由于搜索/聊天页通常没有密码字段，普通 `type="text"` 不会被识别为用户名，early exit 生效，不会弹出填充菜单。
- 正常登录页存在密码字段，弱信号仍可作为用户名回退，识别不受影响。
- 仅邮箱字段的登录页仍被强信号识别，识别不受影响。

## 数据流示例

### 场景 1：搜索页

页面：`<input type="text" id="q">`，无密码字段。

1. `StructureParser.parse(structure)`：
   - 收集到 `id="q"` 字段，命中否定词 `q`/`query`/`search`，跳过。
   - 无密码字段。
   - 返回 `ParsedStructure(null, null)`。
2. `PwBookAutofillService.onFillRequest`：early exit，不构建 `FillResponse`。
3. 系统不展示凭据填充菜单。

### 场景 2：标准登录页

页面：`<input type="text" id="username">`、`<input type="password" id="password">`。

1. `StructureParser.parse(structure)`：
   - `id="username"` 命中弱用户名信号。
   - 存在密码字段。
   - 返回 `ParsedStructure(usernameId, passwordId)`。
2. `PwBookAutofillService` 继续执行解锁/构建建议。
3. 用户看到匹配的凭据建议和「打开保险库」。

### 场景 3：仅邮箱字段

页面：`<input type="email" id="email">`，无密码字段。

1. `StructureParser.parse(structure)`：
   - `type="email"` 是强用户名信号。
   - 返回 `ParsedStructure(usernameId, null)`。
2. `PwBookAutofillService` 继续执行，允许用户选择凭据或打开保险库。

## 错误处理

### 否定词误伤

- 初始否定词列表保守，不包含 `user`、`login`、`email` 等登录常用词。
- 在 `StructureParser` 中增加 `debug` 日志，记录被否定词过滤的字段，便于排查。
- 如果后续发现某个登录页被误过滤，再针对性调整否定词或改为完整 token 匹配。

### 弱信号遗漏

- 只要页面存在密码字段，弱信号（`type="text"`）仍会被启用。
- 旧版「用户名 + 密码」登录表单不会被遗漏。

## 测试策略

新增 `StructureParserTest.kt`，优先将字段识别逻辑抽成可独立测试的纯函数。

### 覆盖用例

1. **搜索页**：`type="text" id="q"` + 无密码 → `usernameId=null, passwordId=null`。
2. **评论框页**：`type="text" id="comment"` + 无密码 → 不识别。
3. **标准登录页**：`type="text" id="username"` + `type="password"` → 识别用户名+密码。
4. **仅邮箱页**：`type="email"` 单独存在 → 识别用户名，密码为 null。
5. **弱文本框 + 密码**：`type="text" id="field1"` + `type="password"` → 文本框作为用户名回退。
6. **边界否定词**：`id="search-user"` 等视策略验证。

如果 Android `AssistStructure` 在 JVM 中构造困难，先把 `StructureParser` 中字段识别逻辑拆为纯函数（输入 `AutofillField` 列表），上层 `parse()` 只做薄转换。纯函数部分在 JVM 单元测试中覆盖。

## 后续可扩展点

- 若方案 A 实施后仍有较多误触发，可低成本的引入方案 B 信号（提交按钮、登录关键词）到 `FieldDetectionRules` 中。
- 可考虑让用户在设置里选择「保守 / 标准」两档识别策略，但当前版本不引入配置项。

## 参考文件

- `apps/android/app/src/main/java/com/pwbook/service/autofill/PwBookAutofillService.kt`
- `apps/android/app/src/main/java/com/pwbook/service/autofill/StructureParser.kt`
- `apps/android/app/src/main/java/com/pwbook/service/autofill/FillResponseBuilder.kt`
- `apps/android/app/src/main/java/com/pwbook/service/autofill/AutofillFillResponseBuilder.kt`
