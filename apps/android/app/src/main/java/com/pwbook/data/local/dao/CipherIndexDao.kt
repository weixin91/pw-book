package com.pwbook.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.pwbook.data.local.entity.CipherIndexEntity

@Dao
interface CipherIndexDao {

    @Query("SELECT * FROM cipher_index WHERE userId = :userId")
    suspend fun getAll(userId: String): List<CipherIndexEntity>

    @Query("SELECT cipherId FROM cipher_index WHERE userId = :userId")
    suspend fun getAllCipherIds(userId: String): List<String>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: CipherIndexEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(entities: List<CipherIndexEntity>)

    @Query("DELETE FROM cipher_index WHERE cipherId = :cipherId")
    suspend fun deleteById(cipherId: String)

    @Query("DELETE FROM cipher_index WHERE userId = :userId")
    suspend fun deleteAllByUser(userId: String)
}
