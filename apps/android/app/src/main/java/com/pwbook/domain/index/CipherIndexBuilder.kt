package com.pwbook.domain.index

import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.local.entity.CipherIndexEntity
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.DecryptedCipher
import com.pwbook.domain.VaultSession
import com.pwbook.domain.matcher.UriMatcher
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject

class CipherIndexBuilder @Inject constructor(
    private val json: Json
) {

    /**
     * 从加密凭据构建索引条目。解密失败或解析失败时返回 null，不抛异常。
     */
    suspend fun build(
        entity: CipherEntity,
        decryptFn: suspend (encryptedData: String) -> String?
    ): CipherIndexEntity? {
        val decryptedJson = try {
            decryptFn(entity.data)
        } catch (e: Exception) {
            Timber.e(e, "CipherIndexBuilder: decrypt failed for ${entity.id}")
            return null
        } ?: return null

        return try {
            val cipherData = json.decodeFromString(CipherDataJson.serializer(), decryptedJson)
            buildFromData(entity, cipherData)
        } catch (e: Exception) {
            Timber.e(e, "CipherIndexBuilder: parse failed for ${entity.id}")
            null
        }
    }

    /**
     * 通过 VaultSession 直接解密并构建索引条目。vault 锁定时返回 null。
     */
    fun buildFromEntity(entity: CipherEntity, vaultSession: VaultSession): CipherIndexEntity? {
        val decrypted = vaultSession.decryptCipher(entity) ?: return null
        return buildFromDecrypted(entity, decrypted)
    }

    private fun buildFromData(
        entity: CipherEntity,
        cipherData: CipherDataJson
    ): CipherIndexEntity {
        val domains = cipherData.login?.uris
            ?.mapNotNull { uriObj ->
                uriObj.uri.let { uri ->
                    val parsed = UriMatcher.parseUri(uri)
                    parsed.baseDomain
                }
            }
            ?.distinct()
            ?: emptyList()

        val rpIds = cipherData.passkey?.rpId?.lowercase()?.let { listOf(it) } ?: emptyList()

        return CipherIndexEntity(
            cipherId = entity.id,
            userId = entity.userId,
            domainsJson = json.encodeToString(domains),
            rpIdsJson = json.encodeToString(rpIds),
            hasLogin = cipherData.login != null,
            hasPasskey = cipherData.passkey != null
        )
    }

    private fun buildFromDecrypted(
        entity: CipherEntity,
        decrypted: DecryptedCipher
    ): CipherIndexEntity {
        val domains = decrypted.uris
            .mapNotNull { uri -> UriMatcher.parseUri(uri).baseDomain }
            .distinct()

        val rpIds = decrypted.passkey?.rpId?.lowercase()?.let { listOf(it) } ?: emptyList()

        return CipherIndexEntity(
            cipherId = entity.id,
            userId = entity.userId,
            domainsJson = json.encodeToString(domains),
            rpIdsJson = json.encodeToString(rpIds),
            hasLogin = decrypted.username != null || decrypted.password != null || decrypted.uris.isNotEmpty(),
            hasPasskey = decrypted.passkey != null
        )
    }
}
