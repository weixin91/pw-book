package com.pwbook.domain.matcher

import com.pwbook.data.local.entity.DomainAssocEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UriMatcherTest {

    @Test
    fun `getBaseDomain 提取基础域名`() {
        assertEquals("example.com", UriMatcher.getBaseDomain("www.example.com"))
        assertEquals("example.com", UriMatcher.getBaseDomain("example.com"))
        assertEquals("baidu.com", UriMatcher.getBaseDomain("tieba.baidu.com"))
        assertEquals("example.co.uk", UriMatcher.getBaseDomain("www.example.co.uk"))
        assertEquals("example.co.jp", UriMatcher.getBaseDomain("www.example.co.jp"))
        assertEquals("192.168.1.1", UriMatcher.getBaseDomain("192.168.1.1"))
        assertEquals("", UriMatcher.getBaseDomain(""))
    }

    @Test
    fun `parseUri 解析 Web URI`() {
        val parsed = UriMatcher.parseUri("https://www.example.com/login")
        assertEquals(UriMatcher.UriType.WEB, parsed.type)
        assertEquals("example.com", parsed.baseDomain)
    }

    @Test
    fun `parseUri 解析 App URI`() {
        val parsed = UriMatcher.parseUri("androidapp://com.example.app")
        assertEquals(UriMatcher.UriType.APP, parsed.type)
        assertEquals("com.example.app", parsed.packageName)
    }

    @Test
    fun `isMatch 同域名匹配`() {
        assertTrue(UriMatcher.isMatch("https://www.baidu.com", "https://tieba.baidu.com"))
        assertTrue(UriMatcher.isMatch("https://a.example.com", "https://b.example.com"))
    }

    @Test
    fun `isMatch 不同域名不匹配`() {
        assertFalse(UriMatcher.isMatch("https://example.com", "https://other.com"))
    }

    @Test
    fun `isMatch 相同包名匹配`() {
        assertTrue(UriMatcher.isMatch(
            "androidapp://com.example.app",
            "androidapp://com.example.app"
        ))
    }

    @Test
    fun `isMatch 域名关联规则跨匹配`() {
        val rules = listOf(
            DomainAssocEntity(
                id = "1",
                userId = "u1",
                domains = "[\"example.com\"]",
                packageNames = "[\"com.example.app\"]",
                createdAt = 0
            )
        )
        assertTrue(UriMatcher.isMatch(
            "https://www.example.com",
            "androidapp://com.example.app",
            rules
        ))
    }

    @Test
    fun `isMatch 无规则时跨类型不匹配`() {
        assertFalse(UriMatcher.isMatch(
            "https://www.example.com",
            "androidapp://com.example.app"
        ))
    }

    @Test
    fun `filterCiphersForUri 域名关联生效`() {
        val rules = listOf(
            DomainAssocEntity(
                id = "1",
                userId = "u1",
                domains = "[\"baidu.com\"]",
                packageNames = "[\"com.baidu.tieba\"]",
                createdAt = 0
            )
        )
        val loginUris = listOf(
            com.pwbook.domain.model.LoginUri("https://tieba.baidu.com", null)
        )
        assertTrue(UriMatcher.filterCiphersForUri(
            "androidapp://com.baidu.tieba",
            loginUris,
            rules
        ))
    }
}
