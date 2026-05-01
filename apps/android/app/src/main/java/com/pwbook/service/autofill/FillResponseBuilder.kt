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
import com.pwbook.R
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
        val requestId = java.util.UUID.randomUUID().toString()

        ciphers.forEach { cipher ->
            Timber.d("FillResponseBuilder: cipher ${cipher.name}, username=${cipher.username}, password=${cipher.password?.take(3)}...")
            val dataset = buildDataset(context, parsed, cipher)
            responseBuilder.addDataset(dataset)
        }

        // 始终添加"打开密码库"选项
        val vaultDataset = buildVaultDataset(context, parsed, requestId)
        responseBuilder.addDataset(vaultDataset)

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
        val remoteViews = RemoteViews(context.packageName, R.layout.autofill_item_cipher).apply {
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

    private fun buildVaultDataset(
        context: Context,
        parsed: ParsedStructure,
        requestId: String
    ): Dataset {
        // 保存最后一次请求 ID，用于返回后匹配选择结果
        context.getSharedPreferences("pwbook_autofill", Context.MODE_PRIVATE)
            .edit()
            .putString("last_autofill_request_id", requestId)
            .apply()

        val accentColor = resolveAccentColor(context)
        val remoteViews = RemoteViews(context.packageName, R.layout.autofill_item_vault).apply {
            setTextViewText(android.R.id.text1, "打开密码库")
            if (accentColor != null) {
                setTextColor(android.R.id.text1, accentColor)
            }
        }

        val intent = Intent(context, com.pwbook.ui.MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("autofill_mode", "select")
            putExtra("autofill_uri", parsed.uriString)
            putExtra("autofill_request_id", requestId)
        }
        val pendingIntent = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val datasetBuilder = Dataset.Builder(remoteViews)
            .setAuthentication(pendingIntent.intentSender)

        // 必须至少设置一个 field，否则 build() 会抛 IllegalStateException
        parsed.usernameId?.let { id ->
            datasetBuilder.setValue(id, AutofillValue.forText(""))
        }
        parsed.passwordId?.let { id ->
            datasetBuilder.setValue(id, AutofillValue.forText(""))
        }

        return datasetBuilder.build()
    }

    private fun resolveAccentColor(context: Context): Int? {
        return try {
            val typedValue = android.util.TypedValue()
            if (context.theme.resolveAttribute(android.R.attr.colorAccent, typedValue, true)) {
                typedValue.data
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }
}
