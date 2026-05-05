package com.pwbook.domain.usecase

import com.pwbook.crypto.KeyDerivation
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.VaultSession
import com.pwbook.domain.index.CipherIndexStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject

class UnlockVaultUseCase @Inject constructor(
    private val keyDerivation: KeyDerivation,
    private val vaultEncryption: VaultEncryption,
    private val securePrefs: SecurePrefs,
    private val vaultSession: VaultSession,
    private val cipherRepository: CipherRepository,
    private val cipherIndexStore: CipherIndexStore
) {
    suspend fun unlock(password: String): Result<ByteArray> {
        Timber.d("=== UNLOCK DEBUG ===")
        return runCatching {
            // 从 SecurePrefs 读取登录数据（不是 Room 数据库）
            val email = securePrefs.getString(SecurePrefs.KEY_EMAIL)
            Timber.d("email from SecurePrefs: $email")
            if (email == null) {
                throw IllegalStateException("未登录：KEY_EMAIL 不存在")
            }

            val kdfType = securePrefs.getString(SecurePrefs.KEY_KDF_TYPE)
            Timber.d("kdfType from SecurePrefs: $kdfType")
            if (kdfType == null) {
                throw IllegalStateException("KDF 配置丢失：KEY_KDF_TYPE 不存在")
            }

            val iterationsStr = securePrefs.getString(SecurePrefs.KEY_KDF_ITERATIONS)
            Timber.d("iterations from SecurePrefs: $iterationsStr")
            val iterations = iterationsStr?.toInt()
                ?: throw IllegalStateException("KDF 迭代次数丢失：KEY_KDF_ITERATIONS 不存在或无效")

            val memory = securePrefs.getString(SecurePrefs.KEY_KDF_MEMORY)?.toInt()
            val parallelism = securePrefs.getString(SecurePrefs.KEY_KDF_PARALLELISM)?.toInt()
            Timber.d("memory: $memory, parallelism: $parallelism")

            // KDF 计算是 CPU 密集型操作，切换到 Default 调度器避免阻塞主线程
            val masterKey = withContext(Dispatchers.Default) {
                keyDerivation.deriveMasterKey(
                    password = password,
                    email = email,
                    kdfType = com.pwbook.crypto.KdfType.valueOf(kdfType),
                    iterations = iterations,
                    memoryKb = memory,
                    parallelism = parallelism
                )
            }
            Timber.d("masterKey derived, length: ${masterKey.size}, hex: ${masterKey.joinToString("") { "%02x".format(it) }}")

            val (encKey, macKey) = withContext(Dispatchers.Default) {
                keyDerivation.stretchMasterKey(masterKey)
            }
            Timber.d("encKey derived, length: ${encKey.size}, hex: ${encKey.joinToString("") { "%02x".format(it) }}")
            Timber.d("macKey derived, length: ${macKey.size}, hex: ${macKey.joinToString("") { "%02x".format(it) }}")

            val protectedKey = securePrefs.getString(SecurePrefs.KEY_PROTECTED_KEY)
            Timber.d("protectedKey from SecurePrefs: $protectedKey")
            if (protectedKey == null) {
                throw IllegalStateException("Protected key 丢失：KEY_PROTECTED_KEY 不存在")
            }

            // protectedKey 是 Base64(iv + ciphertext)，需要先解码
            val protectedKeyBytes = android.util.Base64.decode(protectedKey, android.util.Base64.NO_WRAP)
            Timber.d("protectedKey decoded length: ${protectedKeyBytes.size} bytes")

            // 解密得到 userKey（应该是 64 bytes）
            val decryptedUserKey = vaultEncryption.decryptBytes(protectedKeyBytes, encKey)
            Timber.d("userKey decrypted, length: ${decryptedUserKey.size} bytes, hex: ${decryptedUserKey.joinToString("") { "%02x".format(it) }}")

            if (decryptedUserKey.size != 64) {
                Timber.e("Unexpected userKey size: ${decryptedUserKey.size}, expected 64")
            }

            vaultSession.unlock(decryptedUserKey)

            // 索引一致性检查和 pending rebuild 处理
            val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID)
            if (userId != null) {
                runCatching {
                    checkAndRepairIndex(userId)
                }.onFailure {
                    Timber.e(it, "Index check/repair failed after unlock")
                }
            }

            Timber.d("unlock success")
            decryptedUserKey
        }.onFailure { e ->
            Timber.e(e, "Unlock failed")
        }
    }

    private suspend fun checkAndRepairIndex(userId: String) {
        val loginCiphers = cipherRepository.getAllLoginCiphers(userId)
        val localIds = loginCiphers.map { it.id }.toSet()
        val missing = cipherIndexStore.checkConsistency(userId, localIds)
        if (missing != null && missing.isNotEmpty()) {
            val decryptFn = buildDecryptFn()
            missing.forEach { id ->
                val entity = cipherRepository.getCipher(id) ?: return@forEach
                cipherIndexStore.rebuildOne(id, userId, entity.data, decryptFn)
            }
        }

        val getCipherFn: suspend (String) -> CipherEntity? = { id -> cipherRepository.getCipher(id) }
        cipherIndexStore.processPendingRebuild(userId, buildDecryptFn(), getCipherFn)
    }

    private fun buildDecryptFn(): suspend (String) -> String? {
        val userKey = vaultSession.getUserKey() ?: return { null }
        val cipherKey = userKey.copyOfRange(0, 32)
        return { data ->
            try {
                vaultEncryption.decryptString(data, cipherKey)
            } catch (_: Exception) {
                null
            }
        }
    }
}
