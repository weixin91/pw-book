package com.pwbook.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "rejected_site")
data class RejectedSiteEntity(
    @PrimaryKey
    val id: String,
    val userId: String,
    val domain: String,
    val rejectedAt: Long,
    val expireAt: Long
)
