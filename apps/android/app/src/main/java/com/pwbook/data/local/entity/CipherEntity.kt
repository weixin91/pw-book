package com.pwbook.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "cipher",
    indices = [
        Index(value = ["userId", "modifiedAt"]),
        Index(value = ["userId"])
    ]
)
data class CipherEntity(
    @PrimaryKey
    val id: String,
    val userId: String,
    val type: Int,
    val data: String,
    val favorite: Boolean = false,
    val reprompt: Int = 0,
    val createdAt: Long,
    val modifiedAt: Long
)
