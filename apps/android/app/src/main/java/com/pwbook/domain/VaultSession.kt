package com.pwbook.domain

import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.local.entity.CipherEntity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VaultSession @Inject constructor(
    private val vaultEncryption: VaultEncryption,
    private val json: Json
) {
    private var userKey: ByteArray? = null
    private var lastActiveTime: Long = 0
    private var lastUserVerificationTime: Long = 0

    private val _isUnlocked = MutableStateFlow(false)
    val isUnlocked: StateFlow<Boolean> = _isUnlocked

    fun unlock(key: ByteArray) {
        userKey = key
        _isUnlocked.value = true
        lastActiveTime = System.currentTimeMillis()
        Timber.i("VaultSession unlocked")
    }

    fun lock() {
        userKey?.fill(0)
        userKey = null
        _isUnlocked.value = false
        lastActiveTime = 0
        Timber.i("VaultSession locked")
    }

    fun recordActivity() {
        lastActiveTime = System.currentTimeMillis()
    }

    fun checkAndLockIfTimeout(timeoutMinutes: Int): Boolean {
        if (userKey == null || timeoutMinutes <= 0) return false
        val elapsed = System.currentTimeMillis() - lastActiveTime
        val timeoutMs = timeoutMinutes * 60_000L
        return if (elapsed > timeoutMs) {
            lock()
            true
        } else {
            false
        }
    }

    fun getUserKey(): ByteArray? = userKey

    /**
     * 记录用户验证（生物识别或主密码）时间戳，用于短时免二次验证。
     */
    fun recordUserVerification() {
        lastUserVerificationTime = System.currentTimeMillis()
    }

    /**
     * 检查用户在指定时间阈值内是否已验证过。
     */
    fun isUserVerifiedRecently(thresholdMs: Long): Boolean {
        if (lastUserVerificationTime == 0L) return false
        return System.currentTimeMillis() - lastUserVerificationTime <= thresholdMs
    }

    fun decryptCipher(entity: CipherEntity): DecryptedCipher? {
        val key = userKey ?: return null
        // Edge extension 使用 userKey 的前 32 bytes 加密/解密 cipher data
        val cipherKey = key.copyOfRange(0, 32)
        return try {
            val decryptedJson = vaultEncryption.decryptString(entity.data, cipherKey)
            val cipherData = json.decodeFromString(CipherDataJson.serializer(), decryptedJson)
            DecryptedCipher(
                id = entity.id,
                type = entity.type,
                name = cipherData.name,
                notes = cipherData.notes,
                favorite = entity.favorite,
                username = cipherData.login?.username,
                password = cipherData.login?.password,
                uris = cipherData.login?.uris?.map { it.uri } ?: emptyList(),
                totp = cipherData.login?.totp,
                passkey = cipherData.passkey,
                modifiedAt = entity.modifiedAt
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to decrypt cipher ${entity.id}")
            null
        }
    }
}

@Serializable
data class CipherDataJson(
    val name: String = "",
    val notes: String? = null,
    val login: LoginDataJson? = null,
    val passkey: PasskeyDataJson? = null,
    val lastUsedAt: String? = null,
    val fields: List<CustomFieldJson> = emptyList()
)

@Serializable
data class LoginDataJson(
    val username: String? = null,
    val password: String? = null,
    val uris: List<LoginUriJson> = emptyList(),
    val totp: String? = null
)

@Serializable
data class PasskeyDataJson(
    val credentialId: String,
    val privateKey: String,
    val publicKey: String,
    val rpId: String,
    val rpName: String? = null,
    val userHandle: String,
    val userName: String? = null,
    val userDisplayName: String? = null,
    val counter: Int = 0,
    val createdAt: String = java.time.Instant.now().toString()
)

@Serializable
data class LoginUriJson(
    val uri: String,
    val match: Int? = null
)

@Serializable
data class CustomFieldJson(
    val name: String,
    val value: String,
    val type: Int
)

data class DecryptedCipher(
    val id: String,
    val type: Int,
    val name: String,
    val notes: String?,
    val favorite: Boolean,
    val username: String?,
    val password: String?,
    val uris: List<String>,
    val totp: String?,
    val passkey: PasskeyDataJson?,
    val modifiedAt: Long
)
