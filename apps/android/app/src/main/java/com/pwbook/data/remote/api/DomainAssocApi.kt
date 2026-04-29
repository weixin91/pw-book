package com.pwbook.data.remote.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import javax.inject.Inject

class DomainAssocApi @Inject constructor(private val client: HttpClient) {

    suspend fun getRules(): List<DomainAssocDto> {
        return client.get("api/domain-assoc").body()
    }

    suspend fun createRule(rule: DomainAssocDto): DomainAssocDto {
        return client.post("api/domain-assoc") { setBody(rule) }.body()
    }

    suspend fun updateRule(id: String, rule: DomainAssocDto): DomainAssocDto {
        return client.put("api/domain-assoc/$id") { setBody(rule) }.body()
    }

    suspend fun deleteRule(id: String) {
        client.delete("api/domain-assoc/$id")
    }
}
