package com.pwbook.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.pwbook.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TypeSelectionBottomSheet(
    onDismiss: () -> Unit,
    onSelectLogin: () -> Unit,
    onSelectNote: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text(
                text = stringResource(R.string.select_type),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 12.dp)
            )
            TextButton(
                onClick = {
                    onDismiss()
                    onSelectLogin()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("🔐 ${stringResource(R.string.type_login)}")
            }
            TextButton(
                onClick = {
                    onDismiss()
                    onSelectNote()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("📝 ${stringResource(R.string.type_note)}")
            }
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(stringResource(R.string.cancel))
            }
        }
    }
}
