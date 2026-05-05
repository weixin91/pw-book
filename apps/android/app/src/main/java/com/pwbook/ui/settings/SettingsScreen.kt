package com.pwbook.ui.settings

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.pwbook.R
import com.pwbook.data.datasource.BiometricUnlockManager
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.ui.screens.VaultListViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: VaultListViewModel,
    settingsRepository: SettingsRepository,
    biometricUnlockManager: BiometricUnlockManager,
    onBack: () -> Unit,
    onLogout: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var serverUrl by remember { mutableStateOf(settingsRepository.getServerUrl() ?: "") }
    var vaultTimeout by remember { mutableStateOf(settingsRepository.getVaultTimeoutMinutes().toString()) }
    val biometricEnabled by settingsRepository.observeString("biometric_enabled")
        .collectAsState(initial = "false")
    var isBiometricSwitching by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "服务器配置",
                style = MaterialTheme.typography.titleMedium
            )
            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it },
                label = { Text("服务器地址") },
                placeholder = { Text("http://10.0.2.2:3000") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    settingsRepository.setServerUrl(serverUrl.takeIf { it.isNotBlank() })
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("保存服务器地址")
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "保险库设置",
                style = MaterialTheme.typography.titleMedium
            )
            OutlinedTextField(
                value = vaultTimeout,
                onValueChange = { vaultTimeout = it },
                label = { Text("自动锁定时间 (分钟)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    vaultTimeout.toIntOrNull()?.let { mins ->
                        settingsRepository.setVaultTimeoutMinutes(mins)
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("保存锁定设置")
            }

            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("生物识别解锁", modifier = Modifier.weight(1f))
                Switch(
                    checked = biometricEnabled == "true" && !isBiometricSwitching,
                    enabled = !isBiometricSwitching && biometricUnlockManager.canAuthenticate(),
                    onCheckedChange = { enabled ->
                        val activity = context as? FragmentActivity
                        if (activity == null) {
                            Toast.makeText(context, "无法获取 Activity", Toast.LENGTH_SHORT).show()
                            return@Switch
                        }
                        scope.launch {
                            isBiometricSwitching = true
                            try {
                                if (enabled) {
                                    // 开启生物识别：需要当前已解锁，并用生物识别验证
                                    val result = biometricUnlockManager.setupBiometricUnlock(activity)
                                    result.fold(
                                        onSuccess = {
                                            settingsRepository.setString("biometric_enabled", "true")
                                            Toast.makeText(context, "生物识别解锁已开启", Toast.LENGTH_SHORT).show()
                                        },
                                        onFailure = { e ->
                                            settingsRepository.setString("biometric_enabled", "false")
                                            Toast.makeText(context, e.message ?: "开启失败", Toast.LENGTH_SHORT).show()
                                        }
                                    )
                                } else {
                                    // 关闭生物识别
                                    biometricUnlockManager.disableBiometricUnlock()
                                    settingsRepository.setString("biometric_enabled", "false")
                                    Toast.makeText(context, "生物识别解锁已关闭", Toast.LENGTH_SHORT).show()
                                }
                            } finally {
                                isBiometricSwitching = false
                            }
                        }
                    }
                )
            }
            if (!biometricUnlockManager.canAuthenticate()) {
                Text(
                    text = "设备不支持生物识别或未录入指纹/面部数据",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
            Button(
                onClick = {
                    scope.launch {
                        viewModel.logout()
                        settingsRepository.clearAll()
                        onLogout()
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("退出登录")
            }
        }
    }
}
