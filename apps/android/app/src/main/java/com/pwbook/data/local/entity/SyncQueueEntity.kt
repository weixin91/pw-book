package com.pwbook.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "sync_queue",
    indices = [Index(value = ["cipherId"])]
)
data class SyncQueueEntity(
    @PrimaryKey
    val id: String,
    val cipherId: String?,
    val operation: String,
    val encryptedData: String?,
    val clientTimestamp: Long,
    val retryCount: Int = 0,
    val createdAt: Long
)
