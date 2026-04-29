package com.pwbook.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.pwbook.data.local.entity.RejectedSiteEntity

@Dao
interface RejectedSiteDao {

    @Query("SELECT * FROM rejected_site WHERE userId = :userId AND domain = :domain LIMIT 1")
    suspend fun get(userId: String, domain: String): RejectedSiteEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: RejectedSiteEntity)

    @Query("DELETE FROM rejected_site WHERE expireAt < :now")
    suspend fun deleteExpired(now: Long)

    @Query("DELETE FROM rejected_site WHERE userId = :userId AND domain = :domain")
    suspend fun delete(userId: String, domain: String)
}
