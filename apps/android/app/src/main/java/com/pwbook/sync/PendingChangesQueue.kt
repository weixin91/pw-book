package com.pwbook.sync

import com.pwbook.data.local.dao.SyncQueueDao
import com.pwbook.data.local.entity.SyncQueueEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PendingChangesQueue @Inject constructor(
    private val syncQueueDao: SyncQueueDao
) {

    suspend fun enqueue(
        cipherId: String?,
        operation: Operation,
        encryptedData: String?,
        clientTimestamp: Long = System.currentTimeMillis()
    ) {
        val entity = SyncQueueEntity(
            id = UUID.randomUUID().toString(),
            cipherId = cipherId ?: UUID.randomUUID().toString(),
            operation = operation.name,
            encryptedData = encryptedData,
            clientTimestamp = clientTimestamp,
            retryCount = 0,
            createdAt = System.currentTimeMillis()
        )
        syncQueueDao.insert(entity)
        Timber.d("Enqueued pending change: op=${operation.name}, cipherId=$cipherId")
    }

    suspend fun getAll(): List<SyncQueueEntity> {
        return syncQueueDao.getAll()
    }

    fun observeCount(): Flow<Int> {
        return syncQueueDao.observeCount().map { it ?: 0 }
    }

    suspend fun remove(id: String) {
        syncQueueDao.deleteById(id)
    }

    suspend fun incrementRetry(id: String) {
        syncQueueDao.incrementRetry(id)
    }

    suspend fun clear() {
        syncQueueDao.clearAll()
    }

    suspend fun removeByCipherId(cipherId: String) {
        syncQueueDao.deleteByCipherId(cipherId)
    }

    enum class Operation {
        CREATE, UPDATE, DELETE
    }
}
