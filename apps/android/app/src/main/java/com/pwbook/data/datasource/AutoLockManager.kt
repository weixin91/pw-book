package com.pwbook.data.datasource

import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.pwbook.domain.VaultSession
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AutoLockManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val vaultSession: VaultSession,
    private val securePrefs: SecurePrefs
) : DefaultLifecycleObserver {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var backgroundTime: Long = 0

    init {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        Timber.i("AutoLockManager initialized")
    }

    override fun onStop(owner: LifecycleOwner) {
        super.onStop(owner)
        backgroundTime = System.currentTimeMillis()
        Timber.d("App went to background at $backgroundTime")
    }

    override fun onStart(owner: LifecycleOwner) {
        super.onStart(owner)
        val timeoutMinutes = securePrefs.getInt(SecurePrefs.KEY_VAULT_TIMEOUT, 0)
        if (timeoutMinutes <= 0) {
            // 自动锁定已禁用
            vaultSession.recordActivity()
            return
        }

        if (backgroundTime > 0) {
            val elapsed = System.currentTimeMillis() - backgroundTime
            val timeoutMs = timeoutMinutes * 60_000L
            if (elapsed >= timeoutMs) {
                scope.launch {
                    vaultSession.lock()
                    Timber.i("Vault auto-locked after ${elapsed / 1000}s in background")
                }
            } else {
                vaultSession.recordActivity()
                Timber.d("App returned to foreground, ${(timeoutMs - elapsed) / 1000}s until auto-lock")
            }
        }
        backgroundTime = 0
    }

    fun destroy() {
        ProcessLifecycleOwner.get().lifecycle.removeObserver(this)
    }
}
