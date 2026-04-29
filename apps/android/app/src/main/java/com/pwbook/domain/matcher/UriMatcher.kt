package com.pwbook.domain.matcher

import com.pwbook.data.local.entity.DomainAssocEntity
import com.pwbook.domain.model.LoginUri
import com.pwbook.domain.model.UriMatchType

object UriMatcher {

    private val MULTI_SEGMENT_TLDS = setOf(
        "com.cn", "co.uk", "co.jp", "com.hk", "com.tw", "com.au",
        "co.kr", "com.sg", "com.br", "com.mx", "co.za", "co.in",
        "com.ar", "com.tr", "com.ua", "com.my", "com.vn", "co.id",
        "com.ph", "com.th", "co.nz", "com.pl", "com.ru"
    )

    fun getBaseDomain(host: String): String {
        val trimmed = host.trim().lowercase()
        if (trimmed.isEmpty() || trimmed.matches(Regex("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$"))) {
            return trimmed
        }
        val parts = trimmed.split(".")
        if (parts.size <= 2) return trimmed
        val lastTwo = parts.takeLast(2).joinToString(".")
        return if (lastTwo in MULTI_SEGMENT_TLDS && parts.size >= 3) {
            parts.takeLast(3).joinToString(".")
        } else {
            lastTwo
        }
    }

    fun parseUri(uriString: String): ParsedUri {
        val trimmed = uriString.trim()
        return when {
            trimmed.startsWith("androidapp://", ignoreCase = true) -> {
                val pkg = trimmed.removePrefix("androidapp://").removePrefix("AndroidApp://")
                ParsedUri(type = UriType.APP, packageName = pkg, baseDomain = null, raw = trimmed)
            }
            trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true) -> {
                val host = extractHost(trimmed)
                ParsedUri(type = UriType.WEB, packageName = null, baseDomain = getBaseDomain(host), raw = trimmed)
            }
            else -> ParsedUri(type = UriType.OTHER, packageName = null, baseDomain = null, raw = trimmed)
        }
    }

    private fun extractHost(url: String): String {
        return try {
            val noScheme = url.substringAfter("://")
            noScheme.substringBefore("/").substringBefore(":")
        } catch (_: Exception) {
            url
        }
    }

    fun isMatch(source: String, target: String, rules: List<DomainAssocEntity> = emptyList()): Boolean {
        val s = parseUri(source)
        val t = parseUri(target)

        return when {
            s.type == UriType.WEB && t.type == UriType.WEB -> {
                val sb = s.baseDomain ?: return false
                val tb = t.baseDomain ?: return false
                sb == tb || rules.any { r -> sb in r.domains && tb in r.domains }
            }
            s.type == UriType.APP && t.type == UriType.APP -> {
                s.packageName == t.packageName
            }
            s.type == UriType.WEB && t.type == UriType.APP -> {
                crossMatch(s, t, rules)
            }
            s.type == UriType.APP && t.type == UriType.WEB -> {
                crossMatch(t, s, rules)
            }
            s.type == UriType.OTHER && t.type == UriType.OTHER -> {
                s.raw == t.raw
            }
            else -> false
        }
    }

    private fun crossMatch(web: ParsedUri, app: ParsedUri, rules: List<DomainAssocEntity>): Boolean {
        val domain = web.baseDomain ?: return false
        val pkg = app.packageName ?: return false
        return rules.any { r -> domain in r.domains && pkg in r.packageNames }
    }

    fun filterCiphersForUri(
        uriString: String,
        loginUris: List<LoginUri>,
        rules: List<DomainAssocEntity>
    ): Boolean {
        return loginUris.any { isMatch(uriString, it.uri, rules) }
    }

    data class ParsedUri(
        val type: UriType,
        val packageName: String?,
        val baseDomain: String?,
        val raw: String
    )

    enum class UriType { WEB, APP, OTHER }
}
