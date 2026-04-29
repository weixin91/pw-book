package com.pwbook.data.remote.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import javax.inject.Inject

class SyncApi @Inject constructor(private val client: HttpClient) {

    suspend fun sync(since: Long? = null): SyncResponse {
        return client.get("api/sync") {
            since?.let { parameter("since", it) }
        }.body()
    }

    suspend fun push(request: PushRequest): SyncResponse {
        return client.post("api/sync/push") { setBody(request) }.body()
    }
}

@kotlinx.serialization.Serializable
data class SyncResponse(
    val ciphers: List<CipherDto>,
    val domainAssociations: List<DomainAssocDto>,
    val lastSyncAt: Long
)

@kotlinx.serialization.Serializable
data class PushRequest(
    val ciphers: List<CipherDto>,
    val domainAssociations: List<DomainAssocDto>? = null
)

@kotlinx.serialization.Serializable
data class CipherDto(
    val id: String,
    val type: Int,
    val data: String,
    val favorite: Boolean = false,
    val reprompt: Int = 0,
    val createdAt: Long,
    val modifiedAt: Long
)

@kotlinx.serialization.Serializable
data class DomainAssocDto(
    val id: String,
    val domains: List<String>,
    val packageNames: List<String>,
    val createdAt: Long
)
