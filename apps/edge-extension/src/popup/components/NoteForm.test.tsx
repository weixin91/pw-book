/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

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

  it("点击保存后构造正确的笔记数据并调用 onSaved", async () => {
    const onSaved = vi.fn();
    const { StorageService } = await import("../../platform/storage");
    render(<NoteForm editId={null} onBack={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText("输入笔记标题"), {
      target: { value: "测试标题" },
    });
    fireEvent.change(screen.getByPlaceholderText("输入笔记内容..."), {
      target: { value: "测试内容" },
    });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
      expect(StorageService.setCiphers).toHaveBeenCalled();
    });

    const setCiphersCall = vi.mocked(StorageService.setCiphers).mock.calls[0][0];
    expect(setCiphersCall).toHaveLength(1);
    expect(setCiphersCall[0].type).toBe(4);
    expect(setCiphersCall[0].favorite).toBe(false);
  });
});
