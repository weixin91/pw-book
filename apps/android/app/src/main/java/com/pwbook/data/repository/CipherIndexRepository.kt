package com.pwbook.data.repository

import com.pwbook.data.local.dao.CipherIndexDao
import com.pwbook.data.local.dao.PendingRebuildDao
import com.pwbook.data.local.entity.CipherIndexEntity
import com.pwbook.data.local.entity.PendingRebuildEntity
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CipherIndexRepository @Inject constructor(
    private val cipherIndexDao: CipherIndexDao,
    private val pendingRebuildDao: PendingRebuildDao
) {

    suspend fun getAll(userId: String): List<CipherIndexEntity> =
        cipherIndexDao.getAll(userId)

    suspend fun getAllCipherIds(userId: String): List<String> =
        cipherIndexDao.getAllCipherIds(userId)

    suspend fun insert(entity: CipherIndexEntity) =
        cipherIndexDao.insert(entity)

    suspend fun insertAll(entities: List<CipherIndexEntity>) =
        cipherIndexDao.insertAll(entities)

    suspend fun deleteById(cipherId: String) =
        cipherIndexDao.deleteById(cipherId)

    suspend fun deleteAllByUser(userId: String) =
        cipherIndexDao.deleteAllByUser(userId)

    suspend fun getPendingRebuildIds(userId: String): List<String> =
        pendingRebuildDao.getAll(userId)

    suspend fun markPendingRebuild(entity: PendingRebuildEntity) =
        pendingRebuildDao.insert(entity)

    suspend fun removePendingRebuild(cipherId: String) =
        pendingRebuildDao.deleteById(cipherId)

    suspend fun clearPendingRebuild(userId: String) =
        pendingRebuildDao.deleteAllByUser(userId)
}
