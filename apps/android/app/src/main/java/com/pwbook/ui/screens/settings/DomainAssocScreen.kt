package com.pwbook.ui.screens.settings

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.DomainAssocEntity
import com.pwbook.data.repository.DomainAssocRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import androidx.lifecycle.viewModelScope
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DomainAssocScreen(
    viewModel: DomainAssocViewModel = hiltViewModel(),
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    var showAddDialog by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.loadRules()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("域名关联规则") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showAddDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = "添加规则")
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
        ) {
            Text(
                text = "配置域名和应用包名之间的共享规则。同一规则内的域名和包名会共享凭据。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 8.dp)
            )
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(uiState.rules, key = { it.id }) { rule ->
                    DomainAssocItem(
                        rule = rule,
                        onDelete = { viewModel.deleteRule(rule.id) }
                    )
                }
            }
        }
    }

    if (showAddDialog) {
        AddDomainAssocDialog(
            onDismiss = { showAddDialog = false },
            onConfirm = { domains, packages ->
                viewModel.addRule(domains, packages)
                showAddDialog = false
            }
        )
    }
}

@Composable
private fun DomainAssocItem(
    rule: DomainAssocEntity,
    onDelete: () -> Unit
) {
    val domains = remember { Json.decodeFromString<List<String>>(rule.domains) }
    val packages = remember { Json.decodeFromString<List<String>>(rule.packageNames) }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "规则",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "删除", tint = MaterialTheme.colorScheme.error)
                }
            }
            if (domains.isNotEmpty()) {
                Text(
                    text = "域名: ${domains.joinToString(", ")}",
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            if (packages.isNotEmpty()) {
                Text(
                    text = "包名: ${packages.joinToString(", ")}",
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}

@Composable
private fun AddDomainAssocDialog(
    onDismiss: () -> Unit,
    onConfirm: (domains: List<String>, packages: List<String>) -> Unit
) {
    var domainsText by remember { mutableStateOf("") }
    var packagesText by remember { mutableStateOf("") }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("添加域名关联") },
        text = {
            Column {
                OutlinedTextField(
                    value = domainsText,
                    onValueChange = { domainsText = it },
                    label = { Text("域名（逗号分隔）") },
                    placeholder = { Text("example.com, sub.example.com") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = packagesText,
                    onValueChange = { packagesText = it },
                    label = { Text("包名（逗号分隔）") },
                    placeholder = { Text("com.example.app") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val domains = domainsText.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                    val packages = packagesText.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                    if (domains.isNotEmpty() || packages.isNotEmpty()) {
                        onConfirm(domains, packages)
                    }
                }
            ) {
                Text("添加")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

@HiltViewModel
class DomainAssocViewModel @Inject constructor(
    private val domainAssocRepository: DomainAssocRepository,
    private val securePrefs: SecurePrefs,
    private val json: Json
) : androidx.lifecycle.ViewModel() {

    private val _uiState = MutableStateFlow(DomainAssocUiState())
    val uiState: StateFlow<DomainAssocUiState> = _uiState

    fun loadRules() {
        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: return
        viewModelScope.launch {
            domainAssocRepository.observeRules(userId).collect { rules ->
                _uiState.value = DomainAssocUiState(rules = rules)
            }
        }
    }

    fun addRule(domains: List<String>, packages: List<String>) {
        val userId = securePrefs.getString(SecurePrefs.KEY_USER_ID) ?: return
        val entity = DomainAssocEntity(
            id = UUID.randomUUID().toString(),
            userId = userId,
            domains = json.encodeToString(domains),
            packageNames = json.encodeToString(packages),
            createdAt = System.currentTimeMillis()
        )
        viewModelScope.launch {
            domainAssocRepository.saveRule(entity)
            Timber.i("Added domain association rule: $domains, $packages")
        }
    }

    fun deleteRule(id: String) {
        viewModelScope.launch {
            domainAssocRepository.deleteRule(id)
            Timber.i("Deleted domain association rule: $id")
        }
    }

    data class DomainAssocUiState(
        val rules: List<DomainAssocEntity> = emptyList()
    )
}
