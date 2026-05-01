package com.pwbook.data.datasource

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SecurePrefs @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private val prefs: SharedPreferences by lazy {
        EncryptedSharedPreferences.create(
            context,
            "pwbook_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun putString(key: String, value: String?) {
        prefs.edit().putString(key, value).apply()
    }

    fun getString(key: String, default: String? = null): String? =
        prefs.getString(key, default)

    fun putBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).apply()
    }

    fun getBoolean(key: String, default: Boolean = false): Boolean =
        prefs.getBoolean(key, default)

    fun putLong(key: String, value: Long) {
        prefs.edit().putLong(key, value).apply()
    }

    fun getLong(key: String, default: Long = 0L): Long =
        prefs.getLong(key, default)

    fun putInt(key: String, value: Int) {
        prefs.edit().putInt(key, value).apply()
    }

    fun getInt(key: String, default: Int = 0): Int =
        prefs.getInt(key, default)

    fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        const val KEY_SERVER_URL = "server_url"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_USER_ID = "user_id"
        const val KEY_EMAIL = "email"
        const val KEY_KDF_TYPE = "kdf_type"
        const val KEY_KDF_ITERATIONS = "kdf_iterations"
        const val KEY_KDF_MEMORY = "kdf_memory"
        const val KEY_KDF_PARALLELISM = "kdf_parallelism"
        const val KEY_PROTECTED_KEY = "protected_key"
        const val KEY_PUBLIC_KEY = "public_key"
        const val KEY_PRIVATE_KEY = "private_key"
        const val KEY_SECURITY_STAMP = "security_stamp"
        const val KEY_BIOMETRIC_UNLOCK_ENABLED = "biometric_unlock_enabled"
        const val KEY_BIOMETRIC_IV = "biometric_iv"
        const val KEY_BIOMETRIC_ENCRYPTED_KEY = "biometric_encrypted_key"
        const val KEY_VAULT_TIMEOUT = "vault_timeout"
        const val KEY_LAST_SYNC = "last_sync"
    }
}
