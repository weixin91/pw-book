import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../platform/storage", () => ({
  StorageService: {
    getServerUrl: vi.fn().mockResolvedValue("https://api.example.com"),
    getProfile: vi.fn().mockResolvedValue({ token: "test-token", id: "user-1" }),
  },
}));

import { TrashClient } from "./trash-client";

describe("TrashClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("list() 调用 GET /api/ciphers/trash 并返回结果", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "c1", deletedAt: "2026-05-01T00:00:00Z" }],
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrashClient();
    const result = await client.list();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/ciphers/trash",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("list() 非 2xx 抛出错误", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    }) as unknown as typeof fetch;

    const client = new TrashClient();
    await expect(client.list()).rejects.toThrow(/500/);
  });

  it("restore(id) 调用 POST /api/ciphers/:id/restore", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "c1", deletedAt: null }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrashClient();
    const result = await client.restore("c1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/ciphers/c1/restore",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.deletedAt).toBeNull();
  });

  it("restore(id) 非 2xx 抛错", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
    }) as unknown as typeof fetch;

    const client = new TrashClient();
    await expect(client.restore("missing")).rejects.toThrow(/404/);
  });

  it("permanentDelete(id) 调用 DELETE /api/ciphers/:id/permanent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new TrashClient();
    await client.permanentDelete("c1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/ciphers/c1/permanent",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("permanentDelete(id) 非 2xx 抛错", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
    }) as unknown as typeof fetch;

    const client = new TrashClient();
    await expect(client.permanentDelete("missing")).rejects.toThrow(/404/);
  });
});
