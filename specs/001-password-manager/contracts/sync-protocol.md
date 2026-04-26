# 同步协议契约

**Feature**: 密码管理应用  
**Date**: 2026/04/22  
**Version**: 1.0

---

## 1. 设计目标

1. **端到端加密**: 同步数据在传输前后均为加密状态
2. **增量同步**: 仅传输变更数据，减少带宽消耗
3. **离线优先**: 支持完全离线编辑，恢复在线后自动同步
4. **冲突解决**: 采用 last-write-wins，以服务端时间戳为准
5. **最终一致性**: 允许短暂的不一致，最终所有设备数据一致

---

## 2. 同步流程

### 2.1 首次同步（全量）

```
┌─────────┐                              ┌─────────┐
│ 客户端   │                              │ 服务端   │
└────┬────┘                              └────┬────┘
     │                                        │
     │  1. GET /api/sync                      │
     │ ─────────────────────────────────────> │
     │                                        │
     │  2. 返回完整保险库数据                    │
     │ <───────────────────────────────────── │
     │     { profile, ciphers[],               │
     │       domainAssociations[], syncToken } │
     │                                        │
     │  3. 解密数据并缓存到本地                  │
     │  4. 保存 syncToken                       │
     │                                        │
```

**注意**：`domainAssociations[]` 由服务端权威下发，客户端在每次同步时**整体覆盖**本地缓存（不做合并、不进 pending 队列）；增删改通过独立的 `POST/PUT/DELETE /api/domain-associations` 直连接口完成，参见 [api.md §4](./api.md#4-域名关联接口)。本节的 pending 变更队列仅承载凭据（Cipher）数据。

### 2.2 增量同步

```
┌─────────┐                              ┌─────────┐
│ 客户端   │                              │ 服务端   │
└────┬────┘                              └────┬────┘
     │                                        │
     │  1. GET /api/sync?since=<lastSyncTime> │
     │ ─────────────────────────────────────> │
     │                                        │
     │  2. 返回自上次同步以来的变更              │
     │ <───────────────────────────────────── │
     │                                        │
     │  3. 合并到本地缓存                        │
     │  4. 更新 syncToken                       │
     │                                        │
```

### 2.3 推送变更

```
┌─────────┐                              ┌─────────┐
│ 客户端   │                              │ 服务端   │
└────┬────┘                              └────┬────┘
     │                                        │
     │  1. POST /api/sync/push                │
     │     { changes[], lastSyncToken }       │
     │ ─────────────────────────────────────> │
     │                                        │
     │  2. 服务端应用变更，解决冲突              │
     │                                        │
     │  3. 返回接受/拒绝/冲突列表                │
     │ <───────────────────────────────────── │
     │     { accepted[], rejected[],           │
     │       conflicts[], newSyncToken }       │
     │                                        │
     │  4. 处理冲突（如有）                      │
     │  5. 更新 syncToken                       │
     │                                        │
```

---

## 3. 离线编辑与变更队列

### 3.1 本地变更队列

当设备离线时，所有修改写入本地队列：

```typescript
interface PendingChange {
  id: string;              // 队列项唯一 ID
  cipherId: string;        // 关联凭据 ID
  operation: "CREATE" | "UPDATE" | "DELETE";
  encryptedData: string;   // 加密后的完整凭据数据
  clientTimestamp: string; // ISO 8601，客户端变更时间
  retryCount: number;      // 同步重试次数
}
```

### 3.2 恢复在线后同步流程

```
┌──────────────────────────────────────────────────────────┐
│                    恢复在线同步流程                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. 检测网络恢复                                          │
│     ↓                                                    │
│  2. 先执行增量拉取（获取其他设备的变更）                     │
│     ↓                                                    │
│  3. 按时间顺序处理本地变更队列：                            │
│     a. 取出最早的 pending change                           │
│     b. 发送到服务端                                        │
│     c. 如果成功，从队列移除                                │
│     d. 如果冲突（服务端版本更新）：                         │
│        - last-write-wins: 用本地版本覆盖                   │
│        - 再次发送本地版本                                  │
│     e. 如果失败，增加 retryCount，延后重试                 │
│     ↓                                                    │
│  4. 队列清空后，执行最终增量同步                            │
│     ↓                                                    │
│  5. 通知 UI 更新                                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 3.3 队列持久化

- **Edge 插件**: `chrome.storage.local` 存储 pending changes
- **Android**: Room 数据库 `sync_queue` 表
- 应用启动时自动检查队列并尝试同步

---

## 4. 冲突解决策略

### 4.1 Last-Write-Wins

**规则**: 以 `modifiedAt` 时间戳最新的版本为准。

```typescript
function resolveConflict(
  localCipher: Cipher,
  serverCipher: Cipher
): Cipher {
  // 服务端时间戳优先
  if (localCipher.modifiedAt > serverCipher.modifiedAt) {
    return localCipher;  // 推送本地版本
  } else {
    return serverCipher; // 接受服务端版本
  }
}
```

### 4.2 冲突场景处理

| 场景 | 客户端 A | 客户端 B | 结果 |
|------|---------|---------|------|
| 同时修改不同字段 | 修改密码 | 修改用户名 | last-write-wins，后修改者覆盖全部 |
| 一方删除一方修改 | 删除 | 修改密码 | 以时间戳为准，删除操作也有时间戳 |
| 离线后在线同步 | 离线修改 | 在线修改 | 恢复在线后，按队列顺序逐个处理 |

### 4.3 时间戳来源

- **创建/修改时**: 使用客户端本地时间作为初始 `modifiedAt`
- **服务端确认后**: 服务端返回自己的 `modifiedAt`（服务端时间）
- **同步时**: 比较服务端返回的 `modifiedAt` 与本地版本

**注意**: 为减少时钟偏移影响，服务端时间戳作为权威来源。

---

## 5. 实时同步（WebSocket）

### 5.1 连接管理

```javascript
// 建立连接
const ws = new WebSocket(`wss://api.example.com/ws?token=${jwtToken}`);

// 心跳保活
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "PING" }));
  }
}, 30000);
```

### 5.2 消息类型

**服务端 → 客户端**:

| 类型 | 说明 | 示例 |
|------|------|------|
| `SYNC_REQUIRED` | 通知客户端需要同步 | `{"type":"SYNC_REQUIRED","timestamp":"2026-04-22T12:00:00Z"}` |
| `DEVICE_LOGOUT` | 通知当前设备被注销 | `{"type":"DEVICE_LOGOUT","reason":"USER_REQUESTED"}` |
| `PONG` | 心跳响应 | `{"type":"PONG"}` |

**客户端 → 服务端**:

| 类型 | 说明 |
|------|------|
| `PING` | 心跳请求 |

### 5.3 触发 SYNC_REQUIRED 的条件

- 其他设备上传了新凭据
- 其他设备修改了凭据
- 其他设备删除了凭据
- 用户在 Web 端修改了设置

### 5.4 降级策略

如果 WebSocket 连接失败：
1. 自动重连（指数退避）
2. 降级为轮询：每 30 秒执行一次增量同步
3. 应用从后台恢复到前台时，强制执行一次同步

---

## 6. 设备管理

### 6.1 设备注册

首次登录时注册设备：

```json
{
  "deviceId": "<uuid>",
  "deviceType": "BROWSER",
  "deviceName": "Edge on Windows",
  "deviceIdentifier": "<hardware-id-or-fingerprint>"
}
```

### 6.2 设备列表

用户可以在任一设备上查看和管理已登录设备：

```json
{
  "devices": [
    {
      "id": "...",
      "deviceType": "BROWSER",
      "deviceName": "Edge on Windows",
      "lastSyncAt": "2026-04-22T10:00:00Z",
      "isCurrentDevice": true
    },
    {
      "id": "...",
      "deviceType": "ANDROID",
      "deviceName": "Pixel 7",
      "lastSyncAt": "2026-04-22T09:30:00Z",
      "isCurrentDevice": false
    }
  ]
}
```

### 6.3 远程注销

用户可以远程注销其他设备：
- 被注销设备的 JWT Token 加入黑名单
- 通过 WebSocket 通知被注销设备（如在线）
- 被注销设备下次请求时收到 401，清除本地数据并退出

---

## 7. 数据完整性

### 7.1 校验和

每条同步记录包含校验和，防止传输 corruption：

```typescript
interface SyncPayload {
  ciphers: Cipher[];
  checksum: string;  // SHA-256(ciphers.map(c => c.id + c.modifiedAt).join(""))
}
```

### 7.2 版本向量（可选扩展）

对于更复杂的冲突解决，可引入版本向量：

```json
{
  "id": "cipher-uuid",
  "version": {
    "device-a": 5,
    "device-b": 3
  }
}
```

**当前版本暂不实现**，使用简单的 last-write-wins。

---

## 8. 性能优化

### 8.1 批量同步

- 单次推送最多 100 条变更
- 超出限制时分批发送
- 服务端返回每批的处理结果

### 8.2 压缩

- 请求/响应体启用 gzip 压缩
- 加密后的数据本身不可压缩，但 JSON 结构可以压缩

### 8.3 懒加载

- 首次同步全量数据
- 后续仅同步变更
- 大型附件（如 Passkey 凭证）可延迟加载

---

## 9. 错误处理

### 9.1 同步失败重试策略

| 错误码 | 重试策略 |
|--------|----------|
| 网络错误 | 指数退避，最多 5 次 |
| 401 Unauthorized | 尝试刷新 Token，失败后要求重新登录 |
| 409 Conflict | 立即重试（使用服务端返回的最新状态） |
| 429 Rate Limited | 等待 Retry-After 头指定的时间 |
| 500+ | 指数退避，最多 3 次 |

### 9.2 同步状态通知

```typescript
interface SyncStatus {
  state: "IDLE" | "SYNCING" | "ERROR" | "OFFLINE";
  lastSyncAt: string | null;
  pendingChanges: number;
  error: string | null;
}
```

---

## 10. 安全注意事项

1. **同步数据始终加密**: 即使 HTTPS 被攻破，攻击者也无法解密保险库数据
2. **Token 安全**: JWT 存储在安全的存储中（Android Keystore / browser secure storage）
3. **防止重放攻击**: 每次请求携带唯一 nonce，服务端拒绝重复 nonce
4. **设备指纹**: 设备注册时记录设备指纹，异常设备触发额外验证
