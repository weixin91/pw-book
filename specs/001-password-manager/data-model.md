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
| `type` | Enum | `LOGIN` (1), `CARD` (2), `IDENTITY` (3), `SECURE_NOTE` (4), `PASSKEY` (5)。**说明**：Passkey 数据既可作为独立 `type=5` 条目，也可作为 `type=1` (LOGIN) 条目的附加字段。Edge 端采用后者，将 passkey 内嵌于 LOGIN 条目中，以便与同一站点的账号密码共存于同一凭据。 |
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

  // Passkey（作为 LOGIN 的可选附加字段，或独立 PASSKEY 类型）
  passkey?: {
    credentialId: string;     // Base64Url
    privateKey: string;       // Base64Url（JWK 或 SPKI 导出）
    publicKey: string;        // Base64Url（SPKI 格式公钥）
    rpId: string;             // Relying Party ID
    rpName?: string;          // RP 显示名称
    userHandle: string;       // Base64Url
    userName?: string;        // 用户名称
    userDisplayName?: string; // 用户显示名称
    counter: number;          // 签名计数器（防重放）
    createdAt: string;        // ISO 8601
  };

  // 通用字段
  name: string;               // 条目名称（如 "GitHub"）
  notes: string | null;
  fields: CustomField[];
  lastUsedAt: string | null;  // ISO 8601，上次自动填充或复制的时间，用于 FR-019 默认填充最近使用的账号
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

用户手动配置的跨基础域名 / Android 包名共享规则。**单个凭据自身可填充的网站和 APP 列表**保存在 `Cipher.data.login.uris[]` 中，本规则仅用于建立「不同基础域名」或「网站 ↔ APP」之间的额外联动。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `userId` | UUID | 所属用户 |
| `domains` | String[] | 关联的基础域名列表（如 `baidu.com`） |
| `packageNames` | String[] | 关联的 Android 包名列表（如 `com.baidu.tieba`） |
| `createdAt` | DateTime | 创建时间 |

#### URI 表示约定

`Cipher.data.login.uris[].uri` 同时承载网站与 Android 应用两类目标，区分依据是 URI scheme：

| 类别 | 示例 | 说明 |
|------|------|------|
| 网站（web） | `https://www.baidu.com/login` | 标准 `http(s)://` URL，匹配时取主机名并归一化为基础域名 |
| Android APP（android） | `androidapp://com.baidu.tieba` | 自定义 scheme，主机部分即包名 |
| 其他 | 任意原始字符串 | 仅做完全相等匹配（用于 deeplink、自定义协议等） |

凭据可以在 `uris[]` 中混合多个网站和 APP，例如同一账号既可登录 `https://www.baidu.com` 也可在 `androidapp://com.baidu.tieba` 内使用。

#### 基础域名提取（多段后缀）

为正确处理 `xxx.com.cn`、`xxx.co.uk` 这类两段顶级后缀，提取算法维护一份多段后缀白名单（`com.cn / co.uk / co.jp / com.hk / com.tw / com.au / co.kr / com.sg / com.br / com.mx / co.za / co.in / com.ar / com.tr / com.ua` 等）：

- 主机段数 ≥ 3 且末两段命中白名单 → 取末三段（`shop.example.com.cn` → `example.com.cn`）
- 否则取末两段（`a.b.example.com` → `example.com`）
- 单段或纯 IP → 原样返回

#### 匹配算法（`isUriMatch(source, target, rules)`）

设填充上下文 URI 为 `source`，候选凭据中某个 URI 为 `target`：

1. **同为网站**：`source.baseDomain === target.baseDomain` 即匹配（实现子域名自动共享）。
2. **同为 APP**：`source.packageName === target.packageName` 即匹配。
3. **跨类型（网站 ↔ APP）**：必须存在一条 DomainAssociation 规则同时覆盖二者：
   - 任一规则的 `domains[]` 包含 source 或 target 的 `baseDomain`，且 `packageNames[]` 包含另一方的 `packageName`。
4. **同基础域名跨规则桥接**：若两条网站凭据的基础域名分别属于同一规则的 `domains[]`，亦视为匹配（用户手动把多个不相关基础域名归到一个规则）。
5. 其他类型（`other`）只在原始字符串完全相同时匹配。

后台在调用匹配时通过 `getAssocRules()` 把全部规则展开为 `DomainAssocLite { domains[], packageNames[] }` 数组，匹配过程不涉及解密，仅基于 URI 字符串。

#### 与 `Cipher.data.login.uris` 的协作

- 编辑凭据时，用户可在弹窗内增删多条 URI（界面区分「网站」与「APP」标签），保存时统一去空白、去重写回 `uris[]`。
- 自动填充查询时，对 `uris[]` 中**每一条**调用 `isUriMatch`，命中即视为该凭据可用，因此一个凭据可被多个域名/包名复用而无需借助 DomainAssociation。
- DomainAssociation 仍是必要的：当两个凭据分别属于不同基础域名或属于「网站 + APP」组合，且用户希望它们在自动填充候选列表中相互可见时使用。

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

### 2.7 Rejected Site（拒绝保存记录）

用于实现 FR-020：用户拒绝保存某网站密码后，30 天内不再提示。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `userId` | UUID | 所属用户 |
| `domain` | String | 网站基础域名（如 `example.com`） |
| `rejectedAt` | DateTime | 拒绝时间 |
| `expireAt` | DateTime | 过期时间（rejectedAt + 30 天） |

**存储策略**：
- **Edge 插件**: 存储在 `chrome.storage.local`，按用户维度隔离
- **Android**: Room 数据库 `rejected_site` 表
- **服务端**: 无需同步到服务端（纯本地行为，避免同步复杂度和隐私问题）
- **清理**: 应用启动时自动删除 `expireAt < now()` 的记录

**判断逻辑**：
```typescript
function shouldPromptSave(domain: string): boolean {
  const record = rejectedSites.find(r => r.domain === getBaseDomain(domain));
  if (!record) return true;
  return new Date() > new Date(record.expireAt);
}
```

### 2.8 CookieData（Cookie 同步数据）

存储某域名下的 Cookie 和 localStorage 数据，**仅 Edge 插件实现**，Android 端不实现 Cookie 同步。

**服务端存储结构**（按域名独立记录）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `userId` | UUID | 所属用户 |
| `domain` | String | 基础域名（如 `example.com`），唯一索引 `(userId, domain)` |
| `encryptedData` | String | 用 User Key 加密的 CookieData JSON（AES-256-GCM） |
| `modifiedAt` | DateTime | 最后修改时间（服务端时间） |
| `createdAt` | DateTime | 创建时间 |

**加密前 JSON 结构（CookieData）**：

```typescript
interface CookieData {
  domain: string;
  cookies: CookieItem[];
  localStorageItems?: LocalStorageItem[];  // 可选，默认不同步
  userAgent?: string;                      // 记录同步时的 UA，用于排查问题
  createdAt: number;                       // 首次同步时间戳（ms）
  updatedAt: number;                       // 最后更新时间戳（ms）
}

interface CookieItem {
  name: string;
  value: string;
  domain: string;           // Cookie 的 domain 属性（可能以 . 开头）
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "no_restriction" | "lax" | "strict" | "unspecified";
  expirationDate?: number;  // Unix 时间戳（秒），session cookie 无此字段
  hostOnly: boolean;
  session: boolean;
  storeId?: string;         // 浏览器 cookie store ID（如 "0"）
}

interface LocalStorageItem {
  key: string;
  value: string;
}
```

**编码流程（Edge 端）**：

```
CookieData JSON
  ↓ JSON.stringify
字符串
  ↓ gzip (CompressionStream)
压缩二进制
  ↓ User Key AES-256-GCM 加密
加密二进制
  ↓ Base64
encryptedData（提交到服务端）
```

**解码流程（Edge 端）**：

```
encryptedData
  ↓ Base64 decode
加密二进制
  ↓ User Key AES-256-GCM 解密
压缩二进制
  ↓ gzip decompress (DecompressionStream)
JSON 字符串
  ↓ JSON.parse
CookieData
```

**安全与隐私策略**：
- Cookie 数据使用与凭据相同的 User Key 加密，服务端无法解密
- HttpOnly Cookie 可被提取和注入（`chrome.cookies` API 的权限允许），但受目标站点的 Secure / SameSite 策略限制
- localStorage 默认不同步（`syncLocalStorage: false`），用户需在设置中显式开启
- 明确告知用户：Cookie 同步不保证 100% 跨设备可用性（受现代浏览器安全策略限制）

### 2.9 CookieSyncConfig（Cookie 同步规则配置）

按域名配置自动同步行为，**可同步到服务端**实现多端规则共享。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 主键 |
| `userId` | UUID | 所属用户 |
| `domain` | String | 基础域名（如 `example.com`） |
| `autoPush` | Boolean | Cookie 变化时自动推送（默认 false） |
| `autoPull` | Boolean | 访问站点时自动拉取注入（默认 false） |
| `includeLocalStorage` | Boolean | 是否同步 localStorage（默认 false） |
| `createdAt` | DateTime | 创建时间 |
| `modifiedAt` | DateTime | 最后修改时间 |

**自动同步行为**：

| 配置 | autoPush=true | autoPull=true |
|------|--------------|---------------|
| 触发时机 | `chrome.cookies.onChanged` 且变化域名匹配 | `chrome.tabs.onUpdated` 且访问域名匹配 |
| 防抖 | 10 秒防抖，30 秒冷却期 | 标签页去重（同域名已有打开标签则不拉取） |
| 用户体验 | 静默推送，Badge 状态指示 | 注入后自动刷新页面使 Cookie 生效 |

**本地存储**（Edge）：
```typescript
// chrome.storage.local
cookieSyncConfig: {
  [domain: string]: {
    autoPush: boolean;
    autoPull: boolean;
    includeLocalStorage: boolean;
  }
}
```

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
