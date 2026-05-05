package com.pwbook.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "cipher_index",
    indices = [
        Index(value = ["userId"])
    ]
)
data class CipherIndexEntity(
    @PrimaryKey
    val cipherId: String,

    val userId: String,

    /** login.uris 经 UriMatcher 提取后的 baseDomain 列表，JSON 数组字符串 */
    val domainsJson: String,

    /** passkey.rpId 列表（已小写），JSON 数组字符串 */
    val rpIdsJson: String,

    /** 是否包含 login 数据 */
    val hasLogin: Boolean,

    /** 是否包含 passkey 数据 */
    val hasPasskey: Boolean
)
