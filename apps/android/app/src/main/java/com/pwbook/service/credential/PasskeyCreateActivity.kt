package com.pwbook.service.credential

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.provider.PendingIntentHandler
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.pwbook.crypto.PasskeyCrypto
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.VaultSession
import com.pwbook.domain.VaultUnlockHelper
import com.pwbook.domain.model.PasskeyData
import com.pwbook.ui.theme.PwBookTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.time.Instant
import javax.inject.Inject

/**
 * Passkey 创建 Activity。
 *
 * 从 Credential Provider PendingIntent 启动，处理 WebAuthn create 请求。
 * 流程：解锁保险库（如需） → 展示凭据选择界面 → 生成并保存 Passkey → 返回响应。
 */
@AndroidEntryPoint
class PasskeyCreateActivity : FragmentActivity() {

    @Inject lateinit var passkeyVaultWriter: PasskeyVaultWriter
    @Inject lateinit var cipherRepository: CipherRepository
    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var securePrefs: SecurePrefs
    @Inject lateinit var vaultUnlockHelper: VaultUnlockHelper

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Timber.d("PasskeyCreateActivity onCreate")
        val request = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
        Timber.d("retrieveProviderCreateCredentialRequest request=$request")
        val callingRequest = request?.callingRequest as? CreatePublicKeyCredentialRequest
            ?: run { finishWithCancel("无效请求"); return }

        val requestJson = callingRequest.requestJson
        val callingAppInfo = request.callingAppInfo
        val rpId = try {
            org.json.JSONObject(requestJson).getJSONObject("rp").optString("id", "")
        } catch (e: Exception) {
            finishWithCancel("无法解析请求")
            return
        }

        val origin = callingRequest.origin ?: callingAppInfo?.resolveAppOrigin() ?: "https://$rpId"
        Timber.d("requestJson=$requestJson callingPackage=${callingAppInfo?.packageName} origin=$origin")

        lifecycleScope.launch {
            // 确保保险库已解锁（同时完成身份验证）
            if (!vaultSession.isUnlocked.value) {
                val unlocked = vaultUnlockHelper.unlock(this@PasskeyCreateActivity)
                if (!unlocked) {
                    finishWithCancel("保险库解锁失败")
                    return@launch
                }
            }

            // IO 线程加载并解密 LOGIN 凭据
            val loginCiphers = withContext(Dispatchers.IO) {
                val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""
                cipherRepository.getAllLoginCiphers(userId)
                    .mapNotNull { vaultSession.decryptCipher(it) }
            }

            setContent {
                PwBookTheme {
                    PasskeyCreateSelectScreen(
                        rpId = rpId,
                        ciphers = loginCiphers,
                        onSelect = { cipherId ->
                            lifecycleScope.launch {
                                try {
                                    val response = createPasskey(requestJson, callingAppInfo?.packageName, cipherId, origin)
                                    Timber.d("createPasskey response length=${response.length}")

                                    val result = Intent()
                                    PendingIntentHandler.setCreateCredentialResponse(
                                        result,
                                        androidx.credentials.CreatePublicKeyCredentialResponse(response)
                                    )
                                    setResult(RESULT_OK, result)
                                    Timber.d("setResult RESULT_OK")
                                } catch (e: Exception) {
                                    Timber.e(e, "Passkey create failed")
                                    setResult(RESULT_CANCELED)
                                }
                                finish()
                            }
                        },
                        onCancel = {
                            finishWithCancel("用户取消选择")
                        }
                    )
                }
            }
        }
    }

    private suspend fun createPasskey(
        requestJson: String,
        callingPackage: String?,
        targetCipherId: String?,
        origin: String
    ): String {
        Timber.d("createPasskey callingPackage=$callingPackage targetCipherId=$targetCipherId origin=$origin")
        val request = org.json.JSONObject(requestJson)
        val rp = request.getJSONObject("rp")
        val rpId = rp.optString("id", "")
        val rpName = rp.optString("name", "")
        val user = request.getJSONObject("user")
        val userId = user.getString("id") // Base64Url
        val userName = user.optString("name", "")
        val displayName = user.optString("displayName", userName)
        val challenge = request.getString("challenge")
        Timber.d("createPasskey rpId=$rpId userName=$userName")

        // 生成 EC P-256 密钥对
        val keyPair = PasskeyCrypto.generateEcKeyPair()
        val credentialIdBytes = ByteArray(32).apply { SecureRandom().nextBytes(this) }
        val credentialId = PasskeyCrypto.base64UrlEncode(credentialIdBytes)
        Timber.d("createPasskey credentialId=$credentialId")

        // 导出密钥格式
        val privateKeyPkcs8 = PasskeyCrypto.base64Encode(keyPair.private.encoded)
        val publicKeySpki = PasskeyCrypto.base64Encode(keyPair.public.encoded)

        // 构建 WebAuthn 响应
        val clientDataJSON = PasskeyCrypto.buildClientDataJSON("webauthn.create", challenge, origin)
        val clientDataHash = PasskeyCrypto.rpIdHash(clientDataJSON)

        val coseKey = PasskeyCrypto.encodeCoseKeyEs256(keyPair.public as ECPublicKey)
        val authData = PasskeyCrypto.buildAuthenticatorData(
            rpId = rpId,
            signCount = 0,
            includeAttestedCredentialData = true,
            credentialId = credentialIdBytes,
            publicKeyCose = coseKey
        )
        Timber.d("createPasskey authData size=${authData.size}")

        val attestationObject = PasskeyCrypto.encodeAttestationObjectNone(authData)
        Timber.d("createPasskey attestationObject size=${attestationObject.size}")

        // 构建响应 JSON
        val responseJson = org.json.JSONObject().apply {
            put("id", credentialId)
            put("rawId", credentialId)
            put("type", "public-key")
            put("authenticatorAttachment", "platform")
            put("response", org.json.JSONObject().apply {
                put("clientDataJSON", PasskeyCrypto.base64UrlEncode(clientDataJSON.toByteArray(Charsets.UTF_8)))
                put("attestationObject", PasskeyCrypto.base64UrlEncode(attestationObject))
                put("authenticatorData", PasskeyCrypto.base64UrlEncode(authData))
                put("publicKeyAlgorithm", -7)
                put("publicKey", PasskeyCrypto.base64UrlEncode(keyPair.public.encoded))
                put("transports", org.json.JSONArray().put("internal"))
            })
            put("clientExtensionResults", org.json.JSONObject().apply {
                put("credProps", org.json.JSONObject().apply { put("rk", false) })
            })
        }.toString()
        Timber.d("createPasskey responseJson prepared")

        // 保存到密码库
        Timber.d("createPasskey saving to vault...")
        passkeyVaultWriter.savePasskey(
            passkeyData = PasskeyData(
                credentialId = credentialId,
                privateKey = privateKeyPkcs8,
                publicKey = publicKeySpki,
                rpId = rpId,
                rpName = rpName,
                userHandle = userId,
                userName = userName,
                userDisplayName = displayName,
                counter = 0,
                createdAt = Instant.now().toString()
            ),
            rpId = rpId,
            userName = userName,
            targetCipherId = targetCipherId
        )
        Timber.i("Passkey created for rpId=$rpId, credentialId=$credentialId")
        return responseJson
    }

    private fun finishWithCancel(reason: String) {
        Timber.w("Passkey create cancelled: $reason")
        setResult(RESULT_CANCELED)
        finish()
    }

}
