package com.pwbook.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.pwbook.data.local.entity.SyncQueueEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SyncQueueDao {

    @Query("SELECT * FROM sync_queue ORDER BY createdAt ASC")
    suspend fun getAll(): List<SyncQueueEntity>

    @Insert
    suspend fun insert(entity: SyncQueueEntity)

    @Query("DELETE FROM sync_queue WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM sync_queue WHERE cipherId = :cipherId")
    suspend fun deleteByCipherId(cipherId: String)

    @Query("DELETE FROM sync_queue")
    suspend fun clearAll()

    @Query("SELECT COUNT(*) FROM sync_queue")
    suspend fun count(): Int

    @Query("SELECT COUNT(*) FROM sync_queue")
    fun observeCount(): Flow<Int?>

    @Query("UPDATE sync_queue SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: String)
}
