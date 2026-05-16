package com.pwbook.service.autofill

import android.content.Context
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.data.repository.DomainAssocRepository
import com.pwbook.data.repository.RejectedSiteRepository
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.domain.VaultSession
import com.pwbook.domain.index.CipherIndexStore
import com.pwbook.domain.matcher.UriMatcher
import com.pwbook.sync.PendingChangesQueue
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject

@AndroidEntryPoint
class PwBookAutofillService : AutofillService() {

    @Inject
    lateinit var cipherRepository: CipherRepository

    @Inject
    lateinit var domainAssocRepository: DomainAssocRepository

    @Inject
    lateinit var rejectedSiteRepository: RejectedSiteRepository

    @Inject
    lateinit var settingsRepository: SettingsRepository

    @Inject
    lateinit var vaultSession: VaultSession

    @Inject
    lateinit var vaultEncryption: VaultEncryption

    @Inject
    lateinit var pendingChangesQueue: PendingChangesQueue

    @Inject
    lateinit var securePrefs: SecurePrefs

    @Inject
    lateinit var json: Json

    @Inject
    lateinit var cipherIndexStore: CipherIndexStore

    @Inject
    lateinit var autofillFillResponseBuilder: AutofillFillResponseBuilder

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure
            ?: run {
                Timber.d("onFillRequest: no structure")
                callback.onSuccess(null)
                return
            }

        val parsed = StructureParser.parse(structure)
        Timber.d("onFillRequest: uri=${parsed.uriString}, packageName=${parsed.packageName}, webDomain=${parsed.webDomain}")
        Timber.d("onFillRequest: usernameId=${parsed.usernameId}, passwordId=${parsed.passwordId}")
        Timber.d("onFillRequest: fields=${parsed.allFields.map { "hints=${it.autofillHints}, type=${it.inputType}, html=${it.htmlInfo}" }}")

        if (parsed.usernameId == null && parsed.passwordId == null) {
            Timber.d("onFillRequest: no username/password fields found")
            callback.onSuccess(null)
            return
        }

        // 检查是否超时
        val timeoutMinutes = settingsRepository.getVaultTimeoutMinutes()
        if (vaultSession.checkAndLockIfTimeout(timeoutMinutes)) {
            Timber.d("onFillRequest: vault auto-locked due to timeout")
            val response = buildUnlockResponse(parsed)
            callback.onSuccess(response)
            return
        }

        // 检查是否已解锁
        val isUnlocked = vaultSession.getUserKey() != null
        Timber.d("onFillRequest: isUnlocked=$isUnlocked")

        if (!isUnlocked) {
            Timber.d("onFillRequest: vault not unlocked, showing unlock prompt")
            val response = buildUnlockResponse(parsed)
            callback.onSuccess(response)
            return
        }

        var response: FillResponse? = null
        runBlocking {
            response = autofillFillResponseBuilder.build(this@PwBookAutofillService, parsed)
        }
        vaultSession.recordActivity()
        callback.onSuccess(response)
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure
            ?: run {
                callback.onSuccess()
                return
            }

        val saveData = StructureParser.extractSaveData(structure, request.clientState?.keySet()?.associateWith {
            request.clientState?.getString(it) ?: ""
        })
            ?: run {
                callback.onSuccess()
                return
            }

        if (saveData.username.isNullOrBlank() && saveData.password.isNullOrBlank()) {
            callback.onSuccess()
            return
        }

        val baseDomain = saveData.webDomain?.let { UriMatcher.getBaseDomain(it) }
            ?: saveData.packageName

        scope.launch {
            try {
                val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: ""
                if (!rejectedSiteRepository.isRejected(userId, baseDomain)) {
                    val handler = SaveRequestHandler(
                        cipherRepository = cipherRepository,
                        domainAssocRepository = domainAssocRepository,
                        vaultSession = vaultSession,
                        vaultEncryption = vaultEncryption,
                        pendingChangesQueue = pendingChangesQueue,
                        securePrefs = securePrefs,
                        json = json,
                        cipherIndexStore = cipherIndexStore
                    )
                    handler.handle(saveData)
                } else {
                    Timber.i("onSaveRequest: domain $baseDomain rejected")
                }
                callback.onSuccess()
            } catch (e: Exception) {
                Timber.e(e, "onSaveRequest failed")
                callback.onFailure(e.message ?: "Save failed")
            }
        }
    }

    private fun buildUnlockResponse(parsed: ParsedStructure): FillResponse? {
        if (parsed.usernameId == null && parsed.passwordId == null) return null

        val intent = android.content.Intent(this, AutofillUnlockActivity::class.java)

        val pendingIntent = android.app.PendingIntent.getActivity(
            this,
            System.currentTimeMillis().toInt(),
            intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE
        )

        val remoteViews = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, "解锁 Password Book")
        }

        val datasetBuilder = Dataset.Builder(remoteViews)
            .setAuthentication(pendingIntent.intentSender)

        // 必须至少设置一个 field,否则 build() 会抛 IllegalStateException
        parsed.usernameId?.let { id ->
            datasetBuilder.setValue(id, AutofillValue.forText(""))
        }
        parsed.passwordId?.let { id ->
            datasetBuilder.setValue(id, AutofillValue.forText(""))
        }

        return FillResponse.Builder()
            .addDataset(datasetBuilder.build())
            .build()
    }
}
