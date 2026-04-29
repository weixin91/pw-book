package com.pwbook.data.repository

import com.pwbook.data.local.dao.SettingDao
import com.pwbook.data.local.entity.SettingEntity
import com.pwbook.data.datasource.SecurePrefs
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository @Inject constructor(
    private val settingDao: SettingDao,
    private val securePrefs: SecurePrefs
) {
    suspend fun getString(key: String): String? = settingDao.get(key)?.value

    fun observeString(key: String): Flow<String?> = settingDao.observe(key).map { it?.value }

    suspend fun setString(key: String, value: String) = settingDao.set(SettingEntity(key, value))

    suspend fun remove(key: String) = settingDao.delete(key)

    // Secure prefs helpers
    fun getAccessToken(): String? = securePrefs.getString(SecurePrefs.KEY_ACCESS_TOKEN)
    fun setAccessToken(token: String?) = securePrefs.putString(SecurePrefs.KEY_ACCESS_TOKEN, token)

    fun getUserId(): String? = securePrefs.getString(SecurePrefs.KEY_USER_ID)
    fun setUserId(id: String?) = securePrefs.putString(SecurePrefs.KEY_USER_ID, id)

    fun isBiometricEnabled(): Boolean = securePrefs.getBoolean(SecurePrefs.KEY_BIOMETRIC_UNLOCK_ENABLED)
    fun setBiometricEnabled(enabled: Boolean) = securePrefs.putBoolean(SecurePrefs.KEY_BIOMETRIC_UNLOCK_ENABLED, enabled)

    fun getVaultTimeoutMinutes(): Int = securePrefs.getLong(SecurePrefs.KEY_VAULT_TIMEOUT, 15).toInt()
    fun setVaultTimeoutMinutes(minutes: Int) = securePrefs.putLong(SecurePrefs.KEY_VAULT_TIMEOUT, minutes.toLong())

    fun clearAll() {
        securePrefs.clear()
    }
}
