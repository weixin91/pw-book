package com.pwbook.service.credential

import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.LoginDataJson
import com.pwbook.domain.LoginUriJson
import com.pwbook.domain.PasskeyDataJson
import com.pwbook.domain.VaultSession
import com.pwbook.domain.model.PasskeyData
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Passkey 保存策略。
 *
 * 遵循 FR-008：创建 Passkey 时优先附加到同一站点已存在的 LOGIN 凭据。
 * 若不存在，则新建 LOGIN 凭据。
 */
@Singleton
class PasskeyVaultWriter @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val vaultEncryption: VaultEncryption,
    private val pendingChangesQueue: PendingChangesQueue,
    private val syncManager: SyncManager,
    private val securePrefs: SecurePrefs,
    private val json: Json
) {

    suspend fun savePasskey(
        passkeyData: PasskeyData,
        rpId: String,
        userName: String,
        targetCipherId: String? = null
    ) {
        val userKey = vaultSession.getUserKey()
            ?: throw IllegalStateException("保险库未解锁")
        val cipherKey = userKey.copyOfRange(0, 32)
        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""

        val now = System.currentTimeMillis()

        if (targetCipherId != null) {
            // 附加到指定凭据
            val targetCipher = cipherRepository.getCipher(targetCipherId)
                ?: throw IllegalStateException("指定凭据不存在")

            val decrypted = vaultSession.decryptCipher(targetCipher)
                ?: throw IllegalStateException("无法解密指定凭据")

            val updatedData = CipherDataJson(
                name = decrypted.name,
                notes = decrypted.notes,
                login = LoginDataJson(
                    username = decrypted.username,
                    password = decrypted.password,
                    uris = decrypted.uris.map { LoginUriJson(uri = it) },
                    totp = decrypted.totp
                ),
                passkey = passkeyData.toJson(),
                lastUsedAt = java.time.Instant.now().toString(),
                fields = emptyList()
            )
            val encryptedData = vaultEncryption.encryptString(
                json.encodeToString(updatedData),
                cipherKey
            )
            val updatedEntity = targetCipher.copy(
                data = encryptedData,
                modifiedAt = now
            )
            cipherRepository.saveCipher(updatedEntity)
            pendingChangesQueue.enqueue(
                targetCipher.id,
                PendingChangesQueue.Operation.UPDATE,
                encryptedData,
                now
            )
            syncManager.launchSyncAll()
            Timber.i("Passkey 附加到指定凭据 ${targetCipher.id}")
        } else {
            // 新建 LOGIN 凭据
            val newData = CipherDataJson(
                name = passkeyData.rpName ?: rpId,
                notes = null,
                login = LoginDataJson(
                    username = userName.ifEmpty { null },
                    password = null,
                    uris = listOf(LoginUriJson(uri = "https://$rpId")),
                    totp = null
                ),
                passkey = passkeyData.toJson(),
                lastUsedAt = java.time.Instant.now().toString(),
                fields = emptyList()
            )
            val encryptedData = vaultEncryption.encryptString(
                json.encodeToString(newData),
                cipherKey
            )
            val newCipher = CipherEntity(
                id = UUID.randomUUID().toString(),
                userId = userId,
                type = 1, // LOGIN
                data = encryptedData,
                favorite = false,
                reprompt = 0,
                createdAt = now,
                modifiedAt = now
            )
            cipherRepository.saveCipher(newCipher)
            pendingChangesQueue.enqueue(
                newCipher.id,
                PendingChangesQueue.Operation.CREATE,
                encryptedData,
                now
            )
            syncManager.launchSyncAll()
            Timber.i("Passkey 保存到新建凭据 ${newCipher.id}")
        }
    }

    private fun PasskeyData.toJson(): PasskeyDataJson {
        return PasskeyDataJson(
            credentialId = credentialId,
            privateKey = privateKey,
            publicKey = publicKey,
            rpId = rpId,
            rpName = rpName,
            userHandle = userHandle,
            userName = userName,
            userDisplayName = userDisplayName,
            counter = counter,
            createdAt = createdAt
        )
    }
}
