package com.pwbook.service.autofill

import android.content.Context
import android.service.autofill.FillResponse
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.data.repository.DomainAssocRepository
import com.pwbook.domain.VaultSession
import com.pwbook.domain.index.CipherIndexStore
import com.pwbook.domain.index.DomainAssocLite
import com.pwbook.domain.matcher.UriMatcher
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 基于已解锁的 VaultSession,根据 ParsedStructure 计算候选凭据并构造 FillResponse。
 *
 * 由 PwBookAutofillService(已解锁路径)与 AutofillUnlockActivity(解锁完成后)共用,
 * 保证两侧候选列表逻辑一致。调用前必须确认 vaultSession 已解锁,否则返回 null。
 */
@Singleton
class AutofillFillResponseBuilder @Inject constructor(
    private val securePrefs: SecurePrefs,
    private val cipherRepository: CipherRepository,
    private val domainAssocRepository: DomainAssocRepository,
    private val cipherIndexStore: CipherIndexStore,
    private val vaultSession: VaultSession,
    private val json: Json
) {

    suspend fun build(context: Context, parsed: ParsedStructure): FillResponse? {
        if (vaultSession.getUserKey() == null) {
            Timber.d("AutofillFillResponseBuilder: vault locked, skip")
            return null
        }
        return try {
            val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: return null

            val rulesRaw = domainAssocRepository.getRules(userId)
            val rulesLite = rulesRaw.map { entity ->
                DomainAssocLite(
                    domains = json.decodeFromString(entity.domains),
                    packageNames = json.decodeFromString(entity.packageNames)
                )
            }

            val candidateIds = try {
                cipherIndexStore.filterByDomain(
                    userId,
                    UriMatcher.parseUri(parsed.uriString),
                    rulesLite
                )
            } catch (e: Exception) {
                Timber.e(e, "filterByDomain failed, falling back to full decrypt")
                emptyList()
            }

            val ciphersToCheck = if (candidateIds.isNotEmpty()) {
                candidateIds.mapNotNull { cipherRepository.getCipher(it) }
            } else {
                cipherRepository.getCiphers(userId)
            }

            val decrypted = ciphersToCheck
                .mapNotNull { vaultSession.decryptCipher(it) }
                .filter { cipher ->
                    cipher.uris.any { uri ->
                        UriMatcher.isMatch(parsed.uriString, uri, rulesRaw)
                    }
                }
                .sortedByDescending { it.modifiedAt }

            Timber.d("AutofillFillResponseBuilder: matched ${decrypted.size} ciphers")

            FillResponseBuilder.build(
                context = context,
                parsed = parsed,
                ciphers = decrypted.take(5)
            )
        } catch (e: Exception) {
            Timber.e(e, "AutofillFillResponseBuilder.build failed")
            null
        }
    }
}
