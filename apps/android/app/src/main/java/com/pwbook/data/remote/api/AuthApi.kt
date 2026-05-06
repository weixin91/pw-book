package com.pwbook.data.remote.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject

class AuthApi @Inject constructor(private val client: HttpClient) {

    suspend fun prelogin(email: String): PreloginResponse {
        return client.post("api/auth/prelogin") {
            setBody(PreloginRequest(email))
        }.body()
    }

    suspend fun login(request: LoginRequest): LoginResponse {
        val response = client.post("api/auth/login") { setBody(request) }
        if (response.status.value < 200 || response.status.value >= 300) {
            val errorBody = response.bodyAsText()
            Timber.e("Login failed with status ${response.status}: $errorBody")
            throw Exception(parseErrorMessage(errorBody) ?: "登录失败")
        }
        return response.body()
    }

    suspend fun register(request: RegisterRequest): RegisterResponse {
        val response = client.post("api/auth/register") { setBody(request) }
        if (response.status.value < 200 || response.status.value >= 300) {
            val errorBody = response.bodyAsText()
            Timber.e("Register failed with status ${response.status}: $errorBody")
            throw Exception(parseErrorMessage(errorBody) ?: "注册失败")
        }
        return response.body()
    }

    suspend fun refresh(refreshToken: String): RefreshResponse {
        return client.post("api/auth/refresh") {
            setBody(RefreshRequest(refreshToken))
        }.body()
    }

    private fun parseErrorMessage(jsonStr: String): String? {
        return try {
            val obj = Json.parseToJsonElement(jsonStr) as kotlinx.serialization.json.JsonObject
            (obj["error"] as? kotlinx.serialization.json.JsonObject)?.get("message")?.toString()?.removeSurrounding("\"")
        } catch (e: Exception) {
            null
        }
    }
}

@Serializable
data class PreloginRequest(val email: String)

@Serializable
data class PreloginResponse(
    val kdfType: String,
    val kdfIterations: Int,
    val kdfMemory: Int? = null,
    val kdfParallelism: Int? = null
)

@Serializable
data class LoginRequest(
    val email: String,
    val masterPasswordHash: String,
    val deviceId: String,
    val deviceType: String = "ANDROID",
    val deviceName: String = "Android Device"
)

@Serializable
data class LoginResponse(
    val id: String,
    val token: String,
    val refreshToken: String,
    val protectedKey: String,
    val securityStamp: String
)

@Serializable
data class RegisterRequest(
    val email: String,
    val masterPasswordHash: String,
    val protectedKey: String,
    val publicKey: String,
    val encryptedPrivateKey: String,
    val kdfType: String,
    val kdfIterations: Int,
    val kdfMemory: Int? = null,
    val kdfParallelism: Int? = null,
    val recoveryKeyHash: String,
    val encryptedRecoveryKey: String,
    val deviceId: String? = null,
    val deviceType: String? = null,
    val deviceName: String? = null
)

@Serializable
data class RegisterResponse(
    val id: String,
    val email: String,
    val token: String,
    val refreshToken: String,
    val protectedKey: String
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RefreshResponse(
    val token: String,
    val refreshToken: String
)