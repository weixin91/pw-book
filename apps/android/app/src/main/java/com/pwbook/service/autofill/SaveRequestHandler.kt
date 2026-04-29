package com.pwbook.service.autofill

import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.LoginDataJson
import com.pwbook.domain.LoginUriJson
import com.pwbook.domain.VaultSession
import com.pwbook.domain.matcher.UriMatcher
import com.pwbook.sync.PendingChangesQueue
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject

class SaveRequestHandler @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val vaultEncryption: VaultEncryption,
    private val pendingChangesQueue: PendingChangesQueue,
    private val securePrefs: SecurePrefs,
    private val json: Json
) {

    suspend fun handle(saveData: SaveData): Boolean {
        val userKey = vaultSession.getUserKey() ?: run {
            Timber.w("SaveRequest: vault is locked, cannot save")
            return false
        }

        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""
        val baseDomain = saveData.webDomain?.let { UriMatcher.getBaseDomain(it) }
            ?: saveData.packageName

        // 检查是否已存在相同凭据
        val existingCiphers = cipherRepository.getCiphers(userId)
        val existing = existingCiphers.mapNotNull { vaultSession.decryptCipher(it) }
            .find { cipher ->
                cipher.uris.any { uri ->
                    UriMatcher.isMatch(saveData.uriString, uri, emptyList())
                }
            }

        val now = System.currentTimeMillis()
        val cipherData = CipherDataJson(
            name = saveData.webDomain ?: saveData.packageName,
            login = LoginDataJson(
                username = saveData.username,
                password = saveData.password,
                uris = listOf(LoginUriJson(uri = saveData.uriString))
            )
        )
        val encryptedData = vaultEncryption.encryptString(json.encodeToString(cipherData), userKey)

        return if (existing != null) {
            val entity = CipherEntity(
                id = existing.id,
                userId = userId,
                type = 1,
                data = encryptedData,
                favorite = existing.favorite,
                reprompt = 0,
                createdAt = existing.modifiedAt,
                modifiedAt = now
            )
            cipherRepository.saveCipher(entity)
            pendingChangesQueue.enqueue(existing.id, PendingChangesQueue.Operation.UPDATE, encryptedData, now)
            Timber.i("SaveRequest: updated existing cipher ${existing.id}")
            true
        } else {
            val id = UUID.randomUUID().toString()
            val entity = CipherEntity(
                id = id,
                userId = userId,
                type = 1,
                data = encryptedData,
                favorite = false,
                reprompt = 0,
                createdAt = now,
                modifiedAt = now
            )
            cipherRepository.saveCipher(entity)
            pendingChangesQueue.enqueue(id, PendingChangesQueue.Operation.CREATE, encryptedData, now)
            Timber.i("SaveRequest: created new cipher $id")
            true
        }
    }
}
