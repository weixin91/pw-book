# Android Passkey Origin 获取方式调研

## 问题背景

`PasskeyGetActivity` 中需要获取调用方的 origin，用于构建 WebAuthn 响应中的 `clientDataJSON.origin`。

AndroidX Credentials Provider API 中：
- `CreatePublicKeyCredentialRequest` 有 `origin` 属性（1.2.0+）
- **`GetPublicKeyCredentialOption` 没有 `origin` 属性**

## 正确的 origin 获取方式

在 Provider 端（`PasskeyGetActivity`），应通过 `CallingAppInfo.getOrigin(privilegedAllowlist)` 获取：

```kotlin
val origin = getRequest?.callingAppInfo?.getOrigin(privilegedAllowlist)
    ?: getRequest?.callingAppInfo?.resolveAppOrigin()
    ?: "https://$rpId"
```

| 优先级 | 来源 | 适用场景 |
|--------|------|---------|
| 1 | `callingAppInfo.getOrigin(allowlist)` | **浏览器特权调用**。浏览器（Chrome/Edge）代表网页发起请求时，会通过系统透传网页真实 origin。`getOrigin()` 只在 calling app 匹配 allowlist 时返回该 origin。 |
| 2 | `resolveAppOrigin()` → `android:apk-key-hash:xxx` | **原生 App 直接调用**。计算 calling app 的签名哈希作为 origin。 |
| 3 | `"https://$rpId"` | 兜底回退。 |

## allowlist 机制

`getOrigin()` 不是无条件返回 origin。它要求传入一个 **JSON allowlist**，格式包含受信任的 caller 的 `packageName` 和证书指纹。只有当 calling app 匹配 allowlist 中的条目时，才会返回其透传的 origin。

> Google Password Manager 维护了一个公开可用的 allowlist，第三方 credential provider 可以使用它或提供自己的。

## 当前代码的情况

`PasskeyGetActivity.kt:74` 目前直接调用 `resolveAppOrigin()`，**跳过了 `getOrigin()` 这一步**：

```kotlin
val origin = getRequest?.callingAppInfo?.resolveAppOrigin()
```

对于浏览器调用：
- `resolveAppOrigin()` 对浏览器大概率返回 `null`（浏览器通常有多个签名者或签名信息拿不到）
- 然后回退到 `authenticateWithPasskey` 里的 `origin ?: "https://$rpId"`
- 所以**恰好能工作**，但不是正确的设计

## 结论

当前代码能正常使用，但如果要更严谨，应该：

1. **引入一个浏览器 allowlist**（可以使用 Google Password Manager 的公开列表，或自建包含 Chrome/Edge 证书指纹的 JSON）
2. **Get 端先调用 `getOrigin(allowlist)`**，再回退到 `resolveAppOrigin()`

考虑到：
- `rpId` 就是从请求 JSON 中解析的，网页 origin 通常就是 `https://$rpId`
- 引入 allowlist 需要维护浏览器证书指纹，增加复杂度
- Edge 端也是类似处理

**保持现状是务实的选择**。如果未来遇到子域名不匹配的问题（如 `accounts.google.com` 的 rpId 是 `google.com`），再引入 `getOrigin()` 也不迟。

## allowlist 维护方式

### 1. 内嵌资源文件（最常用）

把 allowlist 作为 JSON 文件打包进 APK（如 `assets/privileged_browsers_allowlist.json`），应用启动时读取。

**优点：** 简单可靠，离线可用，无网络依赖。  
**缺点：** 浏览器证书指纹变更时需发新版 APK。  
**参考：** [1Password Android Passkey Provider](https://github.com/digitalby/1password-android-passkeys) 采用此方式。

### 2. 远程动态更新

从自己的服务器下载 allowlist，本地缓存 + 定期刷新。

**优点：** 浏览器证书指纹变更时无需发版，即时生效。  
**缺点：** 增加网络依赖，需考虑签名验证防篡改。  
**实现要点：** 下载的 JSON 需用公钥验签，避免中间人攻击。

### 3. 复用 Google Password Manager 的公开列表

Google Password Manager 维护了一个**公开可用的 allowlist**，第三方 provider 可以直接使用。

**优点：** 零维护成本，Google 会保持列表最新。  
**缺点：** 需要找到该列表的下载地址/内容（目前未找到直接的公开链接，可能需要通过 Chromium 源码或 Google 开发者支持获取）。

### 4. 用户自定义扩展

在设置中提供"额外允许的浏览器"选项，用户手动输入 packageName + 证书指纹。

**优点：** 灵活覆盖小众浏览器或测试场景。  
**缺点：** 普通用户难以获取证书指纹，体验差。  
**参考：** 1Password 在硬编码列表之外，也提供了此类扩展入口。

### 5. 混合模式（推荐）

结合上述方式的优点：

```
基础列表（内嵌 assets）        ← 兜底，保证离线可用
      ↓
远程增量更新（签名验证）        ← 覆盖证书变更
      ↓
用户自定义扩展（可选）          ← 覆盖小众浏览器
```

### allowlist JSON 格式

```json
{
  "apps": [
    {
      "type": "android",
      "info": {
        "package_name": "com.android.chrome",
        "signatures": [
          {
            "build": "release",
            "cert_fingerprint_sha256": "AB:CD:EF:...:12"
          },
          {
            "build": "userdebug",
            "cert_fingerprint_sha256": "AB:CD:EF:...:34"
          }
        ]
      }
    }
  ]
}
```

### 对我们项目的建议

当前代码**不使用 allowlist**，而是靠 `resolveAppOrigin()` 返回 null 后回退到 `https://$rpId`。如果未来要支持 `getOrigin()`，推荐采用：

> **方式 1（内嵌资源）即可** — 把 Chrome、Edge、Firefox 等主要浏览器的 release 证书指纹打包进 `res/raw/` 或 `assets/`。证书指纹变更频率极低，发版更新完全可接受。

## 参考

- [Integrate Credential Manager with your credential provider solution](https://developer.android.com/identity/sign-in/credential-provider)
- [AndroidX Credentials API current.txt](https://android.googlesource.com/platform//frameworks/support/+/9de9159dbfc507869a815f1379b84794e699ecea/credentials/credentials/api/current.txt)
