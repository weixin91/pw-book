package com.pwbook.data.repository

import com.pwbook.data.local.dao.CipherDao
import com.pwbook.data.local.entity.CipherEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CipherRepository @Inject constructor(
    private val cipherDao: CipherDao
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
}
