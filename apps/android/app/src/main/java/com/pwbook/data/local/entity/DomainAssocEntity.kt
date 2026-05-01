package com.pwbook.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "domain_association",
    indices = [Index(value = ["userId"])]
)
data class DomainAssocEntity(
    @PrimaryKey
    val id: String,
    val userId: String,
    val domains: String,
    val packageNames: String,
    val createdAt: Long
)
