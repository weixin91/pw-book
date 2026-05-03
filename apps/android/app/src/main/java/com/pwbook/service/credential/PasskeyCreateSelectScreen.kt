package com.pwbook.service.credential

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.pwbook.domain.DecryptedCipher

/**
 * Passkey 创建时选择保存位置的界面。
 *
 * 默认展示与当前 rpId 匹配的凭据（置顶）及其他 LOGIN 凭据，支持搜索过滤。
 * 已有 passkey 的凭据会标注"将替换现有通行密钥"。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PasskeyCreateSelectScreen(
    rpId: String,
    ciphers: List<DecryptedCipher>,
    onSelect: (cipherId: String?) -> Unit,
    onCancel: () -> Unit
) {
    var searchQuery by remember { mutableStateOf("") }

    val filtered = if (searchQuery.isBlank()) ciphers else {
        ciphers.filter {
            it.name.contains(searchQuery, ignoreCase = true) ||
                it.username?.contains(searchQuery, ignoreCase = true) == true ||
                it.uris.any { uri -> uri.contains(searchQuery, ignoreCase = true) }
        }
    }

    val isSearching = searchQuery.isNotBlank()

    val matched = if (!isSearching) {
        filtered.filter { cipher -> isCipherMatchRpId(cipher, rpId) }
    } else emptyList()
    val others = if (!isSearching) {
        filtered.filter { cipher -> !isCipherMatchRpId(cipher, rpId) }
    } else emptyList()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("选择保存位置") },
                navigationIcon = {
                    IconButton(onClick = onCancel) {
                        Icon(Icons.Default.Close, contentDescription = "取消")
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { onSelect(null) },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("新建凭据") }
            )
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
                onValueChange = { searchQuery = it },
                placeholder = { Text("搜索凭据") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Spacer(modifier = Modifier.height(8.dp))
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 80.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (!isSearching && matched.isNotEmpty()) {
                    item {
                        Text(
                            text = "相关凭据",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                    items(matched, key = { it.id }) { cipher ->
                        CipherSelectItem(
                            cipher = cipher,
                            onClick = { onSelect(cipher.id) }
                        )
                    }
                }
                if (!isSearching && others.isNotEmpty()) {
                    item {
                        Text(
                            text = "其他凭据",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                    items(others, key = { it.id }) { cipher ->
                        CipherSelectItem(
                            cipher = cipher,
                            onClick = { onSelect(cipher.id) }
                        )
                    }
                }
                if (isSearching) {
                    items(filtered, key = { it.id }) { cipher ->
                        CipherSelectItem(
                            cipher = cipher,
                            onClick = { onSelect(cipher.id) }
                        )
                    }
                }
            }
        }
    }
}

private fun isCipherMatchRpId(cipher: DecryptedCipher, rpId: String): Boolean {
    if (cipher.passkey?.rpId == rpId) return true
    return cipher.uris.any { uri -> uri.contains(rpId, ignoreCase = true) }
}

@Composable
private fun CipherSelectItem(
    cipher: DecryptedCipher,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
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
            if (cipher.passkey != null) {
                Text(
                    text = "该凭据已有通行密钥，将替换",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }
    }
}
