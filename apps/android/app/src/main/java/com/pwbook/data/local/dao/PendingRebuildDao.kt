package com.pwbook.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.pwbook.data.local.entity.PendingRebuildEntity

@Dao
interface PendingRebuildDao {

    @Query("SELECT cipherId FROM pending_rebuild WHERE userId = :userId")
    suspend fun getAll(userId: String): List<String>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: PendingRebuildEntity)

    @Query("DELETE FROM pending_rebuild WHERE cipherId = :cipherId")
    suspend fun deleteById(cipherId: String)

    @Query("DELETE FROM pending_rebuild WHERE userId = :userId")
    suspend fun deleteAllByUser(userId: String)
}
