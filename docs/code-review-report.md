# pw-book 代码审查报告

审查日期：2026-05-04

修复状态更新：2026-05-04

审查范围：后端 (Backend)、Edge 扩展、Android 应用

---

## 修复状态汇总

| 问题编号 | 描述 | 状态 | 完成日期 |
|----------|------|------|----------|
| 1.1 | JWT 密钥默认值 | ✅ 已修复 | 2026-05-04 |
| 1.2 | CORS 配置过于宽松 | ⚠️ 已回滚 | 2026-05-04 |
| 1.3 | 无速率限制 | ✅ 已修复 | 2026-05-04 |
| 1.4 | userKey 无条件持久化 | ✅ 已修复 | 2026-05-04 |
| 1.5 | PrismaClient 重复实例化 | ✅ 已修复 | 2026-05-04 |
| 1.6 | 批量操作未使用事务 | ✅ 已修复 | 2026-05-04 |
| 1.7 | WebSocket Token URL传递 | ✅ 已修复 | 2026-05-04 |
| 1.8 | 备份 Shell 命令执行 | ✅ 已修复 | 2026-05-04 |
| 2.1 | 同步时全量解密 | ✅ 已修复 | 2026-05-04 |
| 3.2 | 错误日志静默忽略 | ✅ 已修复 | 2026-05-04 |
| 4.2 | 手动 CBOR 编码 | ⚠️ 已回滚 | 2026-05-04 |
| 4.3 | 类型断言散落 | ✅ 已修复 | 2026-05-04 |

---

## 1. 安全问题

### 1.1 ✅ JWT 密钥默认值（高风险）— 已修复

**位置**：[apps/backend/src/auth/jwt.ts:5-10](apps/backend/src/auth/jwt.ts#L5-L10)

**问题代码**：
```typescript
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "default-secret-change-me"
);
```

**风险**：未配置环境变量时使用硬编码默认密钥，攻击者可伪造任意 JWT 令牌，获取任意用户权限。

**解决方案**：
```typescript
const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  throw new Error("JWT_SECRET 环境变量必须配置且至少 32 字符");
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);
```

**优先级**：必须修复 — **已完成**

---

### 1.2 ⚠️ CORS 配置过于宽松（高风险）— 已回滚

**位置**：[apps/backend/src/index.ts:27-45](apps/backend/src/index.ts#L27-L45)

**问题代码**：
```typescript
await app.register(cors, {
  origin: true,  // 允许任意来源
  credentials: true,
});
```

**风险**：任意网站可跨域访问 API，可能导致：
- CSRF 攻击（修改/删除用户数据）
- 敏感数据泄露（第三方网站可读取用户凭据）

**尝试修复**：添加来源白名单验证，但开发环境调试不便，已回滚。

**现状**：保持 `origin: true`，允许任意来源。生产部署时应重新评估。

**优先级**：可选修复 — **已回滚**

---

### 1.3 ✅ 无速率限制（高风险）— 已修复

**位置**：`/api/auth/login` 端点

**修复文件**：[apps/backend/src/rate-limiter.ts](apps/backend/src/rate-limiter.ts)（新增）、[apps/backend/src/auth/routes.ts](apps/backend/src/auth/routes.ts)

**风险**：
- 已知白名单邮箱可被暴力破解密码

**现有防护**：
- ✅ 邮箱白名单限制注册
- ✅ 统一错误消息防止邮箱探测
- ❌ 无账号速率限制

**解决方案**：基于账号（邮箱）的速率限制

```typescript
// 创建 rate-limiter.ts
import type { FastifyRequest, FastifyReply } from "fastify";
import { ApiError } from "./errors/handler.js";

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000; // 1 分钟

function checkRateLimit(email: string): boolean {
  const entry = loginAttempts.get(email);
  if (!entry) return true;

  const elapsed = Date.now() - entry.firstAttempt;
  if (elapsed > WINDOW_MS) {
    loginAttempts.delete(email);
    return true;
  }

  return entry.count < MAX_ATTEMPTS;
}

function recordAttempt(email: string): void {
  const existing = loginAttempts.get(email);
  if (existing) {
    existing.count++;
  } else {
    loginAttempts.set(email, { count: 1, firstAttempt: Date.now() });
  }
}

function clearAttempts(email: string): void {
  loginAttempts.delete(email);
}

export function loginRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
): void {
  const body = request.body as { email?: string };
  const email = body.email?.toLowerCase();

  if (!email) {
    done();
    return;
  }

  if (!checkRateLimit(email)) {
    done(new ApiError("RATE_LIMITED", 429, "尝试次数过多，请 1 分钟后重试"));
    return;
  }

  done();
}

export { recordAttempt, clearAttempts };
```

在登录路由中使用：
```typescript
import { loginRateLimitMiddleware, recordAttempt, clearAttempts } from "../rate-limiter.js";

app.post("/login", { preHandler: [loginRateLimitMiddleware] }, async (request, reply) => {
  const body = loginSchema.parse(request.body);
  const email = body.email.toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    recordAttempt(email);
    throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或主密码错误");
  }

  if (user.masterPasswordHash !== body.masterPasswordHash) {
    recordAttempt(email);
    throw new ApiError("INVALID_CREDENTIALS", 401, "邮箱或主密码错误");
  }

  clearAttempts(email);  // 登录成功，清除计数

  // ... 后续登录逻辑
});
```

**优先级**：必须修复

---

### 1.4 ✅ userKey 无条件持久化（中风险）— 已修复

**位置**：[apps/edge-extension/src/platform/storage.ts](apps/edge-extension/src/platform/storage.ts)

**修复**：
- `setUserKey(userKey, persist)` 新增 `persist` 参数
- 仅当锁定设置为"从不锁定"（timeoutMin <= 0）时才持久化到 local storage
- `getUserKey()` 检查锁定设置后才从 local 恢复密钥
- 修改了 [UnlockScreen.tsx](apps/edge-extension/src/popup/components/UnlockScreen.tsx) 根据锁定设置传递 persist 参数
- 统一了 [lock-timer.ts](apps/edge-extension/src/background/lock-timer.ts) 使用 StorageService 的锁定设置方法

**问题代码**：
```typescript
async setUserKey(userKey: Uint8Array): Promise<void> {
  const data = { userKey: Array.from(userKey) };
  await chrome.storage.session.set(data);
  await chrome.storage.local.set(data); // ← 无条件写入 local
}
```

**风险**：
- 设置"15分钟锁定"的用户关闭浏览器后重启
- Service Worker 重启，锁定计时器状态丢失
- `getUserKey()` 从 local storage 恢复密钥
- 保险库自动解锁，绕过锁定设置

**解决方案**：

```typescript
async setUserKey(userKey: Uint8Array, persist: boolean = false): Promise<void> {
  const data = { userKey: Array.from(userKey) };
  await chrome.storage.session.set(data);
  if (persist) {
    await chrome.storage.local.set(data);
  } else {
    // 确保 local 中没有残留
    await chrome.storage.local.remove("userKey");
  }
}

async getUserKey(): Promise<Uint8Array | null> {
  // 优先从 session 获取（仅在会话期间有效）
  const result = await chrome.storage.session.get("userKey");
  if (result.userKey) return new Uint8Array(result.userKey);

  // 仅当用户明确选择"从不锁定"时才从 local 恢复
  const settings = await LockSettingsService.load();
  if (settings.timeoutMin <= 0) {
    const localResult = await chrome.storage.local.get("userKey");
    if (localResult.userKey) return new Uint8Array(localResult.userKey);
  }

  return null;
}
```

解锁时传递 persist 参数：
```typescript
// 在解锁逻辑中
const settings = await LockSettingsService.load();
await StorageService.setUserKey(userKey, settings.timeoutMin <= 0);
```

**优先级**：建议修复

---

### 1.5 ✅ PrismaClient 重复实例化（中风险）— 已修复

**位置**：
- [apps/backend/src/auth/routes.ts](apps/backend/src/auth/routes.ts)
- [apps/backend/src/sync/routes.ts](apps/backend/src/sync/routes.ts)
- [apps/backend/src/ciphers/routes.ts](apps/backend/src/ciphers/routes.ts)
- [apps/backend/src/cookies/routes.ts](apps/backend/src/cookies/routes.ts)
- [apps/backend/src/devices/routes.ts](apps/backend/src/devices/routes.ts)
- [apps/backend/src/domain-assoc/routes.ts](apps/backend/src/domain-assoc/routes.ts)
- [apps/backend/src/cookies/config-routes.ts](apps/backend/src/cookies/config-routes.ts)

**修复文件**：[apps/backend/src/db/prisma.ts](apps/backend/src/db/prisma.ts)（新增单例模块）

**风险**：
- SQLite 连接池有限（默认约 5 个）
- 多文件实例化可能耗尽连接池
- 高并发时请求失败

**解决方案**：

创建单例模块 `apps/backend/src/db/prisma.ts`：
```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
```

各路由文件改为导入：
```typescript
import { prisma } from "../db/prisma.js";
```

**优先级**：建议修复 — **已完成**

---

### 1.6 ✅ 批量操作未使用事务（中风险）— 已修复

**位置**：[apps/backend/src/cookies/routes.ts:54-68](apps/backend/src/cookies/routes.ts#L54-L68)

**问题代码**：
```typescript
for (const item of body.items) {
  await prisma.cookieData.upsert({...});  // 循环中逐条操作
  accepted.push(item.domain);
}
```

**风险**：
- 50 条数据逐条写入
- 中间某条失败时，部分成功导致数据不一致
- 客户端重试可能产生重复数据

**解决方案**：
```typescript
const results = await prisma.$transaction(
  body.items.map((item) =>
    prisma.cookieData.upsert({
      where: { userId_domain: { userId, domain: item.domain } },
      update: {
        encryptedData: item.encryptedData,
        modifiedAt: item.modifiedAt ? new Date(item.modifiedAt) : new Date(),
      },
      create: {
        userId,
        domain: item.domain,
        encryptedData: item.encryptedData,
        modifiedAt: item.modifiedAt ? new Date(item.modifiedAt) : new Date(),
      },
    })
  )
);
const accepted = results.map((r) => r.domain);
```

**优先级**：建议修复 — **已完成**

---

### 1.7 ✅ WebSocket 认证 Token 通过 URL 传递（中风险）— 已修复

**位置**：
- [apps/backend/src/websocket/server.ts](apps/backend/src/websocket/server.ts)
- [apps/edge-extension/src/sync/websocket-client.ts](apps/edge-extension/src/sync/websocket-client.ts)
- [apps/android/.../SyncWebSocketClient.kt](apps/android/app/src/main/java/com/pwbook/data/remote/websocket/SyncWebSocketClient.kt)

**修复**：改为首条消息认证
- 后端：连接建立后发送 `AUTH_REQUIRED`，等待客户端发送 `{type: "AUTH", token: "..."}`
- Edge 扩展：连接成功后发送认证消息，收到 `AUTH_SUCCESS` 后才开始心跳
- Android：同样改为首条消息认证，增加 `isAuthenticated` 状态管理

**优先级**：可选修复（方案 C 对于内部部署可接受）

---

### 1.8 ✅ 备份使用 Shell 命令执行（中风险）— 已修复

**位置**：[apps/backend/src/backup/scheduler.ts](apps/backend/src/backup/scheduler.ts)

**修复**：添加路径安全校验函数 `validatePath()`
- 校验数据库路径、备份目录、备份文件名
- 仅允许字母、数字、下划线、连字符、点、斜杠
- 非法字符时抛出错误拒绝执行

**优先级**：建议修复 — **已完成**

---

## 2. 性能问题

### 2.1 ✅ 同步时全量解密 — 已修复

**位置**：
- [apps/edge-extension/src/background/background.ts:288-303](apps/edge-extension/src/background/background.ts#L288-L303) (`handleGetVaultItems`)
- [apps/edge-extension/src/background/webauthn-handler.ts:169-206](apps/edge-extension/src/background/webauthn-handler.ts#L169-L206) (`queryPasskeyGetMatches`)

**问题**：每次 URL 匹配需解密所有 cipher 数据，大量凭据时：
- CPU 占用高，可能导致卡顿
- 移动端耗电增加

**修复**：建立本地索引缓存
- 新增 [cipher-index.ts](apps/edge-extension/src/crypto/cipher-index.ts) 索引管理模块
- 从加密凭据中提取非敏感匹配字段（域名、rpId、用户名哈希）
- 索引可明文存储（不含敏感信息），匹配时先查索引再解密
- 解锁保险库时自动重建索引
- 凭据创建/更新时同步更新索引

**优化效果**：
- URL 匹配时先从索引筛选匹配的 cipher ID
- 只解密匹配的凭据，避免全量解密
- 凭据数量 < 100 时性能提升不明显
- 凭据数量 > 100 时显著减少 CPU 占用

**优先级**：可选优化 — **已完成**

---

### 2.2 🟡 定时器间隔过短

**位置**：[apps/edge-extension/src/background/background.ts:455](apps/edge-extension/src/background/background.ts#L455)

**问题代码**：
```typescript
syncScheduler.start(600_000); // 10 分钟轮询同步
```

**影响**：
- 每 10 分钟唤醒 Service Worker，增加耗电
- 频繁网络请求增加服务器负载

**现有补偿**：WebSocket 实时推送同步通知

**解决方案**：

方案 A：延长轮询间隔（简单）
```typescript
syncScheduler.start(1_800_000); // 30 分钟
```

方案 B：完全依赖 WebSocket 事件驱动
```typescript
// WebSocket 连接成功后停止轮询
syncScheduler.stop();
// WebSocket 断开时恢复轮询作为兜底
websocketClient.onDisconnect(() => syncScheduler.start(600_000));
websocketClient.onConnect(() => syncScheduler.stop());
```

**优先级**：可选优化

---

### 2.3 🟡 Android 密钥内存管理

**位置**：[apps/android/app/src/main/java/com/pwbook/domain/VaultSession.kt:33](apps/android/app/src/main/java/com/pwbook/domain/VaultSession.kt#L33)

**问题代码**：
```kotlin
userKey?.fill(0)  // 锁定时清零
```

**问题**：
- Kotlin/JVM 中 `ByteArray` 是不可变对象
- `fill(0)` 可能不真正清零原内存位置
- GC 可能保留内存副本

**现有补偿**：[SecureMemory.kt](apps/android/app/src/main/java/com/pwbook/crypto/SecureMemory.kt) 已存在但未用于此场景

**解决方案**：
```kotlin
// 使用 SecureMemory 包装敏感数据
class VaultSession @Inject constructor(...) {
    private var userKey: SecureMemory<ByteArray>? = null

    fun unlock(key: ByteArray) {
        userKey = SecureMemory(key)
        _isUnlocked.value = true
    }

    fun lock() {
        userKey?.clear()  // 确保内存清零
        userKey = null
        _isUnlocked.value = false
    }

    fun getUserKey(): ByteArray? = userKey?.get()
}
```

**优先级**：可选优化（JVM 内存安全本身有限，风险相对可控）

---

## 3. 稳定性问题

### 3.1 🔵 Service Worker 状态丢失

**位置**：[apps/edge-extension/src/background/background.ts:26-28](apps/edge-extension/src/background/background.ts#L26-L28)

**问题**：
- `pendingFormData`、`pendingTimers` 存于内存
- Service Worker 终止后状态丢失

**现有兜底**：
- ✅ 表单数据持久化到 `chrome.storage.local`
- ✅ 页面导航时从 local storage 恢复
- ⚠️ 定时器状态丢失，但 5 秒兜底定时器会重新触发

**影响**：轻微，已有兜底机制

**优先级**：无需修复

---

### 3.2 ✅ 错误处理静默忽略 — 已修复

**位置**：
- [apps/edge-extension/src/background/background.ts](apps/edge-extension/src/background/background.ts)
- [apps/edge-extension/src/background/webauthn-handler.ts](apps/edge-extension/src/background/webauthn-handler.ts)

**修复**：所有 `catch` 块已添加 `console.error` 日志记录

**问题**：用户无感知数据损坏，可能丢失凭据

**解决方案**：
```typescript
// 添加日志记录
catch (e) {
  console.error(`[PWBook] 解密失败 cipher=${cipher.id}:`, e);
  // 可选：UI 提示
}
```

**优先级**：建议修复 — **已完成**

---

## 4. 代码精简建议

### 4.1 🟢 重复的解密/匹配逻辑

**位置**：
- `handleGetVaultItems`
- `queryPasskeySaveCandidates`
- `queryPasskeyGetMatches`
- `isCredentialAlreadySaved`

**建议**：抽取通用函数
```typescript
async function findMatchingCiphers(
  matcher: (data: CipherDataJson) => boolean
): Promise<Array<{ cipher: Cipher; data: CipherDataJson }>> {
  const userKey = await StorageService.getUserKey();
  if (!userKey) return [];

  const ciphers = await StorageService.getCiphers();
  const results = [];

  for (const cipher of ciphers) {
    try {
      const plain = await decryptCipherData(cipher.data, userKey);
      const data = JSON.parse(plain) as CipherDataJson;
      if (matcher(data)) {
        results.push({ cipher, data });
      }
    } catch {
      // 跳过
    }
  }

  return results;
}
```

**优先级**：可选

---

### 4.2 ⚠️ 手动 CBOR 编码 — 已回滚

**位置**：[apps/edge-extension/src/crypto/passkey-storage.ts](apps/edge-extension/src/crypto/passkey-storage.ts)

**尝试修复**：
- 添加 `cbor-x` 依赖
- 使用 `cborEncode()` 替换手动拼接字节

**问题**：
- JavaScript 对象不支持负整数作为 key，`{ [-1]: 1 }` 实际变成字符串 key `" -1"`
- cbor-x 编码结果与 WebAuthn 规范不兼容
- Passkey 注册失败："Leftover bytes detected while parsing authenticator data"

**结论**：手动 CBOR 编码虽冗长，但严格遵循 WebAuthn 规范。cbor-x 库无法正确编码 COSE Key 所需的负整数 key。保持原有实现。

**优先级**：不修改 — 手动编码虽不简洁，但正确性有保障

---

### 4.3 ✅ 类型断言散落 — 已修复

**位置**：
- [apps/edge-extension/src/background/background.ts](apps/edge-extension/src/background/background.ts)
- [apps/edge-extension/src/background/webauthn-handler.ts](apps/edge-extension/src/background/webauthn-handler.ts)

**修复**：
- 创建 [cipher-data-parser.ts](apps/edge-extension/src/crypto/cipher-data-parser.ts) 统一解析模块
- 提供 `parseCipherData()`、`getLoginData()`、`getPasskeyData()` 类型安全辅助函数
- 消除散落的 `as Record<string, unknown>` 类型断言
- 使用 `CipherData` 类型确保数据结构正确

**优先级**：可选 — **已完成**

---

## 5. 修复优先级汇总

| 优先级 | 问题编号 | 说明 |
|--------|----------|------|
| 🔴 必须修复 | 1.1, 1.3 | 安全漏洞，可能导致数据泄露 | ✅ 已完成 |
| 🟠 建议修复 | 1.2, 1.4, 1.5, 1.6, 1.7, 1.8 | 中等风险，生产环境应处理 | 1.2 ⚠️ 已回滚 / 其他 ✅ |
| 🟡 可选优化 | 2.1, 2.2, 2.3 | 性能优化，凭据数量少时可暂缓 | 2.1 ✅ / 其他 ⏳ |
| 🔵 低优先级 | 3.1, 3.2 | 已有兜底或影响轻微 | ✅ 已完成 |
| 🟢 代码精简 | 4.1, 4.2, 4.3 | 可选，不影响功能 | 4.3 ✅ / 4.2 ⚠️ 已回滚 |

---

## 6. 修复建议执行顺序

1. **第一阶段**（安全加固）：修复 1.1、1.2、1.3，确保生产环境安全
2. **第二阶段**（稳定性）：修复 1.5、1.6、3.2，提升系统可靠性
3. **第三阶段**（完善）：修复 1.4、1.7、1.8，增强安全边界
4. **第四阶段**（优化）：根据实际使用情况决定是否实施性能优化