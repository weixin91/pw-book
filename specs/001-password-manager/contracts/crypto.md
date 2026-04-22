# 加密协议契约

**Feature**: 密码管理应用  
**Date**: 2026/04/22  
**Version**: 1.0

---

## 1. 设计原则

1. **零知识**: 服务端永远不解密用户数据，仅存储加密后的 blob
2. **客户端加密**: 所有加密/解密操作在客户端完成
3. **标准算法**: 使用经过验证的标准加密算法，不自行实现加密原语
4. **前向安全**: 主密码变更后，旧密钥无法解密新数据

---

## 2. 密钥层次结构

```
┌─────────────────────────────────────────────────────────────┐
│                    密钥层次结构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  主密码 (用户记忆)                                            │
│     +                                                        │
│  邮箱 (Salt)                                                 │
│     ↓                                                        │
│  KDF (Argon2id / PBKDF2)                                    │
│     ↓                                                        │
│  256-bit Master Key ───────→ Master Password Hash (验证用)    │
│     ↓                                                        │
│  HKDF-SHA256 (expand)                                       │
│     ↓                                                        │
│  512-bit Stretched Master Key                               │
│  [0-255]: AES key  [256-511]: MAC key                        │
│     ↓                                                        │
│  解密 Protected Symmetric Key                                │
│     ↓                                                        │
│  512-bit User Key (对称密钥)                                 │
│  [0-255]: AES key  [256-511]: HMAC key                       │
│     ↓                                                        │
│  加密/解密所有保险库数据                                       │
│                                                             │
│  RSA-2048 Key Pair                                          │
│  ├─ 公钥: 明文存储，用于加密共享数据                           │
│  └─ 私钥: 用 User Key 加密存储                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 密钥派生算法（KDF）

### 3.1 Argon2id（推荐）

| 参数 | 默认值 | 允许范围 |
|------|--------|----------|
| 内存 (memory) | 64 MiB (65536 KB) | 16 - 1024 MiB |
| 迭代次数 (iterations) | 3 | 2 - 10 |
| 并行度 (parallelism) | 4 | 1 - 16 |

**派生公式**:
```
Master Key = Argon2id(
  password = 用户主密码 (UTF-8),
  salt = SHA-256(用户邮箱小写) [32 bytes],
  memory = kdfMemory,
  iterations = kdfIterations,
  parallelism = kdfParallelism,
  hashLength = 32
)
```

### 3.2 PBKDF2-SHA256（兼容选项）

| 参数 | 默认值 | 允许范围 |
|------|--------|----------|
| 迭代次数 | 600,000 | 600,000 - 2,000,000 |

**派生公式**:
```
Master Key = PBKDF2(
  prf = HMAC-SHA256,
  password = 用户主密码 (UTF-8),
  salt = SHA-256(用户邮箱小写) [32 bytes],
  iterations = kdfIterations,
  dkLen = 32
)
```

### 3.3 Master Password Hash

用于服务端验证登录：
```
Master Password Hash = PBKDF2(
  prf = HMAC-SHA256,
  password = Master Key,
  salt = 用户主密码 (UTF-8),
  iterations = 1,
  dkLen = 32
)
```

**注意**: 登录时服务端比较此哈希值，不存储主密码本身。

### 3.4 Stretched Master Key

```
Stretched Master Key = HKDF-SHA256(
  ikm = Master Key,
  salt = null,
  info = "enc" (UTF-8),  // 扩展 AES 密钥部分
  L = 32
) || HKDF-SHA256(
  ikm = Master Key,
  salt = null,
  info = "mac" (UTF-8),  // 扩展 MAC 密钥部分
  L = 32
)
```

---

## 4. 对称加密

### 4.1 AES-256-GCM

所有保险库数据使用 **AES-256-GCM** 加密。

**加密**:
```
Ciphertext = AES-256-GCM(
  key = User Key [0-255],
  plaintext = JSON 序列化后的数据 (UTF-8),
  iv = 随机 12 字节,
  aad = null
)

Encrypted Data = iv [12 bytes] || ciphertext || tag [16 bytes]
```

**解密**:
```
iv = Encrypted Data [0:12]
tag = Encrypted Data [-16:]
ciphertext = Encrypted Data [12:-16]

plaintext = AES-256-GCM_DECRYPT(
  key = User Key [0-255],
  ciphertext = ciphertext,
  iv = iv,
  tag = tag
)
```

### 4.2 Protected Symmetric Key（User Key 加密存储）

User Key 本身需要加密后存储在服务端：

```
Protected Key = AES-256-GCM(
  key = Stretched Master Key [0-255],
  plaintext = User Key [64 bytes],
  iv = 随机 12 字节
)
```

---

## 5. 非对称加密（RSA）

### 5.1 密钥生成

```
RSA Key Pair = RSA-2048-OAEP(
  publicExponent = 65537
)
```

### 5.2 私钥加密存储

```
Encrypted Private Key = AES-256-GCM(
  key = User Key [0-255],
  plaintext = RSA Private Key (PKCS#8),
  iv = 随机 12 字节
)
```

### 5.3 公钥加密（数据共享）

```
Encrypted Data = RSA-OAEP-SHA256(
  publicKey = 接收者公钥,
  plaintext = 对称密钥
)
```

---

## 6. 恢复密钥

### 6.1 生成

```
Recovery Key = Base32Encode(RandomBytes(16))  // 16 bytes = 128 bits
               // 例如: "ABCD-EFGH-IJKL-MNOP"
```

### 6.2 恢复密钥哈希（用于验证）

```
Recovery Key Hash = PBKDF2-SHA256(
  password = Recovery Key (UTF-8),
  salt = SHA-256(用户邮箱小写),
  iterations = 100000,
  dkLen = 32
)
```

### 6.3 恢复密钥加密 User Key

```
Recovery Master Key = Argon2id(
  password = Recovery Key,
  salt = SHA-256(用户邮箱小写 + "recovery"),
  memory = 65536,
  iterations = 3,
  parallelism = 4,
  hashLength = 32
)

Encrypted Recovery Key = AES-256-GCM(
  key = Recovery Master Key,
  plaintext = User Key,
  iv = 随机 12 字节
)
```

---

## 7. 数据加密示例

### 7.1 Cipher Data 加密流程

```typescript
// 1. 序列化
plaintext = JSON.stringify(cipherData)  // UTF-8

// 2. 生成随机 IV
iv = crypto.getRandomValues(new Uint8Array(12))

// 3. 加密
encrypted = aesGcmEncrypt(
  key: userKey.slice(0, 32),
  plaintext: plaintext,
  iv: iv
)

// 4. 编码为 Base64
encryptedData = base64Encode(iv + encrypted.ciphertext + encrypted.tag)
```

### 7.2 服务端存储格式

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "type": 1,
  "data": "<base64(iv + ciphertext + tag)>",
  "favorite": false,
  "reprompt": 0,
  "createdAt": "2026-04-20T10:00:00Z",
  "modifiedAt": "2026-04-21T08:30:00Z"
}
```

---

## 8. 随机数生成

| 平台 | API | 用途 |
|------|-----|------|
| Web (Edge 插件) | `crypto.getRandomValues()` | IV、Salt、密钥生成 |
| Android | `SecureRandom` | IV、Salt、密钥生成 |
| Node.js (后端) | `crypto.randomBytes()` | Token、UUID、Session ID |

**禁止**: 使用 `Math.random()` 或伪随机数生成器进行加密操作。

---

## 9. 剪贴板安全

### 9.1 密码复制流程

1. 用户点击「复制密码」
2. 将密码写入系统剪贴板
3. 启动 10 秒倒计时
4. 倒计时结束后，将剪贴板内容替换为空字符串（非敏感内容）

### 9.2 重新复制重置

- 在 10 秒内再次复制同一密码 → 重置计时器
- 复制不同密码 → 立即清空旧密码，新密码开始 10 秒倒计时

---

## 10. 实现参考

### 10.1 Web Crypto API（Edge 插件）

```typescript
// AES-256-GCM 加密
async function encryptAesGcm(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

// PBKDF2 派生
async function deriveKeyPbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}
```

### 10.2 Android（Kotlin）

```kotlin
// AES-256-GCM 加密
fun encryptAesGcm(plaintext: ByteArray, key: SecretKey): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(plaintext)
    return iv + ciphertext
}

// 随机数生成
val secureRandom = SecureRandom()
val iv = ByteArray(12).apply { secureRandom.nextBytes(this) }
```

---

## 11. 安全审计检查清单

- [ ] 所有敏感数据使用 AES-256-GCM 加密
- [ ] IV 每次加密都重新生成
- [ ] 使用 CSPRNG 生成所有随机数
- [ ] 主密码从不明文传输或存储
- [ ] KDF 参数符合最低安全要求
- [ ] 剪贴板在 10 秒后自动清空
- [ ] 服务端仅存储加密数据，无法解密
- [ ] 恢复密钥生成具有足够熵（128+ bits）
- [ ] JWT Token 有合理的过期时间
- [ ] 所有网络通信使用 HTTPS/TLS 1.3
