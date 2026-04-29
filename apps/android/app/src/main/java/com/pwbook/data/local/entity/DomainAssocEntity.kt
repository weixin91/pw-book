package com.pwbook.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "domain_association")
data class DomainAssocEntity(
    @PrimaryKey
    val id: String,
    val userId: String,
    val domains: String,
    val packageNames: String,
    val createdAt: Long
)
