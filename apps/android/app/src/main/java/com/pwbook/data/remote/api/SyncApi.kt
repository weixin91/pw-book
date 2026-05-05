package com.pwbook.data.remote.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import javax.inject.Inject

class SyncApi @Inject constructor(private val client: HttpClient) {

    suspend fun sync(since: String? = null): SyncResponse {
        return client.get("api/sync") {
            since?.let { parameter("since", it) }
        }.body()
    }

    suspend fun push(request: PushRequest): PushResponse {
        return client.post("api/sync/push") { setBody(request) }.body()
    }
}

@kotlinx.serialization.Serializable
data class SyncResponse(
    val profile: ProfileDto? = null,
    val ciphers: List<CipherDto> = emptyList(),
    val deletedCipherIds: List<String> = emptyList(),
    val domainAssociations: List<DomainAssocDto> = emptyList(),
    val syncToken: String? = null,
    val checksum: String? = null
)

@kotlinx.serialization.Serializable
data class ProfileDto(
    val id: String,
    val email: String,
    val kdfType: String,
    val kdfIterations: Int,
    val kdfMemory: Int? = null,
    val kdfParallelism: Int? = null,
    val publicKey: String,
    val securityStamp: String
)

@kotlinx.serialization.Serializable
data class PushRequest(
    val changes: List<PushChangeDto> = emptyList(),
    val lastSyncToken: String? = null
)

@kotlinx.serialization.Serializable
data class PushChangeDto(
    val id: String,
    val type: String,  // CREATE, UPDATE, DELETE
    val cipher: CipherDto,
    val clientTimestamp: String
)

@kotlinx.serialization.Serializable
data class PushResponse(
    val accepted: List<String> = emptyList(),
    val rejected: List<String> = emptyList(),
    val conflicts: List<String> = emptyList(),
    val newSyncToken: String? = null,
    val checksum: String? = null
)

@kotlinx.serialization.Serializable
data class CipherDto(
    val id: String,
    val type: Int,
    val data: String,
    val favorite: Boolean = false,
    val reprompt: Int = 0,
    val createdAt: String,
    val modifiedAt: String
) {
    fun createdAtMillis(): Long = parseIsoDateToMillis(createdAt)
    fun modifiedAtMillis(): Long = parseIsoDateToMillis(modifiedAt)
}

@kotlinx.serialization.Serializable
data class DomainAssocDto(
    val id: String,
    val domains: List<String>,
    val packageNames: List<String>,
    val createdAt: String
) {
    fun createdAtMillis(): Long = parseIsoDateToMillis(createdAt)
}

fun parseIsoDateToMillis(isoDate: String): Long {
    return try {
        // ISO 8601 格式: "2026-04-29T15:03:24.759Z"
        val pattern = java.time.format.DateTimeFormatter.ISO_INSTANT
        java.time.Instant.from(pattern.parse(isoDate)).toEpochMilli()
    } catch (e: Exception) {
        0L
    }
}
