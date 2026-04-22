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

### 4.3 删除关联规则

```http
DELETE /api/domain-associations/:id
Authorization: Bearer <token>
```

**Response 204**

---

## 5. Cookie 同步接口（仅 Edge 插件）

### 5.1 上传 Cookie

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

**Response 201**

---

### 5.2 获取 Cookie

```http
GET /api/cookies/:domain
Authorization: Bearer <token>
```

**Response 200**:
```json
{
  "domain": "example.com",
  "encryptedData": "<encrypted-cookie-json-base64>",
  "modifiedAt": "2026-04-22T12:00:00Z"
}
```

---

## 6. 设备管理接口

### 6.1 获取已注册设备

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

### 6.2 注销设备

```http
DELETE /api/devices/:id
Authorization: Bearer <token>
```

**Response 204**

---

## 7. 实时同步（WebSocket）

### 7.1 连接

```javascript
const ws = new WebSocket('wss://api.pwbook.example.com/ws?token=<jwt>');
```

### 7.2 服务端推送消息

```json
{
  "type": "SYNC_REQUIRED",
  "timestamp": "2026-04-22T12:00:00Z"
}
```

客户端收到后应触发增量同步。

---

## 8. 错误响应格式

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
| 5 | `PASSKEY` | Passkey 凭据 |

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
