package com.pwbook.service.credential

import com.pwbook.data.local.entity.DomainAssocEntity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Passkey 凭据匹配工具。
 */
object PasskeyMatcher {

    /**
     * 检查 passkey.rpId 是否与请求匹配。
     *
     * 规则：
     * 1. 直接相等（不区分大小写）
     * 2. origin host 以 passkey.rpId 结尾（支持子域）
     * 3. 通过 DomainAssociation 规则检查 callingPackage 与 rpId 的关联
     */
    fun isRpIdMatch(
        passkeyRpId: String,
        requestedRpId: String,
        callingPackage: String = "",
        domainRules: List<DomainAssocEntity> = emptyList()
    ): Boolean {
        val pId = passkeyRpId.lowercase()
        val rId = requestedRpId.lowercase()

        if (pId == rId) return true
        if (rId.endsWith(".$pId")) return true

        // DomainAssociation 检查
        if (callingPackage.isNotEmpty() && domainRules.isNotEmpty()) {
            for (rule in domainRules) {
                val domains = parseStringList(rule.domains)
                val packages = parseStringList(rule.packageNames)

                val domainMatch = domains.any {
                    val d = it.lowercase()
                    d == pId || pId.endsWith(".$d")
                }
                val packageMatch = packages.any { it == callingPackage }

                if (domainMatch && packageMatch) return true
            }
        }

        return false
    }

    /**
     * 检查 credentialId 是否在 allowCredentials 列表中。
     * 按 WebAuthn 规范，allowCredentials 缺失或为空数组时表示允许任意凭据
     * （discoverable credential / passwordless 流程）。
     */
    fun isCredentialAllowed(credentialId: String, allowCredentials: String?): Boolean {
        if (allowCredentials.isNullOrEmpty()) return true
        return try {
            val array = Json.parseToJsonElement(allowCredentials).jsonArray
            if (array.isEmpty()) return true
            array.any { element ->
                val id = element.jsonObject["id"]?.jsonPrimitive?.content
                id == credentialId
            }
        } catch (e: Exception) {
            // 解析失败时默认允许
            true
        }
    }

    /**
     * 重载：直接接受 org.json.JSONArray，避免冗余序列化。
     */
    fun isCredentialAllowed(credentialId: String, allowCredentials: org.json.JSONArray?): Boolean {
        if (allowCredentials == null || allowCredentials.length() == 0) return true
        return (0 until allowCredentials.length()).any { i ->
            allowCredentials.getJSONObject(i).optString("id") == credentialId
        }
    }

    private fun parseStringList(json: String): List<String> {
        return try {
            Json.decodeFromString<List<String>>(json)
        } catch (e: Exception) {
            emptyList()
        }
    }
}
