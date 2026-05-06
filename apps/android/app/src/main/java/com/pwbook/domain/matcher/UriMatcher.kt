package com.pwbook.domain.matcher

import com.pwbook.data.local.entity.DomainAssocEntity
import com.pwbook.domain.model.LoginUri
import com.pwbook.domain.model.UriMatchType

object UriMatcher {

    // 多段顶级域后缀（简化版 PSL）
    // 必须与 packages/shared-types/src/multi-segment-tlds.ts 保持一致，
    // 避免同一 URL 在 Edge 与 Android 上解析出不同的 baseDomain。
    private val MULTI_SEGMENT_TLDS = setOf(
        // 中国大陆
        "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
        // 英国
        "co.uk", "org.uk", "ac.uk", "gov.uk", "ltd.uk",
        // 日本
        "co.jp", "ne.jp", "or.jp", "ac.jp",
        // 中国香港
        "com.hk", "org.hk", "edu.hk", "gov.hk",
        // 中国台湾
        "com.tw", "org.tw", "edu.tw", "gov.tw",
        // 澳大利亚
        "com.au", "net.au", "org.au", "edu.au",
        // 韩国
        "co.kr", "or.kr",
        // 新加坡
        "com.sg", "edu.sg", "gov.sg",
        // 巴西
        "com.br",
        // 墨西哥
        "com.mx",
        // 南非
        "co.za",
        // 印度
        "co.in",
        // 阿根廷
        "com.ar",
        // 土耳其
        "com.tr",
        // 乌克兰
        "com.ua",
        // 马来西亚
        "com.my",
        // 越南
        "com.vn",
        // 印度尼西亚
        "co.id",
        // 菲律宾
        "com.ph",
        // 泰国
        "com.th",
        // 新西兰
        "co.nz",
        // 波兰
        "com.pl",
        // 俄罗斯
        "com.ru",
        // 公共平台托管域名（PSL 规则）
        "github.io",
        "gitlab.io",
        "gitee.io",
        "vercel.app",
        "netlify.app",
        "pages.dev",
        "fly.dev",
        "railway.app",
        "herokuapp.com",
        "firebaseapp.com",
        "web.app",
        "azurewebsites.net",
        "cloudfront.net",
        "amazonaws.com",
        "workers.dev",
        "blogspot.com",
        "wordpress.com",
        "glitch.me",
        "repl.co",
        "codeberg.page",
        "render.com",
        "surge.sh"
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
