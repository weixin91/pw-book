package com.pwbook.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "pending_rebuild",
    indices = [
        Index(value = ["userId"])
    ]
)
data class PendingRebuildEntity(
    @PrimaryKey
    val cipherId: String,

    val userId: String
)
