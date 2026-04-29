package com.pwbook.ui.settings

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.pwbook.R
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.ui.screens.VaultListViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: VaultListViewModel,
    settingsRepository: SettingsRepository,
    onBack: () -> Unit,
    onLogout: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var serverUrl by remember { mutableStateOf(settingsRepository.getServerUrl() ?: "") }
    var vaultTimeout by remember { mutableStateOf(settingsRepository.getVaultTimeoutMinutes().toString()) }
    val biometricEnabled by settingsRepository.observeString("biometric_enabled")
        .collectAsState(initial = "false")

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
                    checked = biometricEnabled == "true",
                    onCheckedChange = { enabled ->
                        scope.launch {
                            settingsRepository.setString("biometric_enabled", enabled.toString())
                        }
                    }
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
            Button(
                onClick = {
                    settingsRepository.clearAll()
                    viewModel.lock()
                    onLogout()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("退出登录")
            }
        }
    }
}