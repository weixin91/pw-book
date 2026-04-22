# 数据模型设计

**Feature**: 密码管理应用  
**Date**: 2026/04/22

---

## 1. 实体关系图

```
+---------------+       +------------------+       +------------------+
|     User      |1-----*|  Cipher (凭据)   |1-----*|   TOTP Config    |
+---------------+       +------------------+       +------------------+
| id            |       | id               |       | cipherId         |
| email         |       | userId           |       | secret           |
| kdfConfig     |       | type             |       | algorithm        |
| protectedKey  |       | data (加密JSON)  |       | digits           |
| publicKey     |       | favorite         |       | period           |
| privateKey    |       | reprompt         |       +------------------+
| securityStamp |       | createdAt        |
+---------------+       | modifiedAt       |
         |              +------------------+
         |1                      |*
         |              +------------------+
         |              | DomainAssociation|
         |              +------------------+
         |              | id               |
         |              | userId           |
         |              | domains[]        |
         |              | packageNames[]   |
         |              +------------------+
         |
         |1                     |*
         +--------------->+--------------+
                        | SyncRecord   |
                        +--------------+
                        | id           |
                        | userId       |
                        | deviceId     |
                        | lastSyncAt   |
                        | deviceType   |
                        +--------------+
         |
         |1                     |*
         +--------------->+--------------+
                        |  RecoveryKey |
                        +--------------+
                        | id           |
                        | userId       |
                        | keyHash      |
                        | createdAt    |
                        +--------------+
```

---

## 2. 核心实体

### 2.1 User（用户）

服务端存储的用户账户信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `email` | String | 用户邮箱，唯一，作为 KDF salt |
| `kdfType` | Enum | `PBKDF2_SHA256` 或 `ARGON2ID` |
| `kdfIterations` | Int | KDF 迭代次数（PBKDF2: 600000, Argon2id: 3） |
| `kdfMemory` | Int? | Argon2id 内存参数（KB） |
| `kdfParallelism` | Int? | Argon2id 并行度 |
| `masterPasswordHash` | String | 主密码哈希（用于登录验证） |
| `protectedKey` | String | 用 Stretched Master Key 加密的 User Key |
| `publicKey` | String | RSA-2048 公钥（Base64） |
| `encryptedPrivateKey` | String | 用 User Key 加密的 RSA 私钥 |
| `securityStamp` | UUID | 安全令牌，修改密码后变更，使旧 JWT 失效 |
| `recoveryKeyHash` | String? | 恢复密钥哈希（用于验证恢复密钥） |
| `encryptedRecoveryKey` | String? | 用 Recovery Key 加密的 User Key |
| `createdAt` | DateTime | 创建时间 |
| `modifiedAt` | DateTime | 最后修改时间 |

### 2.2 Cipher（凭据条目）

加密后的密码条目。`data` 字段包含完整的加密 JSON。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `userId` | UUID | 所属用户 |
| `type` | Enum | `LOGIN`, `CARD`, `IDENTITY`, `SECURE_NOTE`, `PASSKEY` |
| `data` | String | 加密后的 JSON 数据（AES-256-GCM） |
| `favorite` | Boolean | 是否收藏 |
| `reprompt` | Enum | `NONE`, `PASSWORD`（主密码重新确认） |
| `createdAt` | DateTime | 创建时间 |
| `modifiedAt` | DateTime | 最后修改时间 |

**Cipher Data（加密前 JSON 结构）**：

```typescript
interface CipherData {
  // Login 类型
  login?: {
    username: string | null;
    password: string | null;
    uris: LoginUri[];
    totp: string | null;      // otpauth:// URI 或 secret
  };

  // Card 类型
  card?: {
    number: string;
    brand: string;
    expMonth: string;
    expYear: string;
    code: string;
  };

  // Identity 类型
  identity?: {
    title: string;
    firstName: string;
    lastName: string;
    address: string;
    // ... 其他身份信息字段
  };

  // Secure Note 类型
  secureNote?: {
    type: number;
  };

  // Passkey 类型
  passkey?: {
    credentialId: string;
    privateKey: string;
    rpId: string;             // Relying Party ID
    userHandle: string;
    userDisplayName: string;
    counter: number;          // 签名计数器（防重放）
    createdAt: string;
  };

  // 通用字段
  name: string;               // 条目名称（如 "GitHub"）
  notes: string | null;
  fields: CustomField[];
}

interface LoginUri {
  uri: string;
  match: UriMatchType | null;  // DOMAIN, HOST, STARTS_WITH, etc.
}

interface CustomField {
  name: string;
  value: string;
  type: FieldType;            // TEXT, HIDDEN, BOOLEAN
}

enum UriMatchType {
  DOMAIN = 0,       // 匹配基础域名
  HOST = 1,         // 匹配完整主机名
  STARTS_WITH = 2,  // URI 前缀匹配
  EXACT = 3,        // 完全匹配
  REGULAR_EXPRESSION = 4,
  NEVER = 5,
}
```

### 2.3 TOTP Config（TOTP 配置）

TOTP 配置可以内嵌在 Cipher Data 中（`login.totp` 字段），也可以作为独立实体。推荐内嵌方式，减少关联查询。

| 字段 | 类型 | 说明 |
|------|------|------|
| `secret` | String | Base32 编码的共享密钥 |
| `algorithm` | Enum | `SHA1`, `SHA256`, `SHA512`（默认 SHA1） |
| `digits` | Int | 验证码位数（默认 6） |
| `period` | Int | 周期秒数（默认 30） |

### 2.4 Domain Association（域名关联规则）

用户手动配置的跨域共享规则。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `userId` | UUID | 所属用户 |
| `domains` | String[] | 关联的域名列表 |
| `packageNames` | String[] | 关联的 Android 包名列表 |
| `createdAt` | DateTime | 创建时间 |

**匹配逻辑**：
- 基础域名提取：`www.baidu.com` → `baidu.com`
- 子域名自动共享：同一基础域名下的凭据相互可见
- 手动关联：不同基础域名或 App 包名之间建立关联后，凭据在候选列表中共同显示

### 2.5 Sync Record（同步记录）

记录各设备的同步状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `userId` | UUID | 所属用户 |
| `deviceId` | String | 设备唯一标识 |
| `deviceType` | Enum | `BROWSER`, `ANDROID` |
| `deviceName` | String | 设备名称（如 "Edge on Windows"） |
| `lastSyncAt` | DateTime | 最后成功同步时间 |
| `createdAt` | DateTime | 首次注册时间 |

### 2.6 Recovery Key（恢复密钥）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `userId` | UUID | 所属用户 |
| `keyHash` | String | 恢复密钥的哈希（用于验证） |
| `encryptedUserKey` | String | 用 Recovery Key 加密的 User Key |
| `createdAt` | DateTime | 创建时间 |

---

## 3. 本地存储模型（客户端）

### 3.1 Edge 插件本地存储

使用 **IndexedDB** 存储解密后的保险库数据（在内存中），持久化存储加密数据：

| 存储位置 | 数据 | 说明 |
|----------|------|------|
| `chrome.storage.local` | `encKey` (Protected Key), `encPrivateKey`, `profile` | 加密密钥和用户信息 |
| `chrome.storage.local` | `ciphers` (加密 JSON 数组) | 加密凭据数据 |
| `chrome.storage.local` | `folders`, `settings` | 其他加密数据 |
| IndexedDB (内存) | 解密后的 Vault | 运行时缓存 |
| `chrome.storage.session` | 解密后的 User Key | **MV3 中 session storage 在 Service Worker 重启后丢失** |

**重要**：MV3 的 Service Worker 会频繁终止，解密后的 User Key 需要：
1. 存储在 `chrome.storage.session`（Service Worker 存活期间可用）
2. 或者要求用户每次 Service Worker 重启后重新输入主密码
3. 或者使用 Offscreen Document 维持持久化上下文

### 3.2 Android 本地存储

使用 **Room** 数据库存储：

| 表 | 说明 |
|----|------|
| `CipherEntity` | 加密凭据数据 |
| `FolderEntity` | 加密文件夹 |
| `DomainAssociationEntity` | 域名关联规则 |
| `SyncQueueEntity` | 离线变更队列 |
| `SettingEntity` | 应用设置 |

**Sync Queue（离线变更队列）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `cipherId` | UUID | 关联凭据 |
| `operation` | Enum | `CREATE`, `UPDATE`, `DELETE` |
| `encryptedData` | String | 加密后的变更数据 |
| `clientTimestamp` | DateTime | 客户端变更时间 |
| `retryCount` | Int | 重试次数 |
| `createdAt` | DateTime | 入队时间 |

---

## 4. 状态转换

### 4.1 凭据生命周期

```
[新建] → (用户保存/自动捕获) → [活动]
[活动] → (用户编辑) → [已修改]
[活动] → (用户删除) → [已删除]
[已删除] → (同步到服务端) → [从服务端移除]
```

### 4.2 同步状态机

```
[未同步] → (在线且变更) → [同步中]
[同步中] → (成功) → [已同步]
[同步中] → (失败) → [待重试]
[待重试] → (网络恢复) → [同步中]
[已同步] → (本地修改) → [未同步]
```

### 4.3 保险库锁定状态

```
[锁定] → (输入主密码/生物识别) → [解锁]
[解锁] → (超时无操作) → [锁定]
[解锁] → (主动锁定) → [锁定]
[锁定] → (应用后台超时) → [锁定]
```

---

## 5. 验证规则

### 5.1 主密码策略

| 规则 | 值 | 说明 |
|------|-----|------|
| 最小长度 | 8 字符 | 建议 12+ |
| 复杂度检查 | 可选 | 至少包含大写、小写、数字 |

### 5.2 密码生成器规则

| 参数 | 范围 | 默认值 |
|------|------|--------|
| 长度 | 5-128 | 16 |
| 包含大写 | true/false | true |
| 包含小写 | true/false | true |
| 包含数字 | true/false | true |
| 包含特殊字符 | true/false | true |
| 排除混淆字符 | true/false | true（排除 `0O`, `1lI` 等） |
| 最小数字数 | 0-9 | 1 |
| 最小特殊字符数 | 0-9 | 1 |

### 5.3 自动锁定策略

| 参数 | 范围 | 默认值 |
|------|------|--------|
| 锁定超时 | 1 分钟 - 永不 | 15 分钟 |
| 应用后台即锁定 | true/false | false |

---

## 6. 数据流

### 6.1 加密流程

```
用户主密码 + 邮箱(Salt)
         ↓
    KDF (Argon2id/PBKDF2)
         ↓
    256-bit Master Key
         ↓
    HKDF-SHA256 (expand, "enc", "mac")
         ↓
    512-bit Stretched Master Key
    [0-31: AES key][32-63: MAC key]
         ↓
    解密 Protected Symmetric Key
         ↓
    512-bit User Key
         ↓
    AES-256-GCM 加密 Cipher Data
         ↓
    加密后的 JSON → 服务端存储
```

### 6.2 解密流程

```
用户输入主密码
         ↓
    相同 KDF 流程 → Master Key
         ↓
    验证 masterPasswordHash（登录时）
         ↓
    解密 Protected Key → User Key
         ↓
    User Key 解密 Cipher Data
         ↓
    明文凭据 → 内存中使用
```
