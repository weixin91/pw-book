package com.pwbook.service.credential

import android.os.CancellationSignal
import android.service.credentials.BeginCreateCredentialRequest
import android.service.credentials.BeginCreateCredentialResponse
import android.service.credentials.BeginGetCredentialRequest
import android.service.credentials.BeginGetCredentialResponse
import android.service.credentials.CredentialProviderService
import android.service.credentials.CreateCredentialRequest
import android.service.credentials.GetCredentialRequest

class PwBookCredentialProviderService : CredentialProviderService() {

    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal
    ): BeginCreateCredentialResponse {
        // Phase 3 实现
        return BeginCreateCredentialResponse.Builder().build()
    }

    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal
    ): BeginGetCredentialResponse {
        // Phase 3 实现
        return BeginGetCredentialResponse.Builder().build()
    }
}
