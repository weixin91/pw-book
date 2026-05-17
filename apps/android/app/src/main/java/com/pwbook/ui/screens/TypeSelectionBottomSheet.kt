package com.pwbook.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

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
                text = "选择类型",
                style = androidx.compose.material3.MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 12.dp)
            )
            TextButton(
                onClick = {
                    onDismiss()
                    onSelectLogin()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("密码凭据")
            }
            TextButton(
                onClick = {
                    onDismiss()
                    onSelectNote()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("安全笔记")
            }
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("取消")
            }
        }
    }
}
