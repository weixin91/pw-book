package com.pwbook.service.credential

import android.content.Context
import android.content.Intent
import android.service.credentials.BeginGetCredentialRequest
import android.service.credentials.BeginGetCredentialResponse
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.DecryptedCipher
import com.pwbook.domain.VaultSession
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject

class PasskeyGetHandler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val securePrefs: SecurePrefs,
    private val json: Json
) {

    fun handleGetCredential(
        request: BeginGetCredentialRequest
    ): BeginGetCredentialResponse {
        val callingPackage = request.callingAppInfo?.packageName ?: ""
        val origin = request.callingAppInfo?.origin ?: callingPackage

        Timber.i("handleGetCredential: caller=$callingPackage, origin=$origin")

        // 查询匹配的 Passkey 凭据
        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID)
        if (userId == null || !vaultSession.isUnlocked.value) {
            return BeginGetCredentialResponse()
        }

        val matchingCiphers = runBlocking { getMatchingPasskeys(origin, userId) }

        if (matchingCiphers.isEmpty()) {
            return BeginGetCredentialResponse()
        }

        return try {
            val credentialEntryClass = Class.forName("android.service.credentials.CredentialEntry")
            val responseClass = Class.forName("android.service.credentials.BeginGetCredentialResponse")
            val response = responseClass.getDeclaredConstructor().newInstance()

            // 单匹配直接自动选用，多匹配则弹窗让用户选择
            if (matchingCiphers.size == 1) {
                val cipher = matchingCiphers.first()
                val intent = Intent(context, PasskeyGetActivity::class.java).apply {
                    putExtra("cipher_id", cipher.id)
                    putExtra("rp_id", origin)
                    putExtra("auto_select", true)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val pendingIntent = android.app.PendingIntent.getActivity(
                    context,
                    cipher.id.hashCode(),
                    intent,
                    android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
                )
                val entry = credentialEntryClass.getConstructor(String::class.java, android.app.PendingIntent::class.java)
                    .newInstance(cipher.name, pendingIntent)
                val addMethod = responseClass.getMethod("addCredentialEntry", credentialEntryClass)
                addMethod.invoke(response, entry)
            } else {
                val intent = Intent(context, PasskeyGetActivity::class.java).apply {
                    putExtra("rp_id", origin)
                    putExtra("cipher_ids", matchingCiphers.map { it.id }.toTypedArray())
                    putExtra("auto_select", false)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val pendingIntent = android.app.PendingIntent.getActivity(
                    context,
                    origin.hashCode(),
                    intent,
                    android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
                )
                val entry = credentialEntryClass.getConstructor(String::class.java, android.app.PendingIntent::class.java)
                    .newInstance(origin, pendingIntent)
                val addMethod = responseClass.getMethod("addCredentialEntry", credentialEntryClass)
                addMethod.invoke(response, entry)
            }

            @Suppress("UNCHECKED_CAST")
            response as BeginGetCredentialResponse
        } catch (e: Exception) {
            Timber.e(e, "Failed to construct BeginGetCredentialResponse, returning empty response")
            BeginGetCredentialResponse()
        }
    }

    private suspend fun getMatchingPasskeys(origin: String, userId: String): List<DecryptedCipher> {
        return try {
            val allCiphers = cipherRepository.getCiphers(userId)
            allCiphers.mapNotNull { entity ->
                vaultSession.decryptCipher(entity)
            }.filter { cipher ->
                cipher.passkey != null && (cipher.passkey.rpId == origin ||
                    cipher.uris.any { uri -> uri.contains(origin) || origin.contains(uri) })
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to get matching passkeys")
            emptyList()
        }
    }
}
