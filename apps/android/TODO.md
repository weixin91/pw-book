# Android App 待修复问题

## 问题 1：跳转回 App 后凭据选择与自动关联 ✅

**状态**：已实现

- 跳转到密码库后凭据列表已按 `targetUri` 匹配度排序（匹配的凭据置顶）
- 自动填充模式下凭据卡片显示「匹配」标签，便于区分
- 选择不匹配凭据时自动调用 `selectCipherForAutofill()` 添加 URI 并触发同步
- 保存完成后自动返回原 App 填充

---

## 问题 2：缺少生物识别解锁 ✅

**状态**：已实现

- 新增 `BiometricUnlockManager` 封装 BiometricPrompt 调用
- 使用 Android Keystore + AES/GCM 安全加密/解密 userKey
- 解锁界面新增「使用生物识别解锁」按钮（仅当设备支持且已开启时显示）
- 设置页面生物识别开关已接入实际逻辑：开启时验证并加密存储密钥，关闭时清除密钥

---

## 问题 3：解锁速度较慢 ✅

**状态**：已优化

- `UnlockVaultUseCase.unlock()` 中 KDF（PBKDF2）计算已切换到 `Dispatchers.Default`
- `LoginViewModel.login()` 中 KDF 计算同样切换到后台线程
- 避免 CPU 密集型密钥派生阻塞主线程导致的 UI 卡顿

---

## 问题 4：添加凭据页面 UI 优化 ✅

**状态**：已优化

- URI 输入框 placeholder 缩短为「网址或 App 包名」
- 删除按钮由文本「×」替换为标准 `Icons.Default.Close`
- 类型标签使用 `labelSmall` 样式，宽度缩小为 36.dp
- 「+ 网站」「+ APP」按钮增加 `weight(1f)` 均匀分布

---

## 问题 5：右上角锁定图标未生效 ✅

**状态**：已修复

- `AppNavHost` 中 `onLock` 回调先调用 `viewModel.lock()` 清除 VaultSession 密钥和 accessToken
- 再导航到解锁界面，确保密码库真正被锁定

---

## TODO 列表

- [x] 跳转后置顶展示匹配的凭据列表
- [x] 支持选择不匹配凭据并自动关联当前 App URI
- [x] 选择不匹配凭据后保存并返回原 App 填充
- [x] 接入 Android BiometricPrompt 生物识别解锁
- [x] 实现生物识别密钥的安全存储
- [x] 优化 VaultSession.unlock() 性能，减少解锁耗时
- [x] 优化添加凭据页面 URI 区域布局与提示文字
- [x] 修复右上角锁定图标点击后未锁定密码库的问题
