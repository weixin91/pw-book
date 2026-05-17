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

describe("TrashView - 恢复操作", () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage: sendMessageMock } });
  });

  it("点击恢复调用 restore,从列表移除该项,触发 sync 消息,显示 toast", async () => {
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );
    restoreMock.mockResolvedValue({ ...sample, deletedAt: null });

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("恢复"));

    await waitFor(() => {
      expect(restoreMock).toHaveBeenCalledWith("c1");
    });

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({ type: "TRIGGER_SYNC_NOW" });
    });

    await waitFor(() => {
      expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    });

    expect(screen.getByText("已恢复")).toBeInTheDocument();
  });

  it("恢复失败保留列表项并提示错误", async () => {
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );
    restoreMock.mockRejectedValue(new Error("network"));

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("恢复"));

    await waitFor(() => {
      expect(screen.getByText("恢复失败")).toBeInTheDocument();
    });
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});

describe("TrashView - 永久删除操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("点击永久删除弹出 confirm,用户确认则调用 permanentDelete 并移除列表项", async () => {
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );
    permanentDeleteMock.mockResolvedValue(undefined);

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("永久删除"));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(permanentDeleteMock).toHaveBeenCalledWith("c1");
    });
    await waitFor(() => {
      expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    });
    expect(screen.getByText("已永久删除")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("用户取消 confirm 不调用 permanentDelete,列表不变", async () => {
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("永久删除"));

    expect(confirmSpy).toHaveBeenCalled();
    expect(permanentDeleteMock).not.toHaveBeenCalled();
    expect(screen.getByText("GitHub")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("永久删除失败保留列表项并提示错误", async () => {
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const sample = {
      id: "c1",
      type: 1,
      data: "encrypted",
      favorite: false,
      reprompt: 0,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-04-01T00:00:00Z",
      deletedAt: "2026-05-01T00:00:00Z",
    };
    listMock.mockResolvedValue([sample]);
    vi.mocked(decryptCipherData).mockResolvedValue(
      JSON.stringify({ name: "GitHub", login: { username: "alice" } })
    );
    permanentDeleteMock.mockRejectedValue(new Error("network"));

    render(<TrashView onBack={vi.fn()} />);
    await waitFor(() => screen.getByText("GitHub"));

    fireEvent.click(screen.getByText("永久删除"));

    await waitFor(() => {
      expect(screen.getByText("永久删除失败")).toBeInTheDocument();
    });
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});
