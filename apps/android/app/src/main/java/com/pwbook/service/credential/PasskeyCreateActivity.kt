package com.pwbook.service.credential

import android.app.Activity
import android.content.Intent
import android.credentials.CreateCredentialException
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
import androidx.compose.material3.Button
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
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.CipherDataJson
import com.pwbook.domain.LoginDataJson
import com.pwbook.domain.LoginUriJson
import com.pwbook.domain.PasskeyDataJson
import com.pwbook.domain.VaultSession
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import com.pwbook.ui.theme.PwBookTheme
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.UUID
import javax.inject.Inject

@AndroidEntryPoint
class PasskeyCreateActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val callingPackage = intent.getStringExtra("calling_package") ?: ""
        val accountName = intent.getStringExtra("account_name") ?: ""

        setContent {
            PwBookTheme {
                PasskeyCreateContent(
                    rpId = callingPackage,
                    accountName = accountName,
                    onFinish = { success ->
                        if (success) {
                            setResult(Activity.RESULT_OK)
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
private fun PasskeyCreateContent(
    rpId: String,
    accountName: String,
    onFinish: (Boolean) -> Unit,
    viewModel: PasskeyCreateViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(rpId) {
        viewModel.loadCandidates(rpId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("保存通行密钥") }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "网站/应用: $rpId",
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "账号: $accountName",
                style = MaterialTheme.typography.bodyLarge
            )
            Spacer(modifier = Modifier.height(32.dp))

            if (uiState.candidates.isNotEmpty()) {
                Text(
                    text = "选择保存到现有凭据或新建",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(16.dp))

                uiState.candidates.forEach { cipher ->
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                viewModel.saveToExisting(cipher.id, rpId, accountName)
                                onFinish(true)
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("保存到: ${cipher.name} (${cipher.username ?: ""})")
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }

            Button(
                onClick = {
                    scope.launch {
                        viewModel.createNew(rpId, accountName)
                        onFinish(true)
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("新建凭据")
            }

            Spacer(modifier = Modifier.height(16.dp))
            OutlinedButton(
                onClick = { onFinish(false) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("取消")
            }
        }
    }
}

@HiltViewModel
class PasskeyCreateViewModel @Inject constructor(
    private val cipherRepository: CipherRepository,
    private val vaultSession: VaultSession,
    private val securePrefs: SecurePrefs,
    private val pendingChangesQueue: PendingChangesQueue,
    private val syncManager: SyncManager,
    private val vaultEncryption: com.pwbook.crypto.VaultEncryption,
    private val json: Json
) : ViewModel() {

    private val _uiState = MutableStateFlow(PasskeyCreateUiState())
    val uiState: StateFlow<PasskeyCreateUiState> = _uiState

    fun loadCandidates(rpId: String) {
        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: return
        viewModelScope.launch {
            val ciphers = cipherRepository.getCiphers(userId)
            val decrypted = ciphers.mapNotNull { vaultSession.decryptCipher(it) }
                .filter { it.passkey == null &&
                    (it.uris.any { uri -> uri.contains(rpId) || rpId.contains(uri) }) }
            _uiState.value = PasskeyCreateUiState(candidates = decrypted)
        }
    }

    suspend fun saveToExisting(cipherId: String, rpId: String, userName: String) {
        val userKey = vaultSession.getUserKey() ?: return
        val cipherKey = userKey.copyOfRange(0, 32)

        val entity = cipherRepository.getCipher(cipherId) ?: return
        val decrypted = vaultSession.decryptCipher(entity) ?: return

        val passkey = generatePasskeyData(rpId, userName)

        val updatedData = CipherDataJson(
            name = decrypted.name,
            notes = decrypted.notes,
            login = LoginDataJson(
                username = decrypted.username,
                password = decrypted.password,
                uris = decrypted.uris.map { LoginUriJson(uri = it) },
                totp = decrypted.totp,
                passkey = passkey
            )
        )

        val encryptedData = vaultEncryption.encryptString(
            json.encodeToString(updatedData),
            cipherKey
        )

        val updatedEntity = entity.copy(
            data = encryptedData,
            modifiedAt = System.currentTimeMillis()
        )
        cipherRepository.saveCipher(updatedEntity)
        pendingChangesQueue.enqueue(
            cipherId,
            PendingChangesQueue.Operation.UPDATE,
            encryptedData,
            System.currentTimeMillis()
        )
        syncManager.launchSyncAll()
        Timber.i("Passkey saved to existing cipher $cipherId")
    }

    suspend fun createNew(rpId: String, userName: String) {
        val userKey = vaultSession.getUserKey() ?: return
        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: return
        val cipherKey = userKey.copyOfRange(0, 32)

        val passkey = generatePasskeyData(rpId, userName)

        val cipherData = CipherDataJson(
            name = rpId,
            login = LoginDataJson(
                username = userName,
                uris = listOf(LoginUriJson(uri = rpId)),
                passkey = passkey
            )
        )

        val encryptedData = vaultEncryption.encryptString(
            json.encodeToString(cipherData),
            cipherKey
        )

        val entity = CipherEntity(
            id = UUID.randomUUID().toString(),
            userId = userId,
            type = 1,
            data = encryptedData,
            favorite = false,
            reprompt = 0,
            createdAt = System.currentTimeMillis(),
            modifiedAt = System.currentTimeMillis()
        )
        cipherRepository.saveCipher(entity)
        pendingChangesQueue.enqueue(
            entity.id,
            PendingChangesQueue.Operation.CREATE,
            encryptedData,
            System.currentTimeMillis()
        )
        syncManager.launchSyncAll()
        Timber.i("New passkey cipher created for rpId=$rpId")
    }

    private fun generatePasskeyData(rpId: String, userName: String): PasskeyDataJson {
        val keyPairGen = KeyPairGenerator.getInstance("EC")
        keyPairGen.initialize(ECGenParameterSpec("secp256r1"))
        val keyPair = keyPairGen.generateKeyPair()

        val credentialId = ByteArray(32).apply { SecureRandom().nextBytes(this) }
        val credentialIdBase64 = Base64.getEncoder().encodeToString(credentialId)
        val publicKeyBase64 = Base64.getEncoder().encodeToString(keyPair.public.encoded)
        val privateKeyBase64 = Base64.getEncoder().encodeToString(keyPair.private.encoded)

        val userKey = vaultSession.getUserKey()
        val privateKeyEncrypted = if (userKey != null) {
            val cipherKey = userKey.copyOfRange(0, 32)
            // 使用 VaultEncryption 加密私钥
            val encrypted = vaultEncryption.encryptString(privateKeyBase64, cipherKey)
            encrypted
        } else {
            privateKeyBase64
        }

        return PasskeyDataJson(
            credentialId = credentialIdBase64,
            rpId = rpId,
            rpName = rpId,
            userHandle = credentialIdBase64,
            userName = userName,
            privateKeyEncrypted = privateKeyEncrypted,
            publicKey = publicKeyBase64,
            counter = 0,
            createdAt = System.currentTimeMillis()
        )
    }

    data class PasskeyCreateUiState(
        val candidates: List<com.pwbook.domain.DecryptedCipher> = emptyList()
    )
}
