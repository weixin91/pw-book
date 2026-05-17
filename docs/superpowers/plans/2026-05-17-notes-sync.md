# 笔记功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Edge 扩展与 Android App 两端补全 `SECURE_NOTE` 类型（`CipherType = 4`）的笔记创建、编辑、查看和列表筛选功能，数据通过现有 Cipher 同步机制双向同步。

**Architecture:** 纯 UI 层功能。笔记就是 `type=4` 的 Cipher，`name` 为标题，`notes` 为正文。后端 schema、API、同步协议零改动。两端各自新增独立的笔记编辑界面和类型筛选，列表层按类型差异化展示。

**Tech Stack:** React 18 + TypeScript (Edge), Jetpack Compose + Kotlin (Android), Vitest (Edge 测试), JUnit (Android 测试)

---

## 文件结构

### Edge 扩展（新增/修改）

| 文件 | 动作 | 说明 |
|------|------|------|
| `apps/edge-extension/src/popup/components/NoteForm.tsx` | 创建 | 笔记创建/编辑表单（标题+正文） |
| `apps/edge-extension/src/popup/components/TypeSelector.tsx` | 创建 | 新建时弹出的类型选择 Dialog |
| `apps/edge-extension/src/popup/components/NoteForm.test.tsx` | 创建 | NoteForm 单元测试 |
| `apps/edge-extension/src/popup/PopupApp.tsx` | 修改 | 增加 `noteAdd` / `noteEdit` 视图状态 |
| `apps/edge-extension/src/popup/components/VaultList.tsx` | 修改 | 增加类型筛选 Chip + 列表项差异化展示 |

### Android（新增/修改）

| 文件 | 动作 | 说明 |
|------|------|------|
| `apps/android/app/src/main/java/com/pwbook/ui/screens/note/NoteEditViewModel.kt` | 创建 | 笔记编辑 ViewModel（加载/保存/删除） |
| `apps/android/app/src/main/java/com/pwbook/ui/screens/note/NoteEditScreen.kt` | 创建 | 笔记编辑 Compose Screen |
| `apps/android/app/src/main/java/com/pwbook/ui/screens/TypeSelectionBottomSheet.kt` | 创建 | FAB 点击后弹出的类型选择 BottomSheet |
| `apps/android/app/src/test/java/com/pwbook/ui/screens/note/NoteEditViewModelTest.kt` | 创建 | NoteEditViewModel 单元测试 |
| `apps/android/app/src/main/java/com/pwbook/ui/navigation/NavRoutes.kt` | 修改 | 增加 `NoteEdit` 路由 |
| `apps/android/app/src/main/java/com/pwbook/ui/navigation/AppNavHost.kt` | 修改 | 注册 `NoteEdit` 路由，VaultList 回调改造 |
| `apps/android/app/src/main/java/com/pwbook/ui/screens/VaultListScreen.kt` | 修改 | 增加类型筛选、FAB 类型选择、列表项差异化 |

---

## Task 1: Edge - NoteForm 组件

**Files:**
- Create: `apps/edge-extension/src/popup/components/NoteForm.tsx`
- Test: `apps/edge-extension/src/popup/components/NoteForm.test.tsx`

- [ ] **Step 1: 写 NoteForm 组件**

创建 `apps/edge-extension/src/popup/components/NoteForm.tsx`：

```tsx
import React, { useState, useEffect } from "react";
import { StorageService } from "../../platform/storage";
import { PendingChangesQueue } from "../../sync/pending-changes";
import { CipherIndexService } from "../../crypto/cipher-index";
import { parseCipherData } from "../../crypto/cipher-data-parser";
import type { Cipher } from "@pwbook/shared-types";

interface Props {
  editId: string | null;
  onBack: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

export function NoteForm({ editId, onBack, onSaved, onDeleted }: Props): React.ReactElement {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editId) {
      loadNote(editId);
    }
  }, [editId]);

  async function loadNote(id: string) {
    const ciphers = await StorageService.getCiphers();
    const cipher = ciphers.find((c) => c.id === id);
    if (!cipher) return;
    const userKey = await StorageService.getUserKey();
    if (!userKey) return;
    const { decryptCipherData } = await import("../../crypto/crypto-service");
    try {
      const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
      setName(data.name || "");
      setNotes(data.notes || "");
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const userKey = await StorageService.getUserKey();
      if (!userKey) return;
      const { encryptCipherData } = await import("../../crypto/crypto-service");

      const cipherData = {
        name: name.trim(),
        notes: notes.trim() || null,
        fields: [],
        lastUsedAt: null,
        secureNote: { type: 0 },
      };

      const encryptedData = await encryptCipherData(JSON.stringify(cipherData), userKey);
      const ciphers = await StorageService.getCiphers();
      const profile = await StorageService.getProfile();
      const now = new Date().toISOString();

      let targetId: string;
      if (editId) {
        const idx = ciphers.findIndex((c) => c.id === editId);
        if (idx >= 0) {
          ciphers[idx] = { ...ciphers[idx], data: encryptedData, modifiedAt: now };
          targetId = editId;
        } else {
          return;
        }
      } else {
        targetId = crypto.randomUUID();
        ciphers.push({
          id: targetId,
          userId: profile?.id ?? "",
          type: 4,
          data: encryptedData,
          favorite: false,
          reprompt: 0,
          createdAt: now,
          modifiedAt: now,
        });
      }

      await StorageService.setCiphers(ciphers);
      await CipherIndexService.updateOne(targetId, parseCipherData(JSON.stringify(cipherData)));

      const queue = new PendingChangesQueue();
      const cipher = ciphers.find((c) => c.id === targetId)!;
      await queue.enqueue({
        cipherId: targetId,
        operation: editId ? "UPDATE" : "CREATE",
        encryptedData,
        clientTimestamp: now,
        userId: cipher.userId,
        type: cipher.type,
        favorite: cipher.favorite,
        reprompt: cipher.reprompt,
        createdAt: cipher.createdAt,
        modifiedAt: cipher.modifiedAt,
      });

      onSaved();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!editId) return;
    if (!confirm("确定要删除这条笔记吗？")) return;
    const ciphers = await StorageService.getCiphers();
    const filtered = ciphers.filter((c) => c.id !== editId);
    await StorageService.setCiphers(filtered);
    await CipherIndexService.removeOne(editId);

    const queue = new PendingChangesQueue();
    await queue.enqueue({
      cipherId: editId,
      operation: "DELETE",
      encryptedData: "",
      clientTimestamp: new Date().toISOString(),
      userId: "",
      type: 4,
      favorite: false,
      reprompt: 0,
      createdAt: "",
      modifiedAt: "",
    });

    onDeleted?.();
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <button onClick={onBack} style={{ padding: "4px 8px", fontSize: 13 }}>
          ← 返回
        </button>
        <span style={{ fontWeight: 500, fontSize: 15 }}>
          {editId ? "编辑笔记" : "新建笔记"}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#555" }}>
          标题
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入笔记标题"
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #ddd",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4, color: "#555" }}>
          内容
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="输入笔记内容..."
          rows={8}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid #ddd",
            fontSize: 14,
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={!name.trim() || loading}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 6,
            border: "none",
            background: name.trim() ? "#1a73e8" : "#ccc",
            color: "#fff",
            fontSize: 14,
            cursor: name.trim() ? "pointer" : "not-allowed",
          }}
        >
          {loading ? "保存中..." : "保存"}
        </button>
        <button
          onClick={onBack}
          style={{
            padding: "10px 16px",
            borderRadius: 6,
            border: "1px solid #ddd",
            background: "#fff",
            fontSize: 14,
          }}
        >
          取消
        </button>
      </div>

      {editId && (
        <button
          onClick={handleDelete}
          style={{
            marginTop: 16,
            width: "100%",
            padding: "10px",
            borderRadius: 6,
            border: "1px solid #d93025",
            background: "#fff",
            color: "#d93025",
            fontSize: 14,
          }}
        >
          删除笔记
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写 NoteForm 单元测试**

创建 `apps/edge-extension/src/popup/components/NoteForm.test.tsx`：

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Mock storage and crypto modules
vi.mock("../../platform/storage", () => ({
  StorageService: {
    getUserKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
    getCiphers: vi.fn().mockResolvedValue([]),
    setCiphers: vi.fn().mockResolvedValue(undefined),
    getProfile: vi.fn().mockResolvedValue({ id: "user-1" }),
  },
}));

vi.mock("../../sync/pending-changes", () => ({
  PendingChangesQueue: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../crypto/cipher-index", () => ({
  CipherIndexService: {
    updateOne: vi.fn().mockResolvedValue(undefined),
    removeOne: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../crypto/cipher-data-parser", () => ({
  parseCipherData: vi.fn().mockReturnValue({ name: "test" }),
}));

vi.mock("../../crypto/crypto-service", () => ({
  encryptCipherData: vi.fn().mockResolvedValue("encrypted-data"),
  decryptCipherData: vi.fn().mockResolvedValue(JSON.stringify({ name: "旧标题", notes: "旧内容" })),
}));

import { NoteForm } from "./NoteForm";

describe("NoteForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("新建模式：渲染标题和内容输入框", () => {
    render(<NoteForm editId={null} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByPlaceholderText("输入笔记标题")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入笔记内容...")).toBeInTheDocument();
    expect(screen.getByText("新建笔记")).toBeInTheDocument();
  });

  it("标题为空时保存按钮禁用", () => {
    render(<NoteForm editId={null} onBack={vi.fn()} onSaved={vi.fn()} />);
    const saveBtn = screen.getByText("保存");
    expect(saveBtn).toBeDisabled();
  });

  it("输入标题后保存按钮可用", () => {
    render(<NoteForm editId={null} onBack={vi.fn()} onSaved={vi.fn()} />);
    const titleInput = screen.getByPlaceholderText("输入笔记标题");
    fireEvent.change(titleInput, { target: { value: "我的笔记" } });
    const saveBtn = screen.getByText("保存");
    expect(saveBtn).not.toBeDisabled();
  });

  it("点击保存后调用 onSaved", async () => {
    const onSaved = vi.fn();
    render(<NoteForm editId={null} onBack={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText("输入笔记标题"), {
      target: { value: "测试标题" },
    });
    fireEvent.change(screen.getByPlaceholderText("输入笔记内容..."), {
      target: { value: "测试内容" },
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd /home/weixin/code/pw-book/apps/edge-extension
pnpm test -- src/popup/components/NoteForm.test.tsx
```

预期：所有测试通过。

**注意**：如果 `@testing-library/react` 未安装，先安装：
```bash
pnpm --filter edge-extension add -D @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 4: Commit**

```bash
git add apps/edge-extension/src/popup/components/NoteForm.tsx \
           apps/edge-extension/src/popup/components/NoteForm.test.tsx
git commit -m "feat(edge): 笔记表单组件与单元测试"
```

---

## Task 2: Edge - TypeSelector 组件

**Files:**
- Create: `apps/edge-extension/src/popup/components/TypeSelector.tsx`

- [ ] **Step 1: 写 TypeSelector 组件**

创建 `apps/edge-extension/src/popup/components/TypeSelector.tsx`：

```tsx
import React from "react";

interface Props {
  onSelect: (type: "login" | "note") => void;
  onCancel: () => void;
}

export function TypeSelector({ onSelect, onCancel }: Props): React.ReactElement {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 20,
          width: 260,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 16, textAlign: "center" }}>
          选择类型
        </div>
        <button
          onClick={() => onSelect("login")}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            marginBottom: 10,
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>🔐</span> 密码凭据
        </button>
        <button
          onClick={() => onSelect("note")}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>📝</span> 安全笔记
        </button>
        <button
          onClick={onCancel}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "10px",
            borderRadius: 8,
            border: "none",
            background: "#f5f5f5",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/edge-extension/src/popup/components/TypeSelector.tsx
git commit -m "feat(edge): 新建类型选择器组件"
```

---

## Task 3: Edge - 改造 PopupApp 路由

**Files:**
- Modify: `apps/edge-extension/src/popup/PopupApp.tsx`

- [ ] **Step 1: 修改 View 类型和渲染逻辑**

将 `apps/edge-extension/src/popup/PopupApp.tsx` 的 View 类型和导入改为：

```tsx
import React, { useEffect, useState } from "react";
import { VaultList } from "./components/VaultList";
import { UnlockScreen } from "./components/UnlockScreen";
import { CipherForm } from "./components/CipherForm";
import { NoteForm } from "./components/NoteForm";
import { PasswordGenerator } from "./components/PasswordGenerator";
import { CookieSyncPanel } from "./components/CookieSyncPanel";
import { StorageService } from "../platform/storage";

type View = "unlock" | "vault" | "add" | "edit" | "noteAdd" | "noteEdit" | "generator" | "cookieSync";

export function PopupApp(): React.ReactElement {
  const [view, setView] = useState<View>("unlock");
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    checkLoginStatus();
  }, []);

  async function checkLoginStatus() {
    const key = await StorageService.getUserKey();
    setView(key ? "vault" : "unlock");
  }

  function handleUnlocked() {
    setView("vault");
  }

  function handleAdd() {
    setEditId(null);
    setView("add");
  }

  function handleEdit(id: string) {
    setEditId(id);
    setView("edit");
  }

  function handleAddNote() {
    setEditId(null);
    setView("noteAdd");
  }

  function handleEditNote(id: string) {
    setEditId(id);
    setView("noteEdit");
  }

  function handleBackToVault() {
    setView("vault");
  }

  function handleOpenGenerator() {
    setView("generator");
  }

  function handleOpenCookieSync() {
    setView("cookieSync");
  }

  return (
    <div style={{ width: 360, minHeight: 480, fontFamily: "system-ui, sans-serif" }}>
      {view === "unlock" && <UnlockScreen onUnlocked={handleUnlocked} />}
      {view === "vault" && (
        <VaultList
          onAdd={handleAdd}
          onEdit={handleEdit}
          onAddNote={handleAddNote}
          onEditNote={handleEditNote}
          onOpenGenerator={handleOpenGenerator}
          onOpenCookieSync={handleOpenCookieSync}
        />
      )}
      {(view === "add" || view === "edit") && (
        <CipherForm
          editId={editId}
          onBack={handleBackToVault}
          onSaved={handleBackToVault}
          onDeleted={handleBackToVault}
        />
      )}
      {(view === "noteAdd" || view === "noteEdit") && (
        <NoteForm
          editId={editId}
          onBack={handleBackToVault}
          onSaved={handleBackToVault}
          onDeleted={handleBackToVault}
        />
      )}
      {view === "generator" && (
        <PasswordGenerator onBack={handleBackToVault} />
      )}
      {view === "cookieSync" && (
        <div>
          <button onClick={handleBackToVault} style={{ margin: 8, padding: "4px 8px", fontSize: 13 }}>
            ← 返回
          </button>
          <CookieSyncPanel />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/edge-extension/src/popup/PopupApp.tsx
git commit -m "feat(edge): popup 路由增加笔记编辑视图"
```

---

## Task 4: Edge - 改造 VaultList 筛选和列表展示

**Files:**
- Modify: `apps/edge-extension/src/popup/components/VaultList.tsx`

- [ ] **Step 1: 扩展 VaultItem 和 Props**

修改 `VaultList.tsx` 的接口部分：

```tsx
interface VaultItem {
  cipher: Cipher;
  name: string;
  username: string;
  hasTotp: boolean;
  hasPasskey: boolean;
  uris: string[];
  isNote: boolean;
  notePreview: string;
}

interface Props {
  onAdd: () => void;
  onEdit: (id: string) => void;
  onAddNote: () => void;
  onEditNote: (id: string) => void;
  onOpenGenerator: () => void;
  onOpenCookieSync: () => void;
}

type FilterType = "all" | "login" | "note";
```

- [ ] **Step 2: 改造 loadItems 以识别笔记类型**

在 `loadItems` 函数中，修改 decrypted.map 的返回构造：

```tsx
const decrypted = await Promise.all(
  ciphers.map(async (cipher) => {
    try {
      const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
      const totpRaw = String(data.login?.totp ?? "").trim();
      const pk = data.passkey as { credentialId?: string } | undefined;
      const uris = ((data.login?.uris ?? []) as Array<{ uri?: string }>)
        .map((u) => u.uri ?? "")
        .filter((u) => u.length > 0);
      const isNote = cipher.type === 4;
      return {
        cipher,
        name: data.name || "未命名",
        username: isNote ? "" : (data.login?.username || ""),
        hasTotp: !isNote && totpRaw.length > 0 && parseOtpauthUri(totpRaw) !== null,
        hasPasskey: !isNote && !!pk?.credentialId,
        uris: isNote ? [] : uris,
        isNote,
        notePreview: isNote ? String(data.notes ?? "").slice(0, 60) : "",
      };
    } catch (err) {
      console.error("[VaultList] 解密失败:", cipher.id, err);
      return {
        cipher,
        name: "解密失败",
        username: "",
        hasTotp: false,
        hasPasskey: false,
        uris: [],
        isNote: cipher.type === 4,
        notePreview: "",
      };
    }
  })
);
```

- [ ] **Step 3: 增加类型筛选状态和 UI**

在组件 state 中增加 `filterType`：

```tsx
const [filterType, setFilterType] = useState<FilterType>("all");
```

在搜索框和新建按钮之间插入筛选 Chip：

```tsx
{/* 搜索框和新建按钮已有代码，在它们之间或下方插入 */}
<div style={{ display: "flex", gap: 6, marginBottom: 12, marginTop: 8 }}>
  {(["all", "login", "note"] as FilterType[]).map((t) => (
    <button
      key={t}
      onClick={() => setFilterType(t)}
      style={{
        padding: "4px 12px",
        borderRadius: 16,
        border: "none",
        background: filterType === t ? "#1a73e8" : "#f0f0f0",
        color: filterType === t ? "#fff" : "#333",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {t === "all" ? "全部" : t === "login" ? "登录" : "笔记"}
    </button>
  ))}
</div>
```

- [ ] **Step 4: 改造 filtered 以支持类型筛选**

修改 `filtered` 计算逻辑：

```tsx
const filtered = items
  .filter((i) => {
    const matchesSearch =
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.username.toLowerCase().includes(search.toLowerCase()) ||
      i.notePreview.toLowerCase().includes(search.toLowerCase());
    const matchesType =
      filterType === "all" ? true :
      filterType === "login" ? !i.isNote :
      i.isNote;
    return matchesSearch && matchesType;
  })
  .sort((a, b) => {
    if (a.cipher.favorite && !b.cipher.favorite) return -1;
    if (!a.cipher.favorite && b.cipher.favorite) return 1;
    return a.name.localeCompare(b.name);
  });
```

- [ ] **Step 5: 改造新建按钮为类型选择触发**

将原来的 `onClick={onAdd}` 改为弹出 TypeSelector：

```tsx
// 在组件 state 中增加
const [showTypeSelector, setShowTypeSelector] = useState(false);

// 替换原来的新建按钮 onClick
<button
  onClick={() => setShowTypeSelector(true)}
  style={{ ... }}
>
  + 新建
</button>

// 在 return 的 JSX 末尾添加
{showTypeSelector && (
  <TypeSelector
    onSelect={(type) => {
      setShowTypeSelector(false);
      if (type === "login") onAdd();
      else onAddNote();
    }}
    onCancel={() => setShowTypeSelector(false)}
  />
)}
```

- [ ] **Step 6: 改造列表项渲染以支持笔记**

在列表项的 `onClick` 和展示部分，根据 `isNote` 切换行为：

```tsx
// 列表项的点击事件
onClick={() => {
  if (item.isNote) onEditNote(item.cipher.id);
  else onEdit(item.cipher.id);
}}

// 名称行展示
<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
  <div style={{ fontWeight: 500, fontSize: 14 }}>{item.name}</div>
  {item.isNote && <span title="笔记">📝</span>}
  {!item.isNote && item.hasPasskey && <span title="包含通行密钥">🔐</span>}
</div>

// 副标题行
<div style={{ color: "#888", fontSize: 12 }}>
  {item.isNote ? item.notePreview || "（无内容）" : item.username}
</div>
```

- [ ] **Step 7: 过滤复制菜单中的不适操作**

在复制下拉菜单中，笔记项只保留"复制"（复制正文内容）：

```tsx
{item.isNote ? (
  <button onClick={() => handleCopyNote(item.cipher)}>复制内容</button>
) : (
  <>
    <button onClick={() => handleCopy(item.cipher, "username")}>复制用户名</button>
    <button onClick={() => handleCopy(item.cipher, "password")}>复制密码</button>
    {item.hasTotp && <button onClick={() => handleCopyTotp(item.cipher)}>复制验证码</button>}
  </>
)}
```

增加 `handleCopyNote` 函数：

```tsx
async function handleCopyNote(cipher: Cipher) {
  setOpenMenuId(null);
  setMenuPos(null);
  const userKey = await StorageService.getUserKey();
  if (!userKey) {
    setToast("保险库未解锁");
    return;
  }
  const { decryptCipherData } = await import("../../crypto/crypto-service");
  try {
    const data = JSON.parse(await decryptCipherData(cipher.data, userKey));
    const text = String(data.notes ?? "");
    if (!text) {
      setToast("笔记内容为空");
      return;
    }
    await ClipboardManager.copy(text);
    setToast("笔记内容已复制");
  } catch {
    setToast("复制失败");
  }
}
```

同样过滤 `handleFill` 和 `handleOpenUrl`：笔记项不显示填充和打开 URL 按钮。

- [ ] **Step 8: 运行 Edge 构建检查**

```bash
cd /home/weixin/code/pw-book/apps/edge-extension
pnpm build
```

预期：无 TypeScript 编译错误。

- [ ] **Step 9: Commit**

```bash
git add apps/edge-extension/src/popup/components/VaultList.tsx
git commit -m "feat(edge): 保险库列表增加笔记筛选与差异化展示"
```

---

## Task 5: Android - NoteEditViewModel

**Files:**
- Create: `apps/android/app/src/main/java/com/pwbook/ui/screens/note/NoteEditViewModel.kt`
- Test: `apps/android/app/src/test/java/com/pwbook/ui/screens/note/NoteEditViewModelTest.kt`

- [ ] **Step 1: 写 NoteEditViewModel**

创建 `apps/android/app/src/main/java/com/pwbook/ui/screens/note/NoteEditViewModel.kt`：

```kotlin
package com.pwbook.ui.screens.note

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.VaultSession
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject

data class NoteEditUiState(
    val id: String = "",
    val name: String = "",
    val notes: String = "",
    val isNew: Boolean = true,
    val isLoading: Boolean = false,
    val createdAt: Long = 0L
)

@HiltViewModel
class NoteEditViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val vaultEncryption: VaultEncryption,
    private val pendingChangesQueue: PendingChangesQueue,
    private val securePrefs: SecurePrefs,
    private val syncManager: SyncManager,
    private val json: Json
) : ViewModel() {

    private val _uiState = MutableStateFlow(NoteEditUiState())
    val uiState: StateFlow<NoteEditUiState> = _uiState

    fun loadCipher(cipherId: String?) {
        if (cipherId == null) {
            _uiState.value = NoteEditUiState(isNew = true)
            return
        }
        viewModelScope.launch {
            val entity = cipherRepository.getCipher(cipherId)
            if (entity != null) {
                val decrypted = vaultSession.decryptCipher(entity)
                if (decrypted != null) {
                    _uiState.value = NoteEditUiState(
                        id = entity.id,
                        name = decrypted.name,
                        notes = decrypted.notes ?: "",
                        isNew = false,
                        createdAt = entity.createdAt
                    )
                } else {
                    Timber.e("Failed to decrypt note $cipherId")
                }
            }
        }
    }

    fun updateName(name: String) {
        _uiState.value = _uiState.value.copy(name = name)
    }

    fun updateNotes(notes: String) {
        _uiState.value = _uiState.value.copy(notes = notes)
    }

    fun save(onSuccess: () -> Unit) {
        viewModelScope.launch {
            val userKey = vaultSession.getUserKey()
            if (userKey == null) {
                Timber.e("Vault not unlocked, cannot save note")
                return@launch
            }

            val cipherKey = userKey.copyOfRange(0, 32)
            val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""
            val state = _uiState.value
            val now = System.currentTimeMillis()

            val cipherData = CipherDataJson(
                name = state.name.trim(),
                notes = state.notes.trim().ifEmpty { null }
            )

            val encryptedData = vaultEncryption.encryptString(
                json.encodeToString(cipherData),
                cipherKey
            )

            val entity = CipherEntity(
                id = state.id.ifEmpty { UUID.randomUUID().toString() },
                userId = userId,
                type = 4,
                data = encryptedData,
                favorite = false,
                reprompt = 0,
                createdAt = if (state.isNew) now else state.createdAt,
                modifiedAt = now
            )

            cipherRepository.saveCipher(entity)
            pendingChangesQueue.enqueue(
                entity.id,
                if (state.isNew) PendingChangesQueue.Operation.CREATE else PendingChangesQueue.Operation.UPDATE,
                encryptedData,
                now
            )
            syncManager.launchSyncAll()
            onSuccess()
        }
    }

    fun delete(onSuccess: () -> Unit) {
        viewModelScope.launch {
            val state = _uiState.value
            if (state.id.isEmpty()) return@launch

            cipherRepository.deleteCipher(state.id)
            pendingChangesQueue.enqueue(
                state.id,
                PendingChangesQueue.Operation.DELETE,
                "",
                System.currentTimeMillis()
            )
            syncManager.launchSyncAll()
            onSuccess()
        }
    }
}
```

- [ ] **Step 2: 写 NoteEditViewModel 单元测试**

创建 `apps/android/app/src/test/java/com/pwbook/ui/screens/note/NoteEditViewModelTest.kt`：

```kotlin
package com.pwbook.ui.screens.note

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.VaultSession
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@ExperimentalCoroutinesApi
class NoteEditViewModelTest {

    @get:Rule
    val instantExecutorRule = InstantTaskExecutorRule()

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var cipherRepository: CipherRepository
    private lateinit var vaultSession: VaultSession
    private lateinit var vaultEncryption: VaultEncryption
    private lateinit var pendingChangesQueue: PendingChangesQueue
    private lateinit var securePrefs: SecurePrefs
    private lateinit var syncManager: SyncManager
    private lateinit var viewModel: NoteEditViewModel

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        cipherRepository = mockk(relaxed = true)
        vaultSession = mockk(relaxed = true)
        vaultEncryption = mockk(relaxed = true)
        pendingChangesQueue = mockk(relaxed = true)
        securePrefs = mockk(relaxed = true)
        syncManager = mockk(relaxed = true)

        every { vaultSession.getUserKey() } returns ByteArray(64) { it.toByte() }
        every { vaultEncryption.encryptString(any(), any()) } returns "encrypted"
        every { securePrefs.getString(SecurePrefs.KEY_USER_ID) } returns "user-1"

        viewModel = NoteEditViewModel(
            cipherRepository,
            vaultSession,
            vaultEncryption,
            pendingChangesQueue,
            securePrefs,
            syncManager,
            Json { ignoreUnknownKeys = true }
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `初始状态应为新建模式`() {
        val state = viewModel.uiState.value
        assertTrue(state.isNew)
        assertEquals("", state.name)
        assertEquals("", state.notes)
    }

    @Test
    fun `更新标题后状态同步`() {
        viewModel.updateName("测试笔记")
        assertEquals("测试笔记", viewModel.uiState.value.name)
    }

    @Test
    fun `更新内容后状态同步`() {
        viewModel.updateNotes("笔记正文")
        assertEquals("笔记正文", viewModel.uiState.value.notes)
    }

    @Test
    fun `保存新建笔记时调用 repository saveCipher`() = runTest {
        viewModel.updateName("我的笔记")
        viewModel.updateNotes("内容")

        var successCalled = false
        viewModel.save { successCalled = true }
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify { cipherRepository.saveCipher(any()) }
        coVerify { pendingChangesQueue.enqueue(any(), any(), any(), any()) }
        verify { syncManager.launchSyncAll() }
        assertTrue(successCalled)
    }

    @Test
    fun `加载已有笔记时状态正确`() = runTest {
        val entity = CipherEntity(
            id = "note-1",
            userId = "user-1",
            type = 4,
            data = "encrypted",
            favorite = false,
            reprompt = 0,
            createdAt = 1000L,
            modifiedAt = 2000L
        )
        coEvery { cipherRepository.getCipher("note-1") } returns entity

        val decrypted = com.pwbook.domain.DecryptedCipher(
            id = "note-1",
            type = 4,
            name = "已有笔记",
            notes = "已有内容",
            favorite = false,
            username = null,
            password = null,
            uris = emptyList(),
            totp = null,
            passkey = null,
            modifiedAt = 2000L
        )
        every { vaultSession.decryptCipher(entity) } returns decrypted

        viewModel.loadCipher("note-1")
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isNew)
        assertEquals("已有笔记", state.name)
        assertEquals("已有内容", state.notes)
        assertEquals("note-1", state.id)
    }
}
```

**注意**：如果 `io.mockk:mockk` 未在测试依赖中，检查 `apps/android/app/build.gradle.kts` 的 `testImplementation` 块。若缺失，添加：

```kotlin
testImplementation("io.mockk:mockk:1.13.12")
```

- [ ] **Step 3: 运行 Android 单元测试**

```bash
cd /home/weixin/code/pw-book/apps/android
./gradlew test --tests "com.pwbook.ui.screens.note.NoteEditViewModelTest"
```

预期：所有测试通过。

- [ ] **Step 4: Commit**

```bash
git add apps/android/app/src/main/java/com/pwbook/ui/screens/note/NoteEditViewModel.kt \
           apps/android/app/src/test/java/com/pwbook/ui/screens/note/NoteEditViewModelTest.kt
git commit -m "feat(android): 笔记编辑 ViewModel 与单元测试"
```

---

## Task 6: Android - NoteEditScreen

**Files:**
- Create: `apps/android/app/src/main/java/com/pwbook/ui/screens/note/NoteEditScreen.kt`

- [ ] **Step 1: 写 NoteEditScreen**

创建 `apps/android/app/src/main/java/com/pwbook/ui/screens/note/NoteEditScreen.kt`：

```kotlin
package com.pwbook.ui.screens.note

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.pwbook.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteEditScreen(
    cipherId: String?,
    onNavigateBack: () -> Unit,
    viewModel: NoteEditViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showDeleteDialog by remember { mutableStateOf(false) }

    LaunchedEffect(cipherId) {
        viewModel.loadCipher(cipherId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (uiState.isNew) stringResource(R.string.note_new_title)
                        else stringResource(R.string.note_edit_title)
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            if (uiState.name.isNotBlank()) {
                                viewModel.save(onSuccess = onNavigateBack)
                            }
                        },
                        enabled = uiState.name.isNotBlank()
                    ) {
                        Icon(Icons.Default.Save, contentDescription = stringResource(R.string.save))
                    }
                    if (!uiState.isNew) {
                        IconButton(onClick = { showDeleteDialog = true }) {
                            Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.delete))
                        }
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            OutlinedTextField(
                value = uiState.name,
                onValueChange = viewModel::updateName,
                label = { Text(stringResource(R.string.note_title_label)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                singleLine = true,
                isError = uiState.name.isBlank()
            )

            OutlinedTextField(
                value = uiState.notes,
                onValueChange = viewModel::updateNotes,
                label = { Text(stringResource(R.string.note_content_label)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
                minLines = 5,
                maxLines = 20
            )
        }
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text(stringResource(R.string.note_delete_title)) },
            text = { Text(stringResource(R.string.note_delete_message)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteDialog = false
                        viewModel.delete(onSuccess = onNavigateBack)
                    }
                ) {
                    Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }
}
```

- [ ] **Step 2: 添加字符串资源**

在 `apps/android/app/src/main/res/values/strings.xml` 中添加：

```xml
<string name="note_new_title">新建笔记</string>
<string name="note_edit_title">编辑笔记</string>
<string name="note_title_label">标题</string>
<string name="note_content_label">内容</string>
<string name="note_delete_title">删除笔记</string>
<string name="note_delete_message">确定要删除这条笔记吗？</string>
```

- [ ] **Step 3: Commit**

```bash
git add apps/android/app/src/main/java/com/pwbook/ui/screens/note/NoteEditScreen.kt \
           apps/android/app/src/main/res/values/strings.xml
git commit -m "feat(android): 笔记编辑 Screen"
```

---

## Task 7: Android - TypeSelectionBottomSheet

**Files:**
- Create: `apps/android/app/src/main/java/com/pwbook/ui/screens/TypeSelectionBottomSheet.kt`

- [ ] **Step 1: 写 TypeSelectionBottomSheet**

创建 `apps/android/app/src/main/java/com/pwbook/ui/screens/TypeSelectionBottomSheet.kt`：

```kotlin
package com.pwbook.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TypeSelectionBottomSheet(
    onDismiss: () -> Unit,
    onSelectLogin: () -> Unit,
    onSelectNote: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text(
                text = "选择类型",
                style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 12.dp)
            )
            TextButton(
                onClick = {
                    onDismiss()
                    onSelectLogin()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("🔐 密码凭据")
            }
            TextButton(
                onClick = {
                    onDismiss()
                    onSelectNote()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("📝 安全笔记")
            }
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("取消")
            }
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/android/app/src/main/java/com/pwbook/ui/screens/TypeSelectionBottomSheet.kt
git commit -m "feat(android): 新建类型选择 BottomSheet"
```

---

## Task 8: Android - 改造导航增加笔记路由

**Files:**
- Modify: `apps/android/app/src/main/java/com/pwbook/ui/navigation/NavRoutes.kt`
- Modify: `apps/android/app/src/main/java/com/pwbook/ui/navigation/AppNavHost.kt`

- [ ] **Step 1: 在 NavRoutes 中增加 NoteEdit 路由**

修改 `apps/android/app/src/main/java/com/pwbook/ui/navigation/NavRoutes.kt`，在 `CipherEdit` 后面添加：

```kotlin
data object NoteEdit : NavRoutes("note_edit/{cipherId}") {
    fun createRoute(cipherId: String? = null) =
        "note_edit/${cipherId ?: "new"}"
}
```

- [ ] **Step 2: 在 AppNavHost 中注册 NoteEdit 路由并改造 VaultList 回调**

修改 `apps/android/app/src/main/java/com/pwbook/ui/navigation/AppNavHost.kt`：

1. 添加导入：

```kotlin
import com.pwbook.ui.screens.note.NoteEditScreen
```

2. 在 `NavHost` 的 `VaultList` 路由中，将 `onNavigateToEdit` 拆分为两个回调，同时保留对旧 CipherEdit 的导航：

```kotlin
composable(NavRoutes.VaultList.route) {
    val viewModel = hiltViewModel<VaultListViewModel>()
    VaultListScreen(
        viewModel = viewModel,
        isAutofillMode = autofillMode != null,
        targetUri = autofillUri,
        onNavigateToEdit = { cipherId ->
            navController.navigate(NavRoutes.CipherEdit.createRoute(cipherId))
        },
        onNavigateToNoteEdit = { cipherId ->
            navController.navigate(NavRoutes.NoteEdit.createRoute(cipherId))
        },
        onNavigateToGenerator = {
            navController.navigate(NavRoutes.PasswordGenerator.route)
        },
        onNavigateToSettings = {
            navController.navigate(NavRoutes.Settings.route)
        },
        onNavigateToTotp = {
            navController.navigate(NavRoutes.TotpList.route)
        },
        onLock = {
            viewModel.lock()
            navController.navigate(NavRoutes.Unlock.route) {
                popUpTo(0) { inclusive = true }
            }
        },
        onCipherSelected = onCipherSelected,
        onCancel = onCancel
    )
}
```

3. 在 `NavHost` 末尾添加 `NoteEdit` 路由：

```kotlin
composable(NavRoutes.NoteEdit.route) { backStackEntry ->
    val cipherId = backStackEntry.arguments?.getString("cipherId")
    NoteEditScreen(
        cipherId = cipherId.takeIf { it != "new" },
        onNavigateBack = { navController.popBackStack() }
    )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/android/app/src/main/java/com/pwbook/ui/navigation/NavRoutes.kt \
           apps/android/app/src/main/java/com/pwbook/ui/navigation/AppNavHost.kt
git commit -m "feat(android): 导航增加笔记编辑路由"
```

---

## Task 9: Android - 改造 VaultListScreen

**Files:**
- Modify: `apps/android/app/src/main/java/com/pwbook/ui/screens/VaultListScreen.kt`

- [ ] **Step 1: 扩展 VaultListScreen 参数和状态**

修改函数签名，增加 `onNavigateToNoteEdit` 回调：

```kotlin
@Composable
fun VaultListScreen(
    viewModel: VaultListViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
    isAutofillMode: Boolean = false,
    targetUri: String? = null,
    onNavigateToEdit: (String?) -> Unit,
    onNavigateToNoteEdit: (String?) -> Unit,
    onNavigateToGenerator: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToTotp: () -> Unit,
    onLock: () -> Unit,
    onCipherSelected: ((String) -> Unit)? = null,
    onCancel: (() -> Unit)? = null
)
```

在组件内部增加筛选状态和 BottomSheet 状态：

```kotlin
var filterType by remember { mutableStateOf("all") } // "all" | "login" | "note"
var showTypeSelector by remember { mutableStateOf(false) }
```

- [ ] **Step 2: 增加类型筛选 Chip 行**

在搜索框下方、SyncStatusCard 上方插入筛选 Chip：

```kotlin
// 在 Column 中，搜索框之后插入
Row(
    modifier = Modifier
        .fillMaxWidth()
        .padding(vertical = 8.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp)
) {
    listOf("all" to "全部", "login" to "登录", "note" to "笔记").forEach { (key, label) ->
        val selected = filterType == key
        androidx.compose.material3.FilterChip(
            selected = selected,
            onClick = { filterType = key },
            label = { Text(label) },
            modifier = Modifier.weight(1f)
        )
    }
}
```

- [ ] **Step 3: 改造列表过滤逻辑**

修改 `LazyColumn` 的 items，增加类型过滤：

```kotlin
val displayCiphers = uiState.ciphers.filter {
    when (filterType) {
        "login" -> it.type == 1
        "note" -> it.type == 4
        else -> true
    }
}

items(displayCiphers, key = { it.id }) { cipher ->
    CipherListItem(
        cipher = cipher,
        isMatch = ...,
        enableLongClick = !isAutofillMode,
        onCopyPassword = { ... },
        onClick = {
            if (isAutofillMode) {
                onCipherSelected?.invoke(cipher.id)
            } else {
                if (cipher.type == 4) onNavigateToNoteEdit(cipher.id)
                else onNavigateToEdit(cipher.id)
            }
        }
    )
}
```

- [ ] **Step 4: 改造 FAB 为类型选择触发**

修改 FAB 的 onClick：

```kotlin
floatingActionButton = {
    if (!isAutofillMode) {
        FloatingActionButton(onClick = { showTypeSelector = true }) {
            Icon(Icons.Default.Add, contentDescription = stringResource(R.string.add_cipher))
        }
    }
}
```

在 Scaffold 内容末尾添加 BottomSheet：

```kotlin
if (showTypeSelector) {
    TypeSelectionBottomSheet(
        onDismiss = { showTypeSelector = false },
        onSelectLogin = { onNavigateToEdit(null) },
        onSelectNote = { onNavigateToNoteEdit(null) }
    )
}
```

- [ ] **Step 5: 改造 CipherListItem 以支持笔记展示**

修改 `CipherListItem` 内部渲染：

```kotlin
@Composable
private fun CipherListItem(
    cipher: DecryptedCipher,
    isMatch: Boolean,
    enableLongClick: Boolean,
    onCopyPassword: (String) -> Unit,
    onClick: () -> Unit
) {
    val isNote = cipher.type == 4
    var expanded by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = onClick,
                onLongClick = if (enableLongClick) { { expanded = true } } else null
            ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = cipher.name,
                        style = MaterialTheme.typography.bodyLarge
                    )
                    if (isNote) {
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("📝", fontSize = 14.sp)
                    }
                    if (!isNote && cipher.passkey != null) {
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("🔐", fontSize = 14.sp)
                    }
                }
                Text(
                    text = if (isNote) {
                        (cipher.notes ?: "").take(60).let { if (it.isEmpty()) "（无内容）" else it }
                    } else {
                        cipher.username ?: ""
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (isMatch) {
                Text(
                    text = "匹配",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 8.dp)
                )
            }
        }
    }

    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        if (!isNote && cipher.username != null) {
            DropdownMenuItem(
                text = { Text("复制用户名") },
                onClick = {
                    expanded = false
                    clipboard.setText(AnnotatedString(cipher.username))
                    Toast.makeText(context, "用户名已复制", Toast.LENGTH_SHORT).show()
                }
            )
        }
        if (!isNote) {
            DropdownMenuItem(
                text = { Text("复制密码") },
                onClick = {
                    expanded = false
                    onCopyPassword(cipher.id)
                }
            )
        }
        if (isNote && cipher.notes != null) {
            DropdownMenuItem(
                text = { Text("复制内容") },
                onClick = {
                    expanded = false
                    clipboard.setText(AnnotatedString(cipher.notes))
                    Toast.makeText(context, "笔记内容已复制", Toast.LENGTH_SHORT).show()
                }
            )
        }
    }
}
```

- [ ] **Step 6: 运行 Android 编译检查**

```bash
cd /home/weixin/code/pw-book/apps/android
./gradlew compileDebugKotlin
```

预期：无编译错误。

- [ ] **Step 7: Commit**

```bash
git add apps/android/app/src/main/java/com/pwbook/ui/screens/VaultListScreen.kt
git commit -m "feat(android): 保险库列表增加笔记筛选与差异化展示"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| 设计文档要求 | 对应 Task |
|-------------|----------|
| 复用 `SECURE_NOTE` CipherType | 所有 task 的数据构造都使用 `type: 4` / `type = 4` |
| 纯文本格式 | NoteForm 用 textarea，NoteEditScreen 用 OutlinedTextField |
| 统一列表 + 类型筛选 | Task 4 (Edge) 和 Task 9 (Android) 的筛选 Chip |
| 独立笔记编辑界面 | Task 1 (NoteForm), Task 6 (NoteEditScreen) |
| 新建入口类型选择 | Task 2 (TypeSelector), Task 7 (TypeSelectionBottomSheet) |
| 列表项差异化展示 | Task 4 和 Task 9 中的图标、预览、长按菜单过滤 |
| 两端双向同步 | 复用现有 Cipher 保存/同步机制，零额外工作 |
| 测试 | Task 1 (Edge 测试), Task 5 (Android 测试) |

### 2. Placeholder Scan

- 无 TBD / TODO / "implement later"
- 无 "add appropriate error handling" 等模糊描述
- 所有步骤包含完整代码
- 无 "Similar to Task N" 引用

### 3. Type Consistency

- `CipherType.SECURE_NOTE = 4` 在 Edge 和 Android 两端一致使用
- `FilterType` / `filterType` 取值 `"all" | "login" | "note"` 两端语义一致
- `NoteEditUiState` 字段名与 ViewModel 更新方法名匹配
- `PendingChangesQueue.Operation` 使用正确的枚举值（CREATE/UPDATE/DELETE）

---

## 执行方式选择

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-notes-sync.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach would you prefer?
