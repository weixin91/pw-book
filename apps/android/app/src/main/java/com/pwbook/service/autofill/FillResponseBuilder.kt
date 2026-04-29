package com.pwbook.service.autofill

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.autofill.Dataset
import android.service.autofill.Field
import android.service.autofill.FillResponse
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import com.pwbook.domain.DecryptedCipher
import timber.log.Timber

object FillResponseBuilder {

    fun build(
        context: Context,
        parsed: ParsedStructure,
        ciphers: List<DecryptedCipher>
    ): FillResponse? {
        if (parsed.usernameId == null && parsed.passwordId == null) return null

        Timber.d("FillResponseBuilder: usernameId=${parsed.usernameId}, passwordId=${parsed.passwordId}")
        val responseBuilder = FillResponse.Builder()

        ciphers.forEach { cipher ->
            Timber.d("FillResponseBuilder: cipher ${cipher.name}, username=${cipher.username}, password=${cipher.password?.take(3)}...")
            val dataset = buildDataset(context, parsed, cipher)
            responseBuilder.addDataset(dataset)
        }

        if (ciphers.isEmpty()) {
            val unlockDataset = buildUnlockDataset(context, parsed)
            responseBuilder.addDataset(unlockDataset)
        }

        val clientState = Bundle().apply {
            putString("uri", parsed.uriString)
            parsed.webDomain?.let { putString("web_domain", it) }
            putString("package_name", parsed.packageName)
        }
        responseBuilder.setClientState(clientState)

        return responseBuilder.build()
    }

    private fun buildDataset(
        context: Context,
        parsed: ParsedStructure,
        cipher: DecryptedCipher
    ): Dataset {
        val displayName = cipher.name.ifEmpty { cipher.username ?: "未命名凭据" }
        val remoteViews = RemoteViews(context.packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, displayName)
        }

        val datasetBuilder = Dataset.Builder(remoteViews)

        // 用户名字段
        parsed.usernameId?.let { id ->
            val usernameValue = cipher.username ?: ""
            if (usernameValue.isNotEmpty()) {
                Timber.d("buildDataset: setting username '$usernameValue' for field ${id}")
                val field = Field.Builder()
                    .setValue(AutofillValue.forText(usernameValue))
                    .build()
                datasetBuilder.setField(id, field)
            } else {
                Timber.d("buildDataset: cipher has no username to fill")
            }
        }

        // 密码字段
        parsed.passwordId?.let { id ->
            val passwordValue = cipher.password ?: ""
            if (passwordValue.isNotEmpty()) {
                Timber.d("buildDataset: setting password for field ${id}")
                val field = Field.Builder()
                    .setValue(AutofillValue.forText(passwordValue))
                    .build()
                datasetBuilder.setField(id, field)
            }
        }

        return datasetBuilder.build()
    }

    private fun buildUnlockDataset(
        context: Context,
        parsed: ParsedStructure
    ): Dataset {
        val remoteViews = RemoteViews(context.packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, "解锁 Password Book 以自动填充")
        }

        val intent = Intent(context, com.pwbook.ui.MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return Dataset.Builder(remoteViews)
            .setAuthentication(pendingIntent.intentSender)
            .build()
    }
}
