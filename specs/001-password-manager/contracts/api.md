# API 契约文档

**Feature**: 密码管理应用  
**Base URL**: `https://api.pwbook.example.com`  
**Auth**: JWT Bearer Token (`Authorization: Bearer <token>`)

---

## 1. 认证接口

### 1.1 注册

```http
POST /api/auth/register
Content-Type: application/json
```

**Request Body**:
```json
{
  "email": "user@example.com",
  "masterPasswordHash": "<kdf-derived-hash-base64>",
  "protectedKey": "<encrypted-user-key-base64>",
  "publicKey": "<rsa-public-key-base64>",
  "encryptedPrivateKey": "<encrypted-private-key-base64>",
  "kdfType": "ARGON2ID",
  "kdfIterations": 3,
  "kdfMemory": 65536,
  "kdfParallelism": 4,
  "recoveryKeyHash": "<recovery-key-hash-base64>",
  "encryptedRecoveryKey": "<encrypted-user-key-with-recovery-key-base64>"
}
```

**Response 201**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "token": "<jwt-access-token>",
  "refreshToken": "<jwt-refresh-token>",
  "protectedKey": "<encrypted-user-key-base64>"
}
```

**Response 400**: 邮箱已存在或参数无效
**Response 422**: KDF 参数超出允许范围

---

### 1.2 登录

```http
POST /api/auth/login
Content-Type: application/json
```

**Request Body**:
```json
{
  "email": "user@example.com",
  "masterPasswordHash": "<kdf-derived-hash-base64>",
  "deviceId": "<device-uuid>",
  "deviceType": "BROWSER",
  "deviceName": "Edge on Windows"
}
```

**Response 200**:
```json
{
  "token": "<jwt-access-token>",
  "refreshToken": "<jwt-refresh-token>",
  "protectedKey": "<encrypted-user-key-base64>",
  "securityStamp": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response 401**: 主密码错误或账户不存在

---

### 1.3 刷新 Token

```http
POST /api/auth/refresh
Content-Type: application/json
```

**Request Body**:
```json
{
  "refreshToken": "<jwt-refresh-token>"
}
```

**Response 200**:
```json
{
  "token": "<new-jwt-access-token>",
  "refreshToken": "<new-jwt-refresh-token>"
}
```

---

### 1.4 恢复密钥重置主密码

```http
POST /api/auth/recover
Content-Type: application/json
```

**Request Body**:
```json
{
  "email": "user@example.com",
  "recoveryKey": "<recovery-key-string>",
  "newMasterPasswordHash": "<new-kdf-hash-base64>",
  "newProtectedKey": "<new-encrypted-user-key-base64>"
}
```

**Response 200**:
```json
{
  "token": "<jwt-access-token>",
  "refreshToken": "<jwt-refresh-token>"
}
```

**Response 401**: 恢复密钥无效

---

## 2. 同步接口

### 2.1 获取同步数据

```http
GET /api/sync?since=<iso-timestamp>
Authorization: Bearer <token>
```

**Query Parameters**:
| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `since` | ISO 8601 | 否 | 上次同步时间，用于增量同步 |

**Response 200**:
```json
{
  "profile": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "kdfType": "ARGON2ID",
    "kdfIterations": 3,
    "kdfMemory": 65536,
    "kdfParallelism": 4,
    "publicKey": "<rsa-public-key-base64>",
    "securityStamp": "550e8400-e29b-41d4-a716-446655440000"
  },
  "ciphers": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "type": 1,
      "data": "<encrypted-json-base64>",
      "favorite": false,
      "reprompt": 0,
      "createdAt": "2026-04-20T10:00:00Z",
      "modifiedAt": "2026-04-21T08:30:00Z"
    }
  ],
  "domainAssociations": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "domains": ["example.com", "example.org"],
      "packageNames": ["com.example.app"],
      "createdAt": "2026-04-20T10:00:00Z"
    }
  ],
  "syncToken": "<opaque-sync-token>"
}
```

**注意**: `ciphers.data` 为加密后的 JSON，服务端不解密。

---

### 2.2 上传变更

```http
POST /api/sync/push
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "changes": [
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "type": "UPDATE",
      "cipher": {
        "id": "660e8400-e29b-41d4-a716-446655440001",
        "type": 1,
        "data": "<encrypted-json-base64>",
        "favorite": false,
        "reprompt": 0,
        "modifiedAt": "2026-04-22T12:00:00Z"
      },
      "clientTimestamp": "2026-04-22T12:00:00Z"
    }
  ],
  "lastSyncToken": "<opaque-sync-token>"
}
```

**Response 200**:
```json
{
  "accepted": ["660e8400-e29b-41d4-a716-446655440001"],
  "rejected": [],
  "conflicts": [],
  "newSyncToken": "<new-opaque-sync-token>"
}
```

**冲突处理**: 服务端采用 last-write-wins。如果服务端版本更新，返回 `conflicts` 列表，客户端应根据策略处理。

---

## 3. 凭据管理接口

### 3.1 创建凭据

```http
POST /api/ciphers
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "type": 1,
  "data": "<encrypted-json-base64>",
  "favorite": false,
  "reprompt": 0,
  "modifiedAt": "2026-04-22T12:00:00Z"
}
```

**Response 201**: 返回创建的凭据对象（含服务端时间戳）

---

### 3.2 更新凭据

```http
PUT /api/ciphers/:id
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**: 同创建，不含 `id`

**Response 200**: 返回更新后的凭据对象
**Response 409**: 存在冲突（服务端版本更新），返回服务端当前版本

---

### 3.3 删除凭据

```http
DELETE /api/ciphers/:id
Authorization: Bearer <token>
```

**Response 204**: 删除成功
**Response 404**: 凭据不存在

---

### 3.4 获取单个凭据

```http
GET /api/ciphers/:id
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "type": 1,
  "data": "<encrypted-json-base64>",
  "favorite": false,
  "reprompt": 0,
  "createdAt": "2026-04-20T10:00:00Z",
  "modifiedAt": "2026-04-21T08:30:00Z"
}
```

---

## 4. 域名关联接口

### 4.1 创建关联规则

```http
POST /api/domain-associations
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "domains": ["baidu.com", "tieba.baidu.com"],
  "packageNames": ["com.baidu.tieba"]
}
```

**Response 201**: 返回创建的关联规则

---

### 4.2 获取所有关联规则

```http
GET /api/domain-associations
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "data": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440002",
      "domains": ["baidu.com", "tieba.baidu.com"],
      "packageNames": ["com.baidu.tieba"],
      "createdAt": "2026-04-20T10:00:00Z"
    }
  ]
}
```

---

### 4.3 更新关联规则

```http
PUT /api/domain-associations/:id
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**（`domains` 与 `packageNames` 均为可选字段，未传则保持原值）:
```json
{
  "domains": ["baidu.com", "tieba.baidu.com", "pan.baidu.com"],
  "packageNames": ["com.baidu.tieba"]
}
```

**Response 200**:
```json
{
  "id": "770e8400-e29b-41d4-a716-446655440002",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "domains": ["baidu.com", "tieba.baidu.com", "pan.baidu.com"],
  "packageNames": ["com.baidu.tieba"],
  "createdAt": "2026-04-20T10:00:00Z"
}
```

**Response 404**: 关联规则不存在或不属于当前用户

---

### 4.4 删除关联规则

```http
DELETE /api/domain-associations/:id
Authorization: Bearer <token>
```

**Response 204**

---

### 4.5 域名关联与凭据 URI 的关系

> **重要**：单个凭据自身保存的可填充域名/包名列表存放在 `Cipher.data.login.uris[]` 中（每项格式为 `{ uri, match }`），由客户端在编辑界面维护，不通过本接口管理。
>
> 本节接口仅维护「跨基础域名」「网站 ↔ Android APP」之间的**联动关系**，例如把 `baidu.com` 与 `com.baidu.tieba` 互相关联，使两者下保存的凭据在自动填充候选列表中互通显示。具体匹配算法见 [data-model.md §2.4](../data-model.md#24-domain-association域名关联规则)。

---

## 5. Cookie 同步接口（仅 Edge 插件）

Cookie 同步数据按域名独立存储，每条记录包含该域名下完整的 Cookie 列表（可选 localStorage）。数据在客户端用 User Key 加密，服务端不解密。

### 5.1 上传/覆盖某域名 Cookie

```http
POST /api/cookies
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "domain": "example.com",
  "encryptedData": "<encrypted-cookie-json-base64>",
  "modifiedAt": "2026-04-22T12:00:00Z"
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `domain` | String | 是 | 基础域名（如 `example.com`） |
| `encryptedData` | String | 是 | 加密后的 CookieData JSON（含 gzip 压缩） |
| `modifiedAt` | ISO 8601 | 是 | 客户端变更时间 |

**Response 201**:
```json
{
  "id": "990e8400-e29b-41d4-a716-446655440005",
  "domain": "example.com",
  "encryptedData": "<encrypted-cookie-json-base64>",
  "modifiedAt": "2026-04-22T12:00:00Z"
}
```

**行为**: 若该用户下已存在相同 `domain` 的记录，则覆盖（last-write-wins）。

---

### 5.2 批量上传多域名 Cookie

```http
POST /api/cookies/batch
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "items": [
    {
      "domain": "example.com",
      "encryptedData": "<encrypted-cookie-json-base64>",
      "modifiedAt": "2026-04-22T12:00:00Z"
    },
    {
      "domain": "another.com",
      "encryptedData": "<encrypted-cookie-json-base64>",
      "modifiedAt": "2026-04-22T12:00:00Z"
    }
  ]
}
```

**Response 200**:
```json
{
  "accepted": ["example.com", "another.com"],
  "rejected": [],
  "newSyncToken": "<opaque-sync-token>"
}
```

**用途**: 自动同步（autoPush）时，若多个域名的 Cookie 在防抖窗口内同时变化，批量提交以提高效率。

---

### 5.3 获取某域名 Cookie

```http
GET /api/cookies/:domain
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "id": "990e8400-e29b-41d4-a716-446655440005",
  "domain": "example.com",
  "encryptedData": "<encrypted-cookie-json-base64>",
  "modifiedAt": "2026-04-22T12:00:00Z"
}
```

**Response 404**: 该域名无同步记录

---

### 5.4 获取全部 Cookie 同步列表

```http
GET /api/cookies
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "data": [
    {
      "id": "990e8400-e29b-41d4-a716-446655440005",
      "domain": "example.com",
      "encryptedData": "<encrypted-cookie-json-base64>",
      "modifiedAt": "2026-04-22T12:00:00Z"
    }
  ],
  "syncToken": "<opaque-sync-token>"
}
```

**用途**: Edge 插件启动时全量拉取所有已同步域名的 Cookie 列表。

---

### 5.5 删除某域名 Cookie

```http
DELETE /api/cookies/:domain
Authorization: Bearer <token>
```

**Response 204**

---

### 5.6 Cookie 同步规则配置

#### 5.6.1 创建/更新规则

```http
PUT /api/cookie-sync-config/:domain
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "autoPush": true,
  "autoPull": false,
  "includeLocalStorage": false
}
```

**Response 200**:
```json
{
  "id": "aa0e8400-e29b-41d4-a716-446655440006",
  "domain": "example.com",
  "autoPush": true,
  "autoPull": false,
  "includeLocalStorage": false,
  "createdAt": "2026-04-22T10:00:00Z",
  "modifiedAt": "2026-04-22T12:00:00Z"
}
```

#### 5.6.2 获取所有规则

```http
GET /api/cookie-sync-config
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "data": [
    {
      "id": "aa0e8400-e29b-41d4-a716-446655440006",
      "domain": "example.com",
      "autoPush": true,
      "autoPull": false,
      "includeLocalStorage": false,
      "createdAt": "2026-04-22T10:00:00Z",
      "modifiedAt": "2026-04-22T12:00:00Z"
    }
  ]
}
```

#### 5.6.3 删除规则

```http
DELETE /api/cookie-sync-config/:domain
Authorization: Bearer <token>
```

**Response 204**

---

## 6. 拒绝保存记录接口（本地存储，可选同步）

### 6.1 记录拒绝保存

```http
POST /api/rejected-sites
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "domain": "example.com"
}
```

**Response 201**:
```json
{
  "id": "990e8400-e29b-41d4-a716-446655440004",
  "domain": "example.com",
  "rejectedAt": "2026-04-22T12:00:00Z",
  "expireAt": "2026-05-22T12:00:00Z"
}
```

**注意**: 该接口主要用于多端同步拒绝记录，确保用户在 Edge 拒绝后，Android 也不提示。如不需要跨端同步，可完全本地实现。

---

### 6.2 获取拒绝记录列表

```http
GET /api/rejected-sites
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "data": [
    {
      "id": "990e8400-e29b-41d4-a716-446655440004",
      "domain": "example.com",
      "rejectedAt": "2026-04-22T12:00:00Z",
      "expireAt": "2026-05-22T12:00:00Z"
    }
  ]
}
```

---

### 6.3 删除拒绝记录

```http
DELETE /api/rejected-sites/:id
Authorization: Bearer <token>
```

**Response 204**

---

## 7. 设备管理接口

### 7.1 获取已注册设备

```http
GET /api/devices
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "data": [
    {
      "id": "880e8400-e29b-41d4-a716-446655440003",
      "deviceId": "browser-abc123",
      "deviceType": "BROWSER",
      "deviceName": "Edge on Windows",
      "lastSyncAt": "2026-04-22T10:00:00Z",
      "createdAt": "2026-04-20T10:00:00Z"
    }
  ]
}
```

---

### 7.2 注销设备

```http
DELETE /api/devices/:id
Authorization: Bearer <token>
```

**Response 204**

---

## 8. 实时同步（WebSocket）

### 8.1 连接

```javascript
const ws = new WebSocket('wss://api.pwbook.example.com/ws?token=<jwt>');
```

### 8.2 服务端推送消息

```json
{
  "type": "SYNC_REQUIRED",
  "timestamp": "2026-04-22T12:00:00Z"
}
```

客户端收到后应触发增量同步。

---

## 9. 错误响应格式

所有错误响应统一格式：

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or master password",
    "details": {}
  }
}
```

**错误码列表**:

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `INVALID_CREDENTIALS` | 401 | 邮箱或主密码错误 |
| `TOKEN_EXPIRED` | 401 | JWT Token 已过期 |
| `INVALID_TOKEN` | 401 | JWT Token 无效 |
| `RESOURCE_NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 数据冲突（last-write-wins） |
| `VALIDATION_ERROR` | 422 | 参数验证失败 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

---

## 9. 枚举定义

### CipherType

| 值 | 名称 | 说明 |
|----|------|------|
| 1 | `LOGIN` | 登录凭据 |
| 2 | `CARD` | 银行卡 |
| 3 | `IDENTITY` | 身份信息 |
| 4 | `SECURE_NOTE` | 安全笔记 |
| 5 | `PASSKEY` | Passkey 凭据（独立类型）。**Edge 端实现**：Passkey 数据作为 `type=1` (LOGIN) 凭据的 `data.passkey` 附加字段存储，与同一站点的用户名/密码共存 |

### KdfType

| 值 | 名称 | 说明 |
|----|------|------|
| `PBKDF2_SHA256` | PBKDF2-SHA256 | 兼容性好 |
| `ARGON2ID` | Argon2id | 推荐，抗硬件加速 |

### DeviceType

| 值 | 说明 |
|----|------|
| `BROWSER` | 浏览器插件 |
| `ANDROID` | Android 应用 |

### RepromptType

| 值 | 名称 | 说明 |
|----|------|------|
| 0 | `NONE` | 无需重新确认 |
| 1 | `PASSWORD` | 需要主密码重新确认 |
