package com.pwbook.data.remote.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import javax.inject.Inject

class CipherApi @Inject constructor(private val client: HttpClient) {

    suspend fun getCiphers(): List<CipherDto> {
        return client.get("api/ciphers").body()
    }

    suspend fun createCipher(cipher: CipherDto): CipherDto {
        return client.post("api/ciphers") { setBody(cipher) }.body()
    }

    suspend fun updateCipher(id: String, cipher: CipherDto): CipherDto {
        return client.put("api/ciphers/$id") { setBody(cipher) }.body()
    }

    suspend fun deleteCipher(id: String) {
        client.delete("api/ciphers/$id")
    }
}
