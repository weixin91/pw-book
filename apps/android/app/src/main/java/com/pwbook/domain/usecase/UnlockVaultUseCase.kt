package com.pwbook.domain.usecase

import com.pwbook.crypto.KeyDerivation
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.SettingsRepository
import javax.inject.Inject

class UnlockVaultUseCase @Inject constructor(
    private val keyDerivation: KeyDerivation,
    private val vaultEncryption: VaultEncryption,
    private val settingsRepository: SettingsRepository
) {
    suspend fun unlock(password: String): Result<ByteArray> {
        return runCatching {
            val email = settingsRepository.getAccessToken()
                ?: throw IllegalStateException("未登录")
            val kdfType = settingsRepository.getString(SecurePrefs.KEY_KDF_TYPE)
                ?: throw IllegalStateException("KDF 配置丢失")
            val iterations = settingsRepository.getString(SecurePrefs.KEY_KDF_ITERATIONS)?.toInt()
                ?: throw IllegalStateException("KDF 迭代次数丢失")
            val memory = settingsRepository.getString(SecurePrefs.KEY_KDF_MEMORY)?.toInt()
            val parallelism = settingsRepository.getString(SecurePrefs.KEY_KDF_PARALLELISM)?.toInt()

            val masterKey = keyDerivation.deriveMasterKey(
                password = password,
                email = email,
                kdfType = com.pwbook.crypto.KdfType.valueOf(kdfType),
                iterations = iterations,
                memoryKb = memory,
                parallelism = parallelism
            )

            val (encKey, _) = keyDerivation.stretchMasterKey(masterKey)
            val protectedKey = settingsRepository.getString(SecurePrefs.KEY_PROTECTED_KEY)
                ?: throw IllegalStateException("Protected key 丢失")

            val userKey = vaultEncryption.decryptString(protectedKey, encKey).toByteArray(Charsets.UTF_8)
            Result.success(userKey)
        }.getOrElse { Result.failure(it) } as Result<ByteArray>
    }
}
