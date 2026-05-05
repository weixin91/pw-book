package com.pwbook.data.repository

import com.pwbook.data.local.dao.CipherDao
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.domain.VaultSession
import com.pwbook.domain.index.CipherIndexStore
import kotlinx.coroutines.flow.Flow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CipherRepository @Inject constructor(
    private val cipherDao: CipherDao,
    private val vaultSession: VaultSession,
    private val cipherIndexStore: CipherIndexStore
) {
    fun observeCiphers(userId: String): Flow<List<CipherEntity>> = cipherDao.observeAll(userId)

    suspend fun getCiphers(userId: String): List<CipherEntity> = cipherDao.getAll(userId)

    suspend fun getCipher(id: String): CipherEntity? = cipherDao.getById(id)

    suspend fun saveCipher(entity: CipherEntity) {
        cipherDao.insert(entity)
        runCatching {
            cipherIndexStore.upsert(entity, vaultSession)
        }.onFailure {
            Timber.e(it, "Failed to update index for cipher ${entity.id}")
        }
    }

    suspend fun saveCiphers(entities: List<CipherEntity>) = cipherDao.insertAll(entities)

    suspend fun updateCipher(entity: CipherEntity) {
        cipherDao.update(entity)
        runCatching {
            cipherIndexStore.upsert(entity, vaultSession)
        }.onFailure {
            Timber.e(it, "Failed to update index for cipher ${entity.id}")
        }
    }

    suspend fun deleteCipher(entity: CipherEntity) {
        cipherDao.delete(entity)
        runCatching {
            cipherIndexStore.removeOne(entity.id)
        }.onFailure {
            Timber.e(it, "Failed to remove index for cipher ${entity.id}")
        }
    }

    suspend fun deleteCipher(id: String) {
        cipherDao.deleteById(id)
        runCatching {
            cipherIndexStore.removeOne(id)
        }.onFailure {
            Timber.e(it, "Failed to remove index for cipher $id")
        }
    }

    suspend fun clearUserCiphers(userId: String) {
        cipherDao.deleteAllByUser(userId)
        runCatching {
            cipherIndexStore.clear(userId)
        }.onFailure {
            Timber.e(it, "Failed to clear index for user $userId")
        }
    }

    /**
     * 查找指定 rpId 的 LOGIN 凭据（含 Passkey）。
     * 因 rpId 存储在加密 JSON 中，需遍历解密后匹配。
     */
    /**
     * 获取用户所有 LOGIN 类型凭据。
     */
    suspend fun getAllLoginCiphers(userId: String): List<CipherEntity> {
        return cipherDao.getAllByType(userId, 1)
    }

    suspend fun findByRpId(userId: String, rpId: String): List<CipherEntity> {
        val ciphers = cipherDao.getAllByType(userId, 1)
        val rpIdLower = rpId.lowercase()
        return ciphers.filter { entity ->
            val decrypted = vaultSession.decryptCipher(entity)
            decrypted?.passkey?.rpId?.lowercase() == rpIdLower
        }
    }

    /**
     * 按 credentialId 查找包含该 Passkey 的凭据。
     * 因 credentialId 存储在加密 JSON 中，需遍历解密后匹配。
     */
    suspend fun findByCredentialId(userId: String, credentialId: String): CipherEntity? {
        val ciphers = cipherDao.getAllByType(userId, 1)
        return ciphers.find { entity ->
            val decrypted = vaultSession.decryptCipher(entity)
            decrypted?.passkey?.credentialId == credentialId
        }
    }
}
