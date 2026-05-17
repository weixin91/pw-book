/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("../../platform/storage", () => ({
  StorageService: {
    getUserKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
    getProfile: vi.fn().mockResolvedValue({ token: "tok", id: "user-1" }),
    getServerUrl: vi.fn().mockResolvedValue("https://api.example.com"),
  },
}));

vi.mock("../../crypto/crypto-service", () => ({
  decryptCipherData: vi.fn(),
}));

const listMock = vi.fn();
const restoreMock = vi.fn();
const permanentDeleteMock = vi.fn();

vi.mock("../../sync/trash-client", () => ({
  TrashClient: vi.fn().mockImplementation(() => ({
    list: listMock,
    restore: restoreMock,
    permanentDelete: permanentDeleteMock,
  })),
}));

import { TrashView } from "./TrashView";
import { decryptCipherData } from "../../crypto/crypto-service";

describe("TrashView - 列表渲染", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("加载中显示占位", async () => {
    listMock.mockImplementation(() => new Promise(() => {})); // 永不 resolve
    render(<TrashView onBack={vi.fn()} />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
  });

  it("空列表显示'回收站为空'", async () => {
    listMock.mockResolvedValue([]);
    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("回收站为空")).toBeInTheDocument();
    });
  });

  it("渲染解密成功的条目:名称 + username", async () => {
    listMock.mockResolvedValue([
      {
        id: "c1",
        type: 1,
        data: "encrypted-1",
        favorite: false,
        reprompt: 0,
        createdAt: "2026-01-01T00:00:00Z",
        modifiedAt: "2026-04-01T00:00:00Z",
        deletedAt: "2026-05-01T00:00:00Z",
      },
    ]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("GitHub")).toBeInTheDocument();
      expect(screen.getByText("alice")).toBeInTheDocument();
    });
  });

  it("解密失败的条目显示 '解密失败' 占位,且仍渲染操作按钮", async () => {
    listMock.mockResolvedValue([
      {
        id: "c-broken",
        type: 1,
        data: "broken",
        favorite: false,
        reprompt: 0,
        createdAt: "2026-01-01T00:00:00Z",
        modifiedAt: "2026-04-01T00:00:00Z",
        deletedAt: "2026-05-01T00:00:00Z",
      },
    ]);
    vi.mocked(decryptCipherData).mockRejectedValue(new Error("decrypt failed"));

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/解密失败/)).toBeInTheDocument();
      expect(screen.getByText("恢复")).toBeInTheDocument();
      expect(screen.getByText("永久删除")).toBeInTheDocument();
    });
  });

  it("拉取失败显示错误信息和重试按钮", async () => {
    listMock.mockRejectedValueOnce(new Error("network down"));
    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
      expect(screen.getByText("重试")).toBeInTheDocument();
    });

    // 点击重试触发再次请求
    listMock.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });

  it("点击返回触发 onBack", async () => {
    listMock.mockResolvedValue([]);
    const onBack = vi.fn();
    render(<TrashView onBack={onBack} />);
    await waitFor(() => screen.getByText("回收站为空"));
    fireEvent.click(screen.getByText(/返回/));
    expect(onBack).toHaveBeenCalled();
  });
});
