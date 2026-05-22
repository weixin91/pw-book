package com.pwbook.service.credential

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.provider.PendingIntentHandler
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.pwbook.crypto.PasskeyCrypto
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.DecryptedCipher
import com.pwbook.domain.LoginDataJson
import com.pwbook.domain.LoginUriJson
import com.pwbook.domain.PasskeyDataJson
import com.pwbook.domain.VaultSession
import com.pwbook.domain.VaultUnlockHelper
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import com.pwbook.ui.theme.PwBookTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.time.Instant
import javax.inject.Inject
import kotlin.coroutines.resume

/**
 * Passkey 认证 Activity。
 *
 * 从 Credential Provider PendingIntent 启动，处理 WebAuthn get/assertion 请求。
 * 支持保险库未解锁时自动解锁，以及多 passkey 选择。
 */
@AndroidEntryPoint
class PasskeyGetActivity : FragmentActivity() {

    @Inject lateinit var cipherRepository: CipherRepository
    @Inject lateinit var cipherIndexStore: com.pwbook.domain.index.CipherIndexStore
    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var vaultEncryption: VaultEncryption
    @Inject lateinit var pendingChangesQueue: PendingChangesQueue
    @Inject lateinit var syncManager: SyncManager
    @Inject lateinit var securePrefs: SecurePrefs
    @Inject lateinit var json: Json
    @Inject lateinit var vaultUnlockHelper: VaultUnlockHelper

    companion object {
        const val EXTRA_CREDENTIAL_ID = "credential_id"
        private const val EXTRA_CIPHER_ID = "cipher_id"
        private const val BIOMETRIC_GRACE_PERIOD_MS = 60_000L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val getRequest = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
        val option = getRequest?.credentialOptions?.firstOrNull() as? GetPublicKeyCredentialOption
            ?: run { finishWithCancel("无效请求"); return }

        val credentialId = intent.getStringExtra(EXTRA_CREDENTIAL_ID)
        val cipherId = intent.getStringExtra(EXTRA_CIPHER_ID)
        val origin = getRequest?.callingAppInfo?.resolveAppOrigin()

        lifecycleScope.launch {
            // 1. 确保保险库已解锁
            if (!vaultSession.isUnlocked.value) {
                val unlocked = vaultUnlockHelper.unlock(this@PasskeyGetActivity)
                if (!unlocked) {
                    finishWithCancel("保险库解锁失败")
                    return@launch
                }
            }

            // 2. 如果指定了 credentialId，直接使用（优先用 cipherId 直接查）
            if (credentialId != null) {
                authenticateAndReturn(credentialId, option, origin, cipherId)
                return@launch
            }

            // 3. 没有指定 credentialId，加载匹配的 passkey
            val requestJson = option.requestJson
            val rpId = try {
                org.json.JSONObject(requestJson).optString("rpId", "")
            } catch (e: Exception) {
                finishWithCancel("无法解析请求")
                return@launch
            }

            val loginCiphers = withContext(Dispatchers.IO) {
                val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""
                // 先通过索引预筛选含目标 rpId 的 cipher ID，避免全量解密
                val candidateIds = cipherIndexStore.filterByRpId(userId, rpId)
                candidateIds.mapNotNull { id -> cipherRepository.getCipher(id) }
                    .mapNotNull { vaultSession.decryptCipher(it) }
                    .filter { it.passkey != null && isCipherMatchRpId(it, rpId) }
            }

            if (loginCiphers.isEmpty()) {
                finishWithCancel("未找到匹配的通行密钥")
                return@launch
            }

            if (loginCiphers.size == 1) {
                authenticateAndReturn(loginCiphers.first().passkey!!.credentialId, option, origin)
            } else {
                showPasskeySelection(loginCiphers, rpId, option, origin)
            }
        }
    }

    private suspend fun authenticateAndReturn(
        credentialId: String,
        option: GetPublicKeyCredentialOption,
        origin: String?,
        cipherId: String? = null
    ) {
        val biometricSuccess = authenticateWithBiometric()
        if (!biometricSuccess) {
            finishWithCancel("生物识别验证失败")
            return
        }

        try {
            val response = authenticateWithPasskey(
                credentialId, option, origin,
                userVerified = true, cipherId = cipherId
            )
            val result = Intent()
            val publicKeyCredential = PublicKeyCredential(response)
            PendingIntentHandler.setGetCredentialResponse(
                result,
                androidx.credentials.GetCredentialResponse(publicKeyCredential)
            )
            setResult(RESULT_OK, result)
        } catch (e: Exception) {
            Timber.e(e, "Passkey get failed")
            setResult(RESULT_CANCELED)
        }
        finish()
    }

    private fun showPasskeySelection(
        ciphers: List<DecryptedCipher>,
        rpId: String,
        option: GetPublicKeyCredentialOption,
        origin: String?
    ) {
        setContent {
            PwBookTheme {
                PasskeyCreateSelectScreen(
                    rpId = rpId,
                    ciphers = ciphers,
                    title = "选择通行密钥",
                    showNewButton = false,
                    showPasskeyWarning = false,
                    onSelect = { cipherId ->
                        val selected = ciphers.find { it.id == cipherId }
                        val selectedCredentialId = selected?.passkey?.credentialId
                        if (selectedCredentialId != null) {
                            lifecycleScope.launch {
                                authenticateAndReturn(selectedCredentialId, option, origin)
                            }
                        } else {
                            finishWithCancel("无效选择")
                        }
                    },
                    onCancel = {
                        finishWithCancel("用户取消选择")
                    }
                )
            }
        }
    }

    private suspend fun authenticateWithPasskey(
        credentialId: String,
        option: GetPublicKeyCredentialOption,
        origin: String?,
        userVerified: Boolean = false,
        cipherId: String? = null
    ): String {
        val userKey = vaultSession.getUserKey()
            ?: throw IllegalStateException("保险库未解锁")
        val cipherKey = userKey.copyOfRange(0, 32)
        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID)
            ?: throw IllegalStateException("未登录")

        // 从密码库查找 Passkey（优先用 cipherId 直接查，避免全量解密）
        val cipher = if (cipherId != null) {
            cipherRepository.getCipher(cipherId)
                ?: throw IllegalStateException("Passkey 未找到")
        } else {
            cipherRepository.findByCredentialId(userId, credentialId)
                ?: throw IllegalStateException("Passkey 未找到")
        }

        val decrypted = vaultSession.decryptCipher(cipher)
            ?: throw IllegalStateException("无法解密凭据")
        val passkey = decrypted.passkey
            ?: throw IllegalStateException("凭据不包含 Passkey")

        // 解析请求
        val requestJson = org.json.JSONObject(option.requestJson)
        val challenge = requestJson.getString("challenge")
        val rpId = requestJson.optString("rpId", passkey.rpId)
        val resolvedOrigin = origin ?: "https://$rpId"

        // 导入私钥并签名
        val privateKey = PasskeyCrypto.importPrivateKey(passkey.privateKey)
        val newCounter = passkey.counter + 1

        val authData = PasskeyCrypto.buildAuthenticatorData(
            rpId = rpId,
            signCount = newCounter,
            includeAttestedCredentialData = false,
            userVerified = userVerified
        )

        val clientDataJSON = PasskeyCrypto.buildClientDataJSON("webauthn.get", challenge, resolvedOrigin)
        // 浏览器提供 clientDataHash 时直接使用，否则自己计算
        val clientDataHash = option.clientDataHash ?: PasskeyCrypto.sha256(clientDataJSON)
        val signature = PasskeyCrypto.signAssertion(privateKey, authData, clientDataHash)

        // 更新 counter 并保存
        val updatedPasskey = passkey.copy(counter = newCounter)
        val updatedData = CipherDataJson(
            name = decrypted.name,
            notes = decrypted.notes,
            login = LoginDataJson(
                username = decrypted.username,
                password = decrypted.password,
                uris = decrypted.uris.map { LoginUriJson(uri = it) },
                totp = decrypted.totp
            ),
            passkey = updatedPasskey,
            lastUsedAt = Instant.now().toString(),
            fields = emptyList()
        )
        val encryptedData = vaultEncryption.encryptString(
            json.encodeToString(updatedData),
            cipherKey
        )
        val updatedEntity = cipher.copy(
            data = encryptedData,
            modifiedAt = System.currentTimeMillis()
        )
        cipherRepository.saveCipher(updatedEntity)
        pendingChangesQueue.enqueue(
            cipher.id,
            PendingChangesQueue.Operation.UPDATE,
            encryptedData,
            System.currentTimeMillis()
        )
        syncManager.launchSyncAll()

        Timber.i("Passkey assertion signed for credentialId=$credentialId, newCounter=$newCounter, userVerified=$userVerified")

        // 构建响应
        val userHandleBytes = try {
            PasskeyCrypto.base64UrlDecode(passkey.userHandle)
        } catch (e: Exception) {
            passkey.userHandle.toByteArray(Charsets.UTF_8)
        }

        return org.json.JSONObject().apply {
            put("id", passkey.credentialId)
            put("rawId", passkey.credentialId)
            put("type", "public-key")
            put("response", org.json.JSONObject().apply {
                put("clientDataJSON", PasskeyCrypto.base64UrlEncode(clientDataJSON.toByteArray(Charsets.UTF_8)))
                put("authenticatorData", PasskeyCrypto.base64UrlEncode(authData))
                put("signature", PasskeyCrypto.base64UrlEncode(signature))
                put("userHandle", PasskeyCrypto.base64UrlEncode(userHandleBytes))
            })
            put("clientExtensionResults", org.json.JSONObject())
        }.toString()
    }

    private suspend fun authenticateWithBiometric(): Boolean {
        // 短时间内已通过生物识别/密码解锁，跳过二次验证
        if (vaultSession.isUserVerifiedRecently(BIOMETRIC_GRACE_PERIOD_MS)) {
            Timber.d("Skipping biometric: user verified recently")
            return true
        }

        val biometricManager = BiometricManager.from(this)
        val canAuth = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        // 生物识别不可用时必须返回 false，不能跳过用户验证
        if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
            Timber.w("Biometric not available: $canAuth, cannot proceed without user verification")
            return false
        }

        return suspendCancellableCoroutine { continuation ->
            val executor = ContextCompat.getMainExecutor(this)
            val prompt = BiometricPrompt(
                this,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        continuation.resume(true)
                    }
                    override fun onAuthenticationFailed() {
                        continuation.resume(false)
                    }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                            errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                        ) {
                            continuation.resume(false)
                        } else {
                            Timber.e("Biometric error: $errString")
                            continuation.resume(false)
                        }
                    }
                }
            )

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Password Book")
                .setSubtitle("使用生物识别认证通行密钥")
                .setNegativeButtonText("取消")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build()

            prompt.authenticate(promptInfo)

            continuation.invokeOnCancellation {
                prompt.cancelAuthentication()
            }
        }
    }

    private fun finishWithCancel(reason: String) {
        Timber.w("Passkey get cancelled: $reason")
        setResult(RESULT_CANCELED)
        finish()
    }

    private fun isCipherMatchRpId(cipher: DecryptedCipher, rpId: String): Boolean {
        if (cipher.passkey?.rpId?.equals(rpId, ignoreCase = true) == true) return true
        return cipher.uris.any { uri -> uri.contains(rpId, ignoreCase = true) }
    }

}
