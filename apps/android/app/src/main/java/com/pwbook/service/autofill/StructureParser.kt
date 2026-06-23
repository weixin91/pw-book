package com.pwbook.service.autofill

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import com.pwbook.domain.matcher.UriMatcher

data class ParsedStructure(
    val packageName: String,
    val webDomain: String?,
    val usernameId: AutofillId?,
    val passwordId: AutofillId?,
    val usernameHints: List<String>,
    val passwordHints: List<String>,
    val allFields: List<AutofillField>,
    val uriString: String
)

data class AutofillField(
    val id: AutofillId,
    val autofillHints: List<String>,
    val htmlInfo: String?,
    val htmlAttributes: Map<String, String>,
    val inputType: Int,
    val className: String?,
    val textValue: String?,
    val index: Int
)

internal object FieldDetectionRules {

    // 命中后字段直接退出用户名/密码候选
    val negativeKeywords: Set<String> = setOf(
        "search", "query", "q", "keyword", "find",
        "chat", "message", "comment", "subject", "title"
    )

    fun isNegative(field: AutofillField): Boolean {
        val haystacks = buildList {
            addAll(field.autofillHints)
            addAll(field.htmlAttributes.values)
        }.map { it.lowercase() }

        return haystacks.any { haystack ->
            negativeKeywords.any { keyword ->
                if (keyword.length == 1) {
                    haystack == keyword
                } else {
                    haystack.contains(keyword)
                }
            }
        }
    }

    fun isStrongUsernameSignal(field: AutofillField): Boolean {
        val hintsLower = field.autofillHints.map { it.lowercase() }
        if (hintsLower.any {
                it.contains("user") ||
                it.contains("username") ||
                it.contains("email") ||
                it.contains("login") ||
                it.contains("account")
            }) {
            return true
        }
        if (field.htmlAttributes["type"]?.lowercase() == "email") return true
        val variation = field.inputType and InputType.TYPE_MASK_VARIATION
        if (variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
        ) {
            return true
        }
        return false
    }

    fun isPasswordSignal(field: AutofillField): Boolean {
        val hintsLower = field.autofillHints.map { it.lowercase() }
        if (hintsLower.any {
                it.contains("password") ||
                it.contains("pwd") ||
                it.contains("pass")
            }) {
            return true
        }
        if (field.htmlAttributes["type"]?.lowercase() == "password") return true
        val variation = field.inputType and InputType.TYPE_MASK_VARIATION
        if (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
            variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
        ) {
            return true
        }
        return false
    }
}

object StructureParser {

    fun parse(structure: AssistStructure): ParsedStructure {
        val packageName = structure.activityComponent?.packageName
            ?: structure.getWindowNodeAt(0).rootViewNode.idPackage
            ?: ""
        var webDomain: String? = null
        val fields = mutableListOf<AutofillField>()
        var fieldIndex = 0

        for (i in 0 until structure.windowNodeCount) {
            val windowNode = structure.getWindowNodeAt(i)
            val rootView = windowNode.rootViewNode
            traverseNode(rootView) { node ->
                if (webDomain == null) {
                    webDomain = node.webDomain
                }
                if (isPotentialField(node)) {
                    val hints = collectHints(node)
                    val htmlAttrs = collectHtmlAttributes(node)
                    fields.add(
                        AutofillField(
                            id = node.autofillId!!,
                            autofillHints = hints,
                            htmlInfo = node.htmlInfo?.tag,
                            htmlAttributes = htmlAttrs,
                            inputType = node.inputType,
                            className = node.className,
                            textValue = node.text?.toString(),
                            index = fieldIndex++
                        )
                    )
                }
            }
        }

        val uriString = buildUriString(packageName, webDomain)

        val negativeFields = fields.filter { FieldDetectionRules.isNegative(it) }
        if (negativeFields.isNotEmpty()) {
            android.util.Log.d(
                "StructureParser",
                "Filtered negative fields: ${negativeFields.map { it.htmlAttributes }}"
            )
        }

        // 改进的字段识别逻辑
        val usernameField = findUsernameField(fields)
        val passwordField = findPasswordField(fields)

        return ParsedStructure(
            packageName = packageName,
            webDomain = webDomain,
            usernameId = usernameField?.id,
            passwordId = passwordField?.id,
            usernameHints = usernameField?.autofillHints ?: emptyList(),
            passwordHints = passwordField?.autofillHints ?: emptyList(),
            allFields = fields,
            uriString = uriString
        )
    }

    internal fun detectFields(
        fields: List<AutofillField>
    ): Pair<AutofillField?, AutofillField?> {
        val filtered = fields.filterNot { FieldDetectionRules.isNegative(it) }
        val passwordField = filtered.find { FieldDetectionRules.isPasswordSignal(it) }

        val usernameField = filtered.find { FieldDetectionRules.isStrongUsernameSignal(it) }
            ?: passwordField?.let { pwd ->
                val candidates = filtered.filter { it.index < pwd.index }
                    .filterNot { FieldDetectionRules.isPasswordSignal(it) }
                    .filter { isTextField(it) }
                // 弱信号：当存在密码字段但无强用户名信号时，
                // 尝试通过 HTML name/id 属性匹配用户名相关字段
                candidates.find { field ->
                    val name = field.htmlAttributes["name"]?.lowercase() ?: ""
                    val id = field.htmlAttributes["id"]?.lowercase() ?: ""
                    name.contains("user") || name.contains("email") ||
                    name.contains("login") || name.contains("account") ||
                    id.contains("user") || id.contains("email") ||
                    id.contains("login") || id.contains("account")
                } ?: candidates.lastOrNull()
            }

        return usernameField to passwordField
    }

    private fun traverseNode(node: AssistStructure.ViewNode, onNode: (AssistStructure.ViewNode) -> Unit) {
        onNode(node)
        for (i in 0 until node.childCount) {
            traverseNode(node.getChildAt(i), onNode)
        }
    }

    private fun collectHints(node: AssistStructure.ViewNode): List<String> {
        val hints = mutableListOf<String>()
        node.autofillHints?.let { hints.addAll(it) }
        return hints.filter { it.isNotBlank() }
    }

    private fun collectHtmlAttributes(node: AssistStructure.ViewNode): Map<String, String> {
        val attrs = mutableMapOf<String, String>()
        node.htmlInfo?.attributes?.forEach { attr ->
            attrs[attr.first] = attr.second ?: ""
        }
        return attrs
    }

    private fun isPotentialField(node: AssistStructure.ViewNode): Boolean {
        return node.autofillId != null &&
                (node.className?.contains("EditText") == true ||
                        node.className?.contains("TextInput") == true ||
                        node.className?.contains("AutoCompleteTextView") == true ||
                        node.htmlInfo?.tag == "input")
    }

    private fun findUsernameField(fields: List<AutofillField>): AutofillField? {
        return detectFields(fields).first
    }

    private fun findPasswordField(fields: List<AutofillField>): AutofillField? {
        return detectFields(fields).second
    }

    private fun isPasswordField(field: AutofillField): Boolean {
        return FieldDetectionRules.isPasswordSignal(field)
    }

    private fun isTextField(field: AutofillField): Boolean {
        // 不是密码类型的文本输入
        if (isPasswordField(field)) return false
        val textTypes = listOf(
            InputType.TYPE_CLASS_TEXT,
            InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
            InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
            InputType.TYPE_TEXT_VARIATION_PERSON_NAME,
            InputType.TYPE_TEXT_VARIATION_NORMAL
        )
        return textTypes.any { (field.inputType and it) != 0 } ||
               field.htmlInfo == "input"
    }

    private fun buildUriString(packageName: String, webDomain: String?): String {
        return if (webDomain != null) {
            "https://$webDomain"
        } else {
            "androidapp://$packageName"
        }
    }

    fun extractSaveData(structure: AssistStructure, clientState: Map<String, String>?): SaveData? {
        val parsed = parse(structure)
        val usernameId = parsed.usernameId ?: return null
        val passwordId = parsed.passwordId ?: return null

        var username: String? = null
        var password: String? = null

        for (i in 0 until structure.windowNodeCount) {
            val rootView = structure.getWindowNodeAt(i).rootViewNode
            traverseNode(rootView) { node ->
                if (node.autofillId == usernameId) {
                    username = node.text?.toString()
                }
                if (node.autofillId == passwordId) {
                    password = node.text?.toString()
                }
            }
        }

        return if (username != null || password != null) {
            SaveData(
                uriString = parsed.uriString,
                username = username,
                password = password,
                packageName = parsed.packageName,
                webDomain = parsed.webDomain
            )
        } else null
    }
}

data class SaveData(
    val uriString: String,
    val username: String?,
    val password: String?,
    val packageName: String,
    val webDomain: String?
)
