package com.pwbook.data.repository

import com.pwbook.data.local.dao.CipherDao
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.domain.VaultSession
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CipherRepository @Inject constructor(
    private val cipherDao: CipherDao,
    private val vaultSession: VaultSession
) {
    fun observeCiphers(userId: String): Flow<List<CipherEntity>> = cipherDao.observeAll(userId)

    suspend fun getCiphers(userId: String): List<CipherEntity> = cipherDao.getAll(userId)

    suspend fun getCipher(id: String): CipherEntity? = cipherDao.getById(id)

    suspend fun saveCipher(entity: CipherEntity) = cipherDao.insert(entity)

    suspend fun saveCiphers(entities: List<CipherEntity>) = cipherDao.insertAll(entities)

    suspend fun updateCipher(entity: CipherEntity) = cipherDao.update(entity)

    suspend fun deleteCipher(entity: CipherEntity) = cipherDao.delete(entity)

    suspend fun deleteCipher(id: String) = cipherDao.deleteById(id)

    suspend fun clearUserCiphers(userId: String) = cipherDao.deleteAllByUser(userId)

    /**
     * 查找指定 rpId 的 LOGIN 凭据（含 Passkey）。
     * 因 rpId 存储在加密 JSON 中，需遍历解密后匹配。
     */
    suspend fun findByRpId(userId: String, rpId: String): List<CipherEntity> {
        val ciphers = cipherDao.getAllByType(userId, 1)
        return ciphers.filter { entity ->
            val decrypted = vaultSession.decryptCipher(entity)
            decrypted?.passkey?.rpId == rpId
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
