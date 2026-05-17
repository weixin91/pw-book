# 笔记功能设计文档

**日期**: 2026-05-17  
**状态**: 已审阅通过  
**相关需求**: 在 Edge 扩展与 Android App 两端增加笔记功能，数据双向同步

---

## 1. 设计决策摘要

- **复用现有 `CipherType.SECURE_NOTE`（`type = 4`）**，不新增数据模型、不改动后端 schema、不复用/扩展 `CipherForm`
- **纯文本格式**，笔记内容存放在 `CipherData.notes` 字段
- **统一列表 + 类型筛选**：两端列表均支持按类型过滤（全部 / 登录 / 笔记）
- **独立笔记编辑界面**：笔记使用独立的简化表单，只包含标题和正文两个字段

---

## 2. 数据模型

### 2.1 CipherData（笔记形态）

```typescript
{
  name: "笔记标题",
  notes: "笔记正文内容...\n多行纯文本",
  fields: [],
  lastUsedAt: null,
  secureNote: { type: 0 }  // 通用笔记，保留占位
}
```

- `name` → 笔记标题（必填，非空校验）
- `notes` → 笔记正文（纯文本，可为空）
- `secureNote.type` → 固定为 `0`（通用笔记），为未来扩展子类型预留

### 2.2 后端存储

笔记就是 `Cipher` 表中 `type = 4` 的记录。服务端始终只存储加密后的 `data` blob，不解密。无需：

- schema 迁移
- 新 API 路由
- 同步协议改动

---

## 3. 同步机制

笔记完全复用现有 Cipher 同步基础设施：

| 操作 | 行为 |
|------|------|
| 创建笔记 | 构造 `type=4` 的 Cipher，进入 pending changes 队列，自动推送 |
| 编辑笔记 | 更新 Cipher `data` 和 `modifiedAt`，进入队列自动推送 |
| 删除笔记 | 软删除（`deletedAt` 标记），同步下发 tombstone |
| 接收同步 | 增量拉取到 `type=4` 的 Cipher 后，本地列表自然更新 |
| 实时通知 | WebSocket `SYNC_REQUIRED` 自动覆盖 |
| 冲突解决 | last-write-wins，复用现有 `ConflictResolver` |

---

## 4. Edge 扩展 UI 设计

### 4.1 VaultList 改造

- **顶部筛选 Chip**：`['全部', '登录', '笔记']`，默认"全部"
- **列表项差异化展示**：
  - `LOGIN`：保持现有（网站图标 + username + URI 预览）
  - `SECURE_NOTE`：笔记图标（DocumentIcon）+ 标题 + `notes` 前 60 字符预览
- **长按菜单过滤**：笔记项隐藏"复制密码""复制用户名"等不适用操作

### 4.2 新建流程

```
点击"新建"按钮
  → 弹出 TypeSelector Dialog（密码 / 笔记）
  → 选"笔记" → 路由进入 NoteForm（新建模式）
```

### 4.3 NoteForm 组件

```typescript
interface NoteFormProps {
  cipherId?: string;      // 有值 = 编辑，无值 = 新建
  onSave: () => void;     // 保存成功后返回列表
  onCancel: () => void;   // 取消返回
}
```

- **标题输入**：单行文本框，非空校验
- **正文输入**：多行 textarea，自动增高
- **操作按钮**：保存（标题非空时可用）、取消
- **编辑模式**：额外显示删除按钮（走现有删除确认 Dialog）
- **保存逻辑**：构造完整 `CipherData`（含 `type: 4`），调用现有 `saveCipher` 接口

### 4.4 路由/导航

popup 内部导航增加 `note-form` 视图状态，与现有 `cipher-form` 并列：`VaultList` 统一调度进入和返回。

---

## 5. Android UI 设计

### 5.1 凭据列表 Screen 改造

- **顶部筛选 Tab/Chip**：`['全部', '登录', '笔记']`
- **列表项差异化**：
  - `LOGIN`：保持现有展示
  - `SECURE_NOTE`：笔记图标 + 标题 + 正文预览
- **长按菜单**：同样过滤不适用操作

### 5.2 新建流程

```
点击 FAB
  → 弹出 TypeSelectionBottomSheet（密码 / 笔记）
  → 选"笔记" → NavHost 导航到 note_edit 路由
```

### 5.3 NoteEditScreen

```kotlin
@Composable
fun NoteEditScreen(
    cipherId: String?,          // null = 新建
    onNavigateBack: () -> Unit,
    viewModel: NoteEditViewModel = hiltViewModel()
)
```

- **标题输入**：`OutlinedTextField`，单行
- **正文输入**：`OutlinedTextField`，`minLines = 5`，多行
- **TopAppBar**：返回箭头 + 页面标题（"新建笔记"/"编辑笔记"）+ 保存图标按钮
- **编辑模式菜单**：包含删除选项
- **ViewModel**：复用 `CipherRepository`，负责加载、校验（标题非空）、保存/删除

---

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 标题为空 | 禁用保存按钮，或点击时 Toast 提示 |
| 保存网络失败 | 走现有错误处理，数据自动进入 pending changes 队列，恢复在线后自动重试 |
| 同步冲突 | last-write-wins，完全复用现有 `ConflictResolver` |

---

## 7. 测试策略

| 层级 | 测试内容 |
|------|----------|
| Edge 单元测试 | `NoteForm` 渲染、输入绑定、保存时构造正确的 `CipherData` |
| Android JVM 测试 | `NoteEditViewModel` 的保存/加载/校验逻辑 |
| Android Instrumentation | `NoteEditScreen` 的 Compose UI 测试 |
| 集成测试（推荐） | 一端创建笔记，验证同步后另一端正确显示 |

---

## 8. 改动范围汇总

| 模块 | 改动 |
|------|------|
| `packages/shared-types` | **无需改动** |
| `apps/backend` | **无需改动**（schema、API、同步协议全部零侵入） |
| `apps/edge-extension/src/popup/` | 新增 `NoteForm.tsx`、新增 `TypeSelector.tsx`、改造 `VaultList`（筛选 + 列表展示） |
| `apps/android/app/src/.../ui/screens/` | 新增 `NoteEditScreen.kt`、新增 `TypeSelectionBottomSheet.kt`、改造列表筛选和列表项展示 |

---

## 9. 未来扩展（明确不做在本次范围）

以下功能本次不实现，但数据模型和架构为它们预留了空间：

- Markdown 渲染（`notes` 字段可直接存放 Markdown 文本）
- 笔记分类/文件夹（可用 `fields` 或新增字段扩展）
- 富文本编辑器（需要改动 `CipherData` 结构存储格式化数据）
- 笔记搜索高亮（列表搜索功能扩展）
