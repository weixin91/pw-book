package com.pwbook.ui.screens.edit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.pwbook.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CipherEditScreen(
    cipherId: String?,
    viewModel: CipherEditViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
    onScanTotp: () -> Unit = {},
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(cipherId) {
        viewModel.loadCipher(cipherId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(if (uiState.isNew) stringResource(R.string.add_cipher) else stringResource(R.string.edit_cipher))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.updateFavorite(!uiState.favorite) }) {
                        Icon(
                            if (uiState.favorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                            contentDescription = "收藏"
                        )
                    }
                    if (!uiState.isNew) {
                        IconButton(onClick = { viewModel.delete(onBack) }) {
                            Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.delete))
                        }
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 名称
            OutlinedTextField(
                value = uiState.name,
                onValueChange = viewModel::updateName,
                label = { Text("名称") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            // 用户名
            OutlinedTextField(
                value = uiState.username,
                onValueChange = viewModel::updateUsername,
                label = { Text("用户名") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            // 密码（带显示/隐藏按钮和生成按钮）
            OutlinedTextField(
                value = uiState.password,
                onValueChange = viewModel::updatePassword,
                label = { Text("密码") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                visualTransformation = if (uiState.showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    Row {
                        IconButton(onClick = { viewModel.generatePassword() }) {
                            Icon(
                                imageVector = Icons.Default.Casino,
                                contentDescription = "生成随机密码"
                            )
                        }
                        IconButton(onClick = { viewModel.togglePasswordVisibility() }) {
                            Icon(
                                if (uiState.showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                contentDescription = if (uiState.showPassword) "隐藏密码" else "显示密码"
                            )
                        }
                    }
                }
            )

            // 自动填充选项（URI列表）
            Text(
                text = "自动填充选项（网站或 APP）",
                style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
                color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant
            )

            uiState.uris.forEachIndexed { index, uri ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val kindLabel = when {
                        uri.startsWith("androidapp://") -> "APP"
                        uri.startsWith("http") -> "网站"
                        else -> "URI"
                    }
                    Text(
                        text = kindLabel,
                        style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                        color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.width(36.dp)
                    )
                    OutlinedTextField(
                        value = uri,
                        onValueChange = { viewModel.updateUri(index, it) },
                        placeholder = { Text("网址或 App 包名") },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )
                    IconButton(
                        onClick = { viewModel.removeUri(index) },
                        modifier = Modifier.padding(top = 4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "删除",
                            tint = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = { viewModel.addUri("https://") },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("+ 网站")
                }
                OutlinedButton(
                    onClick = { viewModel.addUri("androidapp://") },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("+ APP")
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 备注
            OutlinedTextField(
                value = uiState.notes,
                onValueChange = viewModel::updateNotes,
                label = { Text("备注") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                maxLines = 3
            )

            // TOTP 密钥
            OutlinedTextField(
                value = uiState.totp,
                onValueChange = viewModel::updateTotp,
                label = { Text("TOTP 密钥") },
                placeholder = { Text("TOTP 密钥") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                visualTransformation = if (uiState.showTotp) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                trailingIcon = {
                    IconButton(onClick = { viewModel.toggleTotpVisibility() }) {
                        Icon(
                            if (uiState.showTotp) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                            contentDescription = if (uiState.showTotp) "隐藏密钥" else "显示密钥"
                        )
                    }
                }
            )
            OutlinedButton(
                onClick = onScanTotp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("扫描二维码录入 TOTP")
            }

            // Passkey 显示区域
            if (!uiState.isNew && uiState.hasPasskey) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "通行密钥 (Passkey)",
                            style = MaterialTheme.typography.titleSmall
                        )
                        Text(
                            text = "RP ID: ${uiState.passkeyRpId ?: "未知"}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = "添加时间: ${uiState.passkeyCreatedAt}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { viewModel.removePasskey() },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("删除通行密钥", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            // 保存按钮
            Button(
                onClick = { viewModel.save(onBack) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(stringResource(R.string.save))
            }
        }
    }
}
