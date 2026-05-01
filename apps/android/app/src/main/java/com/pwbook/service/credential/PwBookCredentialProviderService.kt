package com.pwbook.service.credential

import android.credentials.ClearCredentialStateException
import android.credentials.CreateCredentialException
import android.credentials.GetCredentialException
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import android.service.credentials.BeginCreateCredentialRequest
import android.service.credentials.BeginCreateCredentialResponse
import android.service.credentials.BeginGetCredentialRequest
import android.service.credentials.BeginGetCredentialResponse
import android.service.credentials.ClearCredentialStateRequest
import android.service.credentials.CredentialProviderService
import dagger.hilt.android.AndroidEntryPoint
import timber.log.Timber
import javax.inject.Inject

@AndroidEntryPoint
class PwBookCredentialProviderService : CredentialProviderService() {

    @Inject
    lateinit var createHandler: PasskeyCreateHandler

    @Inject
    lateinit var getHandler: PasskeyGetHandler

    override fun onBeginCreateCredential(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
    ) {
        val caller = request.callingAppInfo?.packageName ?: "unknown"
        Timber.i("onBeginCreateCredential: caller=$caller")
        try {
            val response = createHandler.handleCreateCredential(request)
            callback.onResult(response)
        } catch (e: CreateCredentialException) {
            Timber.e(e, "Create credential failed")
            callback.onError(e)
        } catch (e: Exception) {
            Timber.e(e, "Unexpected error in create credential")
            callback.onError(CreateCredentialException(CreateCredentialException.TYPE_UNKNOWN))
        }
    }

    override fun onBeginGetCredential(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
    ) {
        val caller = request.callingAppInfo?.packageName ?: "unknown"
        Timber.i("onBeginGetCredential: caller=$caller")
        try {
            val response = getHandler.handleGetCredential(request)
            callback.onResult(response)
        } catch (e: GetCredentialException) {
            Timber.e(e, "Get credential failed")
            callback.onError(e)
        } catch (e: Exception) {
            Timber.e(e, "Unexpected error in get credential")
            callback.onError(GetCredentialException(GetCredentialException.TYPE_UNKNOWN))
        }
    }

    override fun onClearCredentialState(
        request: ClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void, ClearCredentialStateException>
    ) {
        Timber.i("onClearCredentialState")
        callback.onResult(null)
    }
}
