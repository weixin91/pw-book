package com.pwbook.data.remote.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import javax.inject.Inject

class AuthApi @Inject constructor(private val client: HttpClient) {

    suspend fun login(request: LoginRequest): AuthResponse {
        return client.post("api/auth/login") { setBody(request) }.body()
    }

    suspend fun register(request: RegisterRequest): AuthResponse {
        return client.post("api/auth/register") { setBody(request) }.body()
    }
}

@kotlinx.serialization.Serializable
data class LoginRequest(val email: String, val masterPasswordHash: String)

@kotlinx.serialization.Serializable
data class RegisterRequest(
    val email: String,
    val masterPasswordHash: String,
    val protectedKey: String,
    val publicKey: String,
    val encryptedPrivateKey: String,
    val kdfType: String,
    val kdfIterations: Int,
    val kdfMemory: Int? = null,
    val kdfParallelism: Int? = null
)

@kotlinx.serialization.Serializable
data class AuthResponse(
    val accessToken: String,
    val refreshToken: String,
    val userId: String,
    val email: String,
    val kdfType: String,
    val kdfIterations: Int,
    val kdfMemory: Int? = null,
    val kdfParallelism: Int? = null,
    val protectedKey: String,
    val publicKey: String,
    val encryptedPrivateKey: String,
    val securityStamp: String
)
