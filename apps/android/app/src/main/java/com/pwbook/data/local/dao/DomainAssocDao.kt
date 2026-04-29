package com.pwbook.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.pwbook.data.local.entity.DomainAssocEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DomainAssocDao {

    @Query("SELECT * FROM domain_association WHERE userId = :userId")
    fun observeAll(userId: String): Flow<List<DomainAssocEntity>>

    @Query("SELECT * FROM domain_association WHERE userId = :userId")
    suspend fun getAll(userId: String): List<DomainAssocEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: DomainAssocEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(entities: List<DomainAssocEntity>)

    @Query("DELETE FROM domain_association WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM domain_association WHERE userId = :userId")
    suspend fun deleteAllByUser(userId: String)
}
