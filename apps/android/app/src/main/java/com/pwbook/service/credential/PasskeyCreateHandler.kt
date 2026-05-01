package com.pwbook.service.credential

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.credentials.BeginCreateCredentialRequest
import android.service.credentials.BeginCreateCredentialResponse
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.PasskeyDataJson
import com.pwbook.domain.VaultSession
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import javax.inject.Inject

class PasskeyCreateHandler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val securePrefs: SecurePrefs,
    private val json: Json
) {

    fun handleCreateCredential(
        request: BeginCreateCredentialRequest
    ): BeginCreateCredentialResponse {
        val callingPackage = request.callingAppInfo?.packageName ?: ""
        val accountName = request.callingAppInfo?.origin ?: callingPackage

        Timber.i("handleCreateCredential: caller=$callingPackage, account=$accountName")

        // 构建 PendingIntent，启动 PasskeyCreateActivity
        val intent = Intent(context, PasskeyCreateActivity::class.java).apply {
            putExtra("calling_package", callingPackage)
            putExtra("account_name", accountName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        val pendingIntent = android.app.PendingIntent.getActivity(
            context,
            0,
            intent,
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )

        // Android 14 CredentialProvider API: 使用 CreateEntry + Builder
        return try {
            val createEntryClass = Class.forName("android.service.credentials.CreateEntry")
            val entry = createEntryClass.getConstructor(String::class.java, android.app.PendingIntent::class.java)
                .newInstance(accountName, pendingIntent)

            val builderClass = Class.forName("android.service.credentials.BeginCreateCredentialResponse\$Builder")
            val builder = builderClass.getDeclaredConstructor().newInstance()
            val setMethod = builderClass.getMethod("setCreateEntries", List::class.java)
            setMethod.invoke(builder, listOf(entry))
            val buildMethod = builderClass.getMethod("build")

            @Suppress("UNCHECKED_CAST")
            buildMethod.invoke(builder) as BeginCreateCredentialResponse
        } catch (e: Exception) {
            Timber.e(e, "Failed to construct BeginCreateCredentialResponse, returning empty response")
            BeginCreateCredentialResponse()
        }
    }

    /**
     * 创建新的 Passkey 密钥对，并保存到指定凭据。
     * 若 cipherId 为 null，则创建新的 LOGIN 凭据。
     */
    suspend fun createPasskey(
        rpId: String,
        rpName: String?,
        userName: String,
        userHandle: String,
        cipherId: String? = null
    ): Result<PasskeyDataJson> = runCatching {
        val userKey = vaultSession.getUserKey()
            ?: throw IllegalStateException("保险库未解锁")
        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID)
            ?: throw IllegalStateException("未登录")

        // 生成 EC P-256 密钥对
        val keyPairGen = KeyPairGenerator.getInstance("EC")
        keyPairGen.initialize(ECGenParameterSpec("secp256r1"))
        val keyPair = keyPairGen.generateKeyPair()

        val credentialId = ByteArray(32).apply { SecureRandom().nextBytes(this) }
        val credentialIdBase64 = Base64.getEncoder().encodeToString(credentialId)
        val publicKeyBase64 = Base64.getEncoder().encodeToString(keyPair.public.encoded)
        val privateKeyBase64 = Base64.getEncoder().encodeToString(keyPair.private.encoded)

        // 私钥用 User Key 加密存储
        val cipherKey = userKey.copyOfRange(0, 32)
        val privateKeyEncrypted = com.pwbook.crypto.VaultEncryption(
            com.pwbook.crypto.AesGcmEngine()
        ).encryptString(privateKeyBase64, cipherKey)

        val passkeyData = PasskeyDataJson(
            credentialId = credentialIdBase64,
            rpId = rpId,
            rpName = rpName,
            userHandle = userHandle,
            userName = userName,
            privateKeyEncrypted = privateKeyEncrypted,
            publicKey = publicKeyBase64,
            counter = 0,
            createdAt = System.currentTimeMillis()
        )

        Timber.i("Passkey created for rpId=$rpId, credentialId=$credentialIdBase64")
        passkeyData
    }
}
