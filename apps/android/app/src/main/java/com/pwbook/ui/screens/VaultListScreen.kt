package com.pwbook.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.pwbook.R
import com.pwbook.domain.DecryptedCipher
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultListScreen(
    viewModel: VaultListViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
    isAutofillMode: Boolean = false,
    targetUri: String? = null,
    onNavigateToEdit: (String?) -> Unit,
    onNavigateToGenerator: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onLock: () -> Unit,
    onCipherSelected: ((String) -> Unit)? = null,
    onCancel: (() -> Unit)? = null
) {
    val uiState by viewModel.uiState.collectAsState()
    val scope = rememberCoroutineScope()

    // 搜索框状态在 UI 层本地管理，避免 StateFlow 重组导致光标位置错乱
    var searchQuery by remember { mutableStateOf("") }

    LaunchedEffect(targetUri) {
        viewModel.setTargetUri(targetUri)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = if (isAutofillMode) "选择凭据" else stringResource(R.string.vault_title),
                            style = MaterialTheme.typography.titleLarge
                        )
                        if (!isAutofillMode) {
                            val count = uiState.ciphers.size
                            Text(
                                text = "共 ${count} 条凭据",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                actions = {
                    if (isAutofillMode) {
                        IconButton(onClick = { onCancel?.invoke() }) {
                            Icon(Icons.Default.Close, contentDescription = "取消")
                        }
                    } else {
                        IconButton(onClick = onNavigateToGenerator) {
                            Text("🔐")
                        }
                        IconButton(onClick = onNavigateToSettings) {
                            Icon(Icons.Default.Settings, contentDescription = stringResource(R.string.settings))
                        }
                        IconButton(onClick = onLock) {
                            Icon(Icons.Default.Lock, contentDescription = stringResource(R.string.lock))
                        }
                    }
                }
            )
        },
        floatingActionButton = {
            if (!isAutofillMode) {
                FloatingActionButton(onClick = { onNavigateToEdit(null) }) {
                    Icon(Icons.Default.Add, contentDescription = stringResource(R.string.add_cipher))
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = {
                    searchQuery = it
                    viewModel.onSearchQueryChange(it)
                },
                placeholder = { Text(stringResource(R.string.search)) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                singleLine = true
            )
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (isAutofillMode && searchQuery.isBlank() && targetUri != null) {
                    val matched = uiState.ciphers.filter { cipher ->
                        cipher.uris.any { uri -> uri == targetUri || uri.contains(targetUri) || targetUri.contains(uri) }
                    }
                    val others = uiState.ciphers.filter { cipher ->
                        cipher.uris.none { uri -> uri == targetUri || uri.contains(targetUri) || targetUri.contains(uri) }
                    }
                    if (matched.isNotEmpty()) {
                        item {
                            Text(
                                text = "匹配该网站的凭据",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                        items(matched, key = { it.id }) { cipher ->
                            CipherListItem(
                                cipher = cipher,
                                isMatch = true,
                                onClick = {
                                    scope.launch {
                                        viewModel.selectCipherForAutofill(cipher.id, targetUri)
                                        onCipherSelected?.invoke(cipher.id)
                                    }
                                }
                            )
                        }
                    }
                    if (others.isNotEmpty()) {
                        item {
                            Text(
                                text = "其他凭据",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                        items(others, key = { it.id }) { cipher ->
                            CipherListItem(
                                cipher = cipher,
                                isMatch = false,
                                onClick = {
                                    scope.launch {
                                        viewModel.selectCipherForAutofill(cipher.id, targetUri)
                                        onCipherSelected?.invoke(cipher.id)
                                    }
                                }
                            )
                        }
                    }
                } else {
                    items(uiState.ciphers, key = { it.id }) { cipher ->
                        val isMatch = targetUri != null && cipher.uris.any { uri ->
                            uri == targetUri || uri.contains(targetUri) || targetUri.contains(uri)
                        }
                        CipherListItem(
                            cipher = cipher,
                            isMatch = isMatch,
                            onClick = {
                                if (isAutofillMode) {
                                    scope.launch {
                                        viewModel.selectCipherForAutofill(cipher.id, targetUri)
                                        onCipherSelected?.invoke(cipher.id)
                                    }
                                } else {
                                    onNavigateToEdit(cipher.id)
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CipherListItem(
    cipher: DecryptedCipher,
    isMatch: Boolean = false,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            androidx.compose.foundation.layout.Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = cipher.name,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f)
                )
                if (isMatch) {
                    Text(
                        text = "匹配",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(start = 8.dp)
                    )
                }
            }
            if (cipher.username != null) {
                Text(
                    text = cipher.username,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                text = "修改于 ${java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.getDefault()).format(java.util.Date(cipher.modifiedAt))}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}