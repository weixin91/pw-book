package com.pwbook.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.pwbook.R
import com.pwbook.domain.DecryptedCipher
import com.pwbook.domain.matcher.UriMatcher
import com.pwbook.sync.SyncManager
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
    onNavigateToTotp: () -> Unit,
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
                            Icon(Icons.Default.Security, contentDescription = "密码生成器")
                        }
                        IconButton(onClick = onNavigateToTotp) {
                            Icon(Icons.Default.Timer, contentDescription = "TOTP验证码")
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
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = {
                    searchQuery = it
                    viewModel.onSearchQueryChange(it)
                },
                placeholder = { Text(stringResource(R.string.search)) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            if (!isAutofillMode) {
                SyncStatusCard(
                    syncState = uiState.syncState,
                    pendingCount = uiState.pendingCount,
                    lastSyncTime = uiState.lastSyncTime,
                    onSyncClick = { viewModel.sync() }
                )
            }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 0.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (isAutofillMode && searchQuery.isBlank() && targetUri != null) {
                    // 使用 UriMatcher 进行规范化域名匹配，防止钓鱼站点攻击
                    val matched = uiState.ciphers.filter { cipher ->
                        cipher.uris.any { uri -> UriMatcher.isMatch(uri, targetUri) }
                    }
                    val others = uiState.ciphers.filter { cipher ->
                        cipher.uris.none { uri -> UriMatcher.isMatch(uri, targetUri) }
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
                            UriMatcher.isMatch(uri, targetUri)
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
                if (cipher.passkey != null) {
                    Icon(
                        Icons.Default.Security,
                        contentDescription = "Passkey",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(start = 4.dp)
                    )
                }
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

@Composable
private fun SyncStatusCard(
    syncState: SyncManager.SyncState,
    pendingCount: Int,
    lastSyncTime: Long,
    onSyncClick: () -> Unit
) {
    val isSyncing = syncState == SyncManager.SyncState.SYNCING

    val rotation by animateFloatAsState(
        targetValue = if (isSyncing) 360f else 0f,
        animationSpec = if (isSyncing) {
            infiniteRepeatable(
                animation = tween(1000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            )
        } else {
            tween(durationMillis = 300)
        },
        label = "sync_rotation"
    )

    val (containerColor, contentColor, icon) = when (syncState) {
        SyncManager.SyncState.SYNCING -> Triple(
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
            Icons.Default.Sync
        )
        SyncManager.SyncState.ERROR -> Triple(
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer,
            Icons.Default.Error
        )
        SyncManager.SyncState.IDLE -> if (pendingCount > 0) {
            Triple(
                MaterialTheme.colorScheme.tertiaryContainer,
                MaterialTheme.colorScheme.onTertiaryContainer,
                Icons.Default.Sync
            )
        } else {
            Triple(
                MaterialTheme.colorScheme.surfaceVariant,
                MaterialTheme.colorScheme.onSurfaceVariant,
                Icons.Default.CheckCircle
            )
        }
        SyncManager.SyncState.OFFLINE -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
            Icons.Default.Error
        )
    }

    val statusText = when (syncState) {
        SyncManager.SyncState.SYNCING -> "同步中..."
        SyncManager.SyncState.ERROR -> "同步失败"
        SyncManager.SyncState.IDLE -> if (pendingCount > 0) "${pendingCount} 条待推送" else "已同步"
        SyncManager.SyncState.OFFLINE -> "离线模式"
    }

    Surface(
        onClick = { if (!isSyncing) onSyncClick() },
        color = containerColor,
        contentColor = contentColor,
        shape = MaterialTheme.shapes.extraSmall,
        modifier = Modifier
            .fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(24.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier
                        .size(12.dp)
                        .rotate(rotation)
                )
                Spacer(modifier = Modifier.width(4.dp))
                val timeText = when {
                    isSyncing -> ""
                    lastSyncTime > 0 -> formatRelativeTime(lastSyncTime)
                    else -> "尚未同步"
                }
                Text(
                    text = if (timeText.isNotEmpty()) "$statusText · $timeText" else statusText,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            if (!isSyncing) {
                Icon(
                    imageVector = Icons.Default.Sync,
                    contentDescription = stringResource(R.string.sync_now),
                    modifier = Modifier
                        .size(12.dp)
                        .clickable(onClick = onSyncClick)
                )
            }
        }
    }
}

private fun formatRelativeTime(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 60_000 -> "刚刚"
        diff < 3_600_000 -> "${diff / 60_000}分钟前"
        diff < 86_400_000 -> "${diff / 3_600_000}小时前"
        else -> "${diff / 86_400_000}天前"
    }
}