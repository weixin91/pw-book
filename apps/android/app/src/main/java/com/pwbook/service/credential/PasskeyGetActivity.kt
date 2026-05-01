package com.pwbook.service.credential

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.DecryptedCipher
import com.pwbook.domain.VaultSession
import com.pwbook.ui.theme.PwBookTheme
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import javax.inject.Inject

@AndroidEntryPoint
class PasskeyGetActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val cipherId = intent.getStringExtra("cipher_id")
        val rpId = intent.getStringExtra("rp_id") ?: ""
        val autoSelect = intent.getBooleanExtra("auto_select", false)
        val cipherIds = intent.getStringArrayExtra("cipher_ids")

        setContent {
            PwBookTheme {
                PasskeyGetContent(
                    rpId = rpId,
                    cipherId = cipherId,
                    cipherIds = cipherIds?.toList(),
                    autoSelect = autoSelect,
                    onFinish = { success, resultData ->
                        if (success && resultData != null) {
                            val intent = Intent().apply {
                                putExtra("credential_data", resultData)
                            }
                            setResult(Activity.RESULT_OK, intent)
                        } else {
                            setResult(Activity.RESULT_CANCELED)
                        }
                        finish()
                    }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PasskeyGetContent(
    rpId: String,
    cipherId: String?,
    cipherIds: List<String>?,
    autoSelect: Boolean,
    onFinish: (Boolean, String?) -> Unit,
    viewModel: PasskeyGetViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState(PasskeyGetViewModel.PasskeyGetUiState())
    val scope = rememberCoroutineScope()

    LaunchedEffect(cipherId, cipherIds) {
        if (cipherId != null) {
            viewModel.loadCipher(cipherId)
        } else if (cipherIds != null) {
            viewModel.loadCiphers(cipherIds)
        }
    }

    // 单匹配自动选择
    LaunchedEffect(autoSelect, uiState.selectedCipher) {
        if (autoSelect && uiState.selectedCipher != null) {
            scope.launch {
                val result = viewModel.authenticateAndSign(rpId)
                onFinish(result != null, result)
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("选择通行密钥") }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            Text(
                text = "网站/应用: $rpId",
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(16.dp))

            if (uiState.ciphers.size == 1 && autoSelect) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text("正在验证身份...")
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    items(uiState.ciphers, key = { it.id }) { cipher ->
                        PasskeySelectionCard(
                            cipher = cipher,
                            onSelect = {
                                scope.launch {
                                    viewModel.selectCipher(cipher.id)
                                    val result = viewModel.authenticateAndSign(rpId)
                                    onFinish(result != null, result)
                                }
                            }
                        )
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedButton(
                    onClick = { onFinish(false, null) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("取消")
                }
            }
        }
    }
}

@Composable
private fun PasskeySelectionCard(
    cipher: DecryptedCipher,
    onSelect: () -> Unit
) {
    Card(
        onClick = onSelect,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = cipher.name,
                style = MaterialTheme.typography.titleMedium
            )
            if (cipher.username != null) {
                Text(
                    text = cipher.username,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (cipher.passkey?.rpName != null) {
                Text(
                    text = "RP: ${cipher.passkey.rpName}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

@HiltViewModel
class PasskeyGetViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val securePrefs: SecurePrefs,
    private val vaultEncryption: com.pwbook.crypto.VaultEncryption
) : ViewModel() {

    private val _uiState = MutableStateFlow(PasskeyGetUiState())
    val uiState: StateFlow<PasskeyGetUiState> = _uiState

    fun loadCipher(cipherId: String) {
        viewModelScope.launch {
            val entity = cipherRepository.getCipher(cipherId) ?: return@launch
            val decrypted = vaultSession.decryptCipher(entity) ?: return@launch
            _uiState.value = PasskeyGetUiState(
                ciphers = listOf(decrypted),
                selectedCipher = decrypted
            )
        }
    }

    fun loadCiphers(cipherIds: List<String>) {
        viewModelScope.launch {
            val ciphers = cipherIds.mapNotNull { id ->
                cipherRepository.getCipher(id)?.let { vaultSession.decryptCipher(it) }
            }
            _uiState.value = PasskeyGetUiState(ciphers = ciphers)
        }
    }

    fun selectCipher(cipherId: String) {
        val cipher = _uiState.value.ciphers.find { it.id == cipherId }
        _uiState.value = _uiState.value.copy(selectedCipher = cipher)
    }

    suspend fun authenticateAndSign(rpId: String): String? {
        val cipher = _uiState.value.selectedCipher ?: return null
        val passkey = cipher.passkey ?: return null
        val userKey = vaultSession.getUserKey() ?: return null

        return try {
            // 解密私钥
            val cipherKey = userKey.copyOfRange(0, 32)
            val privateKeyBase64 = vaultEncryption.decryptString(
                passkey.privateKeyEncrypted,
                cipherKey
            )
            val privateKeyBytes = Base64.getDecoder().decode(privateKeyBase64)

            // 使用私钥签名（简化实现）
            val keySpec = PKCS8EncodedKeySpec(privateKeyBytes)
            val keyFactory = KeyFactory.getInstance("EC")
            val privateKey = keyFactory.generatePrivate(keySpec)

            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initSign(privateKey)
            val dataToSign = "$rpId:${passkey.credentialId}:${System.currentTimeMillis()}".toByteArray()
            signature.update(dataToSign)
            val signed = signature.sign()

            // 构建简化的 WebAuthn 响应 JSON
            val responseJson = buildString {
                append("{")
                append("\"id\":\"${passkey.credentialId}\",")
                append("\"rawId\":\"${passkey.credentialId}\",")
                append("\"type\":\"public-key\",")
                append("\"response\":{")
                append("\"clientDataJSON\":\"${Base64.getEncoder().encodeToString(dataToSign)}\",")
                append("\"authenticatorData\":\"${Base64.getEncoder().encodeToString(byteArrayOf())}\",")
                append("\"signature\":\"${Base64.getEncoder().encodeToString(signed)}\"")
                append("}")
                append("}")
            }

            // 增加计数器
            // TODO: 更新 cipher 中的 counter

            Timber.i("Passkey signed for rpId=$rpId, credentialId=${passkey.credentialId}")
            responseJson
        } catch (e: Exception) {
            Timber.e(e, "Passkey authentication failed")
            null
        }
    }

    data class PasskeyGetUiState(
        val ciphers: List<DecryptedCipher> = emptyList(),
        val selectedCipher: DecryptedCipher? = null
    )
}
