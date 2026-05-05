package com.pwbook.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.domain.VaultSession
import com.pwbook.ui.navigation.AppNavHost
import com.pwbook.ui.theme.PwBookTheme
import dagger.hilt.android.AndroidEntryPoint
import timber.log.Timber
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    @Inject
    lateinit var vaultSession: VaultSession

    @Inject
    lateinit var settingsRepository: SettingsRepository

    private val autofillState = mutableStateOf(AutofillState())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        parseAutofillIntent(intent)
        setContent {
            PwBookTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val state = autofillState.value
                    AppNavHost(
                        vaultSession = vaultSession,
                        autofillMode = state.mode,
                        autofillUri = state.uri,
                        autofillRequestId = state.requestId,
                        onCipherSelected = { cipherId ->
                            if (state.requestId != null) {
                                getSharedPreferences("pwbook_autofill", MODE_PRIVATE)
                                    .edit()
                                    .putString("autofill_result_${state.requestId}", cipherId)
                                    .apply()
                            }
                            setResult(RESULT_OK)
                            finish()
                        },
                        onCancel = {
                            finish()
                        }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        parseAutofillIntent(intent)
    }

    private fun parseAutofillIntent(intent: Intent) {
        // 桌面图标启动时强制忽略自动填充参数
        val isLauncherIntent = intent.action == Intent.ACTION_MAIN &&
            intent.categories?.contains(Intent.CATEGORY_LAUNCHER) == true
        autofillState.value = if (isLauncherIntent) {
            AutofillState()
        } else {
            AutofillState(
                mode = intent.getStringExtra("autofill_mode"),
                uri = intent.getStringExtra("autofill_uri"),
                requestId = intent.getStringExtra("autofill_request_id")
            )
        }
    }

    override fun onResume() {
        super.onResume()
        val timeoutMinutes = settingsRepository.getVaultTimeoutMinutes()
        if (vaultSession.checkAndLockIfTimeout(timeoutMinutes)) {
            Timber.d("MainActivity: vault auto-locked due to timeout")
        }
    }

    data class AutofillState(
        val mode: String? = null,
        val uri: String? = null,
        val requestId: String? = null
    )
}
