package com.pwbook.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.pwbook.data.local.entity.CipherEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CipherDao {

    @Query("SELECT * FROM cipher WHERE userId = :userId ORDER BY favorite DESC, modifiedAt DESC")
    fun observeAll(userId: String): Flow<List<CipherEntity>>

    @Query("SELECT * FROM cipher WHERE userId = :userId ORDER BY favorite DESC, modifiedAt DESC")
    suspend fun getAll(userId: String): List<CipherEntity>

    @Query("SELECT * FROM cipher WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): CipherEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: CipherEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(entities: List<CipherEntity>)

    @Update
    suspend fun update(entity: CipherEntity)

    @Delete
    suspend fun delete(entity: CipherEntity)

    @Query("DELETE FROM cipher WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM cipher WHERE userId = :userId")
    suspend fun deleteAllByUser(userId: String)

    @Query("SELECT * FROM cipher WHERE userId = :userId AND type = :type ORDER BY modifiedAt DESC")
    suspend fun getAllByType(userId: String, type: Int): List<CipherEntity>
}
