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

    /**
     * 改进的用户名字段识别：
     * 1. 明确的 autofill hints (username, email, login 等)
     * 2. HTML input type="email" 或 type="text"
     * 3. HTML name/id 属性包含 user/email/login/account
     * 4. Android inputType 为 email 类型
     * 5. 非 password 类型的文本输入框（且通常在密码字段前面）
     */
    private fun findUsernameField(fields: List<AutofillField>): AutofillField? {
        // 1. 先查找有明确 hints 的
        val explicitUsername = fields.find { field ->
            val hintsLower = field.autofillHints.map { it.lowercase() }
            hintsLower.any { hint ->
                hint.contains("username") ||
                hint.contains("user") ||
                hint.contains("email") ||
                hint.contains("login") ||
                hint.contains("account")
            }
        }
        if (explicitUsername != null) return explicitUsername

        // 2. 查找 HTML 属性中的用户名标识
        val htmlUsername = fields.find { field ->
            val nameAttr = field.htmlAttributes["name"]?.lowercase() ?: ""
            val idAttr = field.htmlAttributes["id"]?.lowercase() ?: ""
            val typeAttr = field.htmlAttributes["type"]?.lowercase() ?: ""

            nameAttr.contains("user") || nameAttr.contains("email") || nameAttr.contains("login") ||
            idAttr.contains("user") || idAttr.contains("email") || idAttr.contains("login") ||
            typeAttr == "email" || typeAttr == "text"
        }
        if (htmlUsername != null) return htmlUsername

        // 3. 查找 Android inputType 为 email 的
        val emailType = fields.find { field ->
            (field.inputType and InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS) != 0 ||
            (field.inputType and InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) != 0
        }
        if (emailType != null) return emailType

        // 4. 找到密码字段，然后找它前面的非密码文本字段作为用户名
        val passwordField = findPasswordField(fields)
        if (passwordField != null) {
            val beforePassword = fields.filter { it.index < passwordField.index }
                .filter { !isPasswordField(it) }
                .filter { isTextField(it) }
            return beforePassword.lastOrNull()
        }

        // 5. 无密码字段且无明确用户名信号 — 不识别为登录场景
        // 避免在微信聊天框、搜索框等普通文本输入处误弹出"解锁 Password Book"
        return null
    }

    /**
     * 改进的密码字段识别
     */
    private fun findPasswordField(fields: List<AutofillField>): AutofillField? {
        // 1. 明确的 autofill hints
        val explicitPassword = fields.find { field ->
            val hintsLower = field.autofillHints.map { it.lowercase() }
            hintsLower.any { hint ->
                hint.contains("password") ||
                hint.contains("pwd") ||
                hint.contains("pass")
            }
        }
        if (explicitPassword != null) return explicitPassword

        // 2. HTML type="password"
        val htmlPassword = fields.find { field ->
            field.htmlAttributes["type"]?.lowercase() == "password"
        }
        if (htmlPassword != null) return htmlPassword

        // 3. Android inputType 为 password
        val androidPassword = fields.find { field ->
            (field.inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0 ||
            (field.inputType and InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD) != 0 ||
            (field.inputType and InputType.TYPE_NUMBER_VARIATION_PASSWORD) != 0
        }
        return androidPassword
    }

    private fun isPasswordField(field: AutofillField): Boolean {
        val hintsLower = field.autofillHints.map { it.lowercase() }
        if (hintsLower.any { it.contains("pass") || it.contains("pwd") }) return true
        if (field.htmlAttributes["type"]?.lowercase() == "password") return true
        if ((field.inputType and InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0) return true
        if ((field.inputType and InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD) != 0) return true
        return false
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
