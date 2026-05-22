package com.pwbook.service.credential

import android.app.PendingIntent
import android.content.Intent
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CredentialEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.PublicKeyCredentialEntry
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.data.repository.DomainAssocRepository
import com.pwbook.domain.VaultSession
import com.pwbook.domain.index.CipherIndexStore
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Credential Provider Service，为系统提供 Passkey 创建和认证能力。
 */
@AndroidEntryPoint
class PwBookCredentialProviderService : CredentialProviderService() {

    companion object {
        private const val PACKAGE_NAME = "com.pwbook"
        private const val EXTRA_CREATE_REQUEST_JSON = "create_request_json"
        private const val EXTRA_CALLING_PACKAGE = "calling_package"
        private const val EXTRA_CREDENTIAL_ID = "credential_id"
        private const val EXTRA_CIPHER_ID = "cipher_id"
    }

    @Inject lateinit var cipherRepository: CipherRepository
    @Inject lateinit var domainAssocRepository: DomainAssocRepository
    @Inject lateinit var vaultSession: VaultSession
    @Inject lateinit var cipherIndexStore: CipherIndexStore
    @Inject lateinit var securePrefs: SecurePrefs

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
    ) {
        Timber.d("onBeginCreateCredentialRequest type=${request::class.java.simpleName}")
        val response = when (request) {
            is BeginCreatePublicKeyCredentialRequest -> handleCreatePasskeyQuery(request)
            else -> {
                Timber.w("Unknown create request type: ${request::class.java.simpleName}")
                BeginCreateCredentialResponse(emptyList())
            }
        }
        Timber.d("CreateCredentialResponse entries=${response.createEntries.size}")
        callback.onResult(response)
    }

    private fun handleCreatePasskeyQuery(
        request: BeginCreatePublicKeyCredentialRequest
    ): BeginCreateCredentialResponse {
        Timber.d("handleCreatePasskeyQuery requestJson=${request.requestJson}")

        val intent = Intent(
            applicationContext,
            PasskeyCreateActivity::class.java
        ).apply {
            putExtra(EXTRA_CREATE_REQUEST_JSON, request.requestJson)
            val callingPackage = request.callingAppInfo?.packageName.orEmpty()
            putExtra(EXTRA_CALLING_PACKAGE, callingPackage)
        }

        val pendingIntent = PendingIntent.getActivity(
            applicationContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        Timber.d("handleCreatePasskeyQuery pendingIntent created")

        val accountName = getString(com.pwbook.R.string.app_name)
        Timber.d("handleCreatePasskeyQuery accountName=$accountName")

        val createEntry = androidx.credentials.provider.CreateEntry.Builder(
            accountName,
            pendingIntent
        ).build()
        Timber.d("handleCreatePasskeyQuery CreateEntry built")

        return BeginCreateCredentialResponse(listOf(createEntry))
    }

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
    ) {
        Timber.d("onBeginGetCredentialRequest caller=${request.callingAppInfo?.packageName} options=${request.beginGetCredentialOptions.size}")

        if (!vaultSession.isUnlocked.value) {
            // 未解锁时返回代理 entry，让用户进入 PasskeyGetActivity 完成解锁和认证
            val entries = mutableListOf<CredentialEntry>()
            for (option in request.beginGetCredentialOptions) {
                when (option) {
                    is BeginGetPublicKeyCredentialOption -> {
                        val intent = Intent(applicationContext, PasskeyGetActivity::class.java)
                        val pendingIntent = PendingIntent.getActivity(
                            applicationContext,
                            option.requestJson.hashCode(),
                            intent,
                            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                        )
                        val entry = PublicKeyCredentialEntry(
                            applicationContext,
                            "解锁 Password Book",
                            pendingIntent,
                            option,
                            null
                        )
                        entries.add(entry)
                    }
                    else -> { /* 忽略其他类型 */ }
                }
            }
            Timber.d("Returning ${entries.size} proxy entries (vault locked)")
            callback.onResult(BeginGetCredentialResponse(entries))
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            val response = processGetCredentialRequest(request)
            callback.onResult(response)
        }
    }

    private suspend fun processGetCredentialRequest(
        request: BeginGetCredentialRequest
    ): BeginGetCredentialResponse {
        val callingPackage = request.callingAppInfo?.packageName.orEmpty()
        Timber.d("processGetCredentialRequest caller=$callingPackage options=${request.beginGetCredentialOptions.size}")
        val credentialEntries = mutableListOf<CredentialEntry>()

        for (option in request.beginGetCredentialOptions) {
            when (option) {
                is BeginGetPasswordOption -> {
                    // 当前版本暂不通过 Credential Provider 返回密码凭据
                    // 仅处理 Passkey 请求
                }
                is BeginGetPublicKeyCredentialOption -> {
                    credentialEntries.addAll(
                        populatePasskeyEntries(callingPackage, option)
                    )
                }
            }
        }

        Timber.d("processGetCredentialRequest returning ${credentialEntries.size} entries")
        return BeginGetCredentialResponse(credentialEntries)
    }

    private suspend fun populatePasskeyEntries(
        callingPackage: String,
        option: BeginGetPublicKeyCredentialOption
    ): List<CredentialEntry> {
        val requestJsonStr = option.requestJson
        val rpId = try {
            val json = org.json.JSONObject(requestJsonStr)
            json.optString("rpId", "")
        } catch (e: Exception) {
            Timber.w(e, "Failed to parse requestJson")
            return emptyList()
        }

        val allowCredentials = try {
            val json = org.json.JSONObject(requestJsonStr)
            json.optJSONArray("allowCredentials")
        } catch (e: Exception) {
            null
        }

        val userId = getUserId()
        if (userId.isEmpty()) {
            Timber.w("User not logged in")
            return emptyList()
        }

        val domainRules = try {
            domainAssocRepository.getRules(userId)
        } catch (e: Exception) {
            emptyList()
        }

        // 通过索引预筛选 Passkey 候选凭据
        val candidateIds = try {
            cipherIndexStore.filterByRpId(userId, rpId)
        } catch (e: Exception) {
            Timber.e(e, "filterByRpId failed, falling back to full decrypt")
            emptyList()
        }
        Timber.d("populatePasskeyEntries index returned ${candidateIds.size} candidates for rpId=$rpId")

        val ciphersToCheck = if (candidateIds.isNotEmpty()) {
            candidateIds.mapNotNull { cipherRepository.getCipher(it) }
        } else {
            cipherRepository.getAllLoginCiphers(userId).also {
                Timber.d("populatePasskeyEntries falling back to ${it.size} login ciphers")
            }
        }

        val entries = mutableListOf<CredentialEntry>()

        for (cipher in ciphersToCheck) {
            val decrypted = vaultSession.decryptCipher(cipher) ?: continue
            val passkey = decrypted.passkey ?: continue
            Timber.d("populatePasskeyEntries checking credentialId=${passkey.credentialId} rpId=${passkey.rpId}")

            // rpId 匹配（二次校验）
            if (!PasskeyMatcher.isRpIdMatch(
                    passkeyRpId = passkey.rpId,
                    requestedRpId = rpId,
                    callingPackage = callingPackage,
                    domainRules = domainRules
                )
            ) {
                Timber.d("populatePasskeyEntries rpId mismatch, skip credentialId=${passkey.credentialId}")
                continue
            }

            // allowCredentials 过滤
            if (!PasskeyMatcher.isCredentialAllowed(
                    credentialId = passkey.credentialId,
                    allowCredentials = allowCredentials
                )
            ) {
                Timber.d("populatePasskeyEntries credential not allowed, skip credentialId=${passkey.credentialId}")
                continue
            }

            val intent = Intent(
                applicationContext,
                PasskeyGetActivity::class.java
            ).apply {
                putExtra(EXTRA_CREDENTIAL_ID, passkey.credentialId)
                putExtra(EXTRA_CIPHER_ID, cipher.id)
            }

            val pendingIntent = PendingIntent.getActivity(
                applicationContext,
                passkey.credentialId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )

            val entry = PublicKeyCredentialEntry(
                applicationContext,
                decrypted.name,
                pendingIntent,
                option,
                passkey.userName ?: decrypted.username ?: passkey.rpId
            )

            entries.add(entry)
            Timber.d("populatePasskeyEntries added entry for credentialId=${passkey.credentialId}")
        }

        Timber.d("populatePasskeyEntries returning ${entries.size} entries")
        return entries
    }

    override fun onClearCredentialStateRequest(
        request: androidx.credentials.provider.ProviderClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void?, ClearCredentialException>
    ) {
        callback.onResult(null)
    }

    private fun getUserId(): String {
        return securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""
    }
}
