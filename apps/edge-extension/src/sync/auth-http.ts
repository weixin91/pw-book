// 带认证的 HTTP 请求封装
// 自动注入 Bearer Token，处理 401 刷新与登出

import { StorageService } from "../platform/storage.js";
import type { RefreshResponse } from "@pwbook/shared-types";

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function doRefreshAccessToken(): Promise<boolean> {
  const profile = await StorageService.getProfile();
  if (!profile?.refreshToken) return false;

  try {
    const baseUrl = await StorageService.getServerUrl();
    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: profile.refreshToken }),
    });

    if (!response.ok) return false;

    const data = (await response.json()) as RefreshResponse;
    await StorageService.setProfile({
      ...profile,
      token: data.token,
      refreshToken: data.refreshToken,
    });
    return true;
  } catch {
    return false;
  }
}

export async function refreshAccessToken(): Promise<boolean> {
  if (isRefreshing) {
    return refreshPromise!;
  }
  isRefreshing = true;
  refreshPromise = doRefreshAccessToken();
  try {
    return await refreshPromise;
  } finally {
    isRefreshing = false;
    refreshPromise = null;
  }
}

export async function handleAuthFailure(): Promise<void> {
  await StorageService.clearProfile();
  await StorageService.setSyncStatus({
    state: "OFFLINE",
    lastSyncAt: null,
    pendingChanges: 0,
    error: "登录已过期，请重新登录",
  });
  try {
    await chrome.runtime.sendMessage({ type: "AUTH_LOGOUT" });
  } catch {
    // 没有接收者时忽略
  }
}

export async function fetchWithAuth(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const profile = await StorageService.getProfile();
  const token = profile?.token || "";

  // 复制并注入 Authorization 头
  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  let response = await fetch(url, {
    ...options,
    headers,
  });

  // 401 时尝试刷新 token 并重试一次
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const newProfile = await StorageService.getProfile();
      headers.set("Authorization", `Bearer ${newProfile?.token || ""}`);
      response = await fetch(url, {
        ...options,
        headers,
      });
    } else {
      await handleAuthFailure();
      const error = new Error("登录已过期，请重新登录");
      (error as Error & { code?: string }).code = "AUTH_EXPIRED";
      throw error;
    }
  }

  return response;
}
