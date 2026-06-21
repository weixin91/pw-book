package com.pwbook.service.autofill

import android.text.InputType
import android.view.autofill.AutofillId
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class StructureParserTest {

    private fun field(
        autofillHints: List<String> = emptyList(),
        htmlInfo: String? = null,
        htmlAttributes: Map<String, String> = emptyMap(),
        inputType: Int = InputType.TYPE_CLASS_TEXT,
        className: String? = null,
        textValue: String? = null,
        index: Int = 0
    ): AutofillField {
        return AutofillField(
            id = mockk<AutofillId>(relaxed = true),
            autofillHints = autofillHints,
            htmlInfo = htmlInfo,
            htmlAttributes = htmlAttributes,
            inputType = inputType,
            className = className,
            textValue = textValue,
            index = index
        )
    }

    @Test
    fun `搜索框单独存在时不识别为用户名`() {
        val fields = listOf(
            field(htmlAttributes = mapOf("type" to "text", "id" to "q"), index = 0)
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNull(username)
        assertNull(password)
    }

    @Test
    fun `评论框单独存在时不识别为用户名`() {
        val fields = listOf(
            field(htmlAttributes = mapOf("type" to "text", "id" to "comment"), index = 0)
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNull(username)
        assertNull(password)
    }

    @Test
    fun `标准用户名密码登录页正确识别`() {
        val fields = listOf(
            field(
                htmlAttributes = mapOf("type" to "text", "id" to "username"),
                index = 0
            ),
            field(
                htmlAttributes = mapOf("type" to "password", "id" to "password"),
                inputType = InputType.TYPE_TEXT_VARIATION_PASSWORD,
                index = 1
            )
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNotNull(username)
        assertNotNull(password)
        assertEquals("username", username?.htmlAttributes?.get("id"))
        assertEquals("password", password?.htmlAttributes?.get("id"))
    }

    @Test
    fun `仅邮箱字段时识别为用户名`() {
        val fields = listOf(
            field(htmlAttributes = mapOf("type" to "email", "id" to "email"), index = 0)
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNotNull(username)
        assertNull(password)
        assertEquals("email", username?.htmlAttributes?.get("id"))
    }

    @Test
    fun `无强用户名信号但存在密码时取密码前最近文本框`() {
        val fields = listOf(
            field(
                htmlAttributes = mapOf("type" to "text", "id" to "field1"),
                index = 0
            ),
            field(
                htmlAttributes = mapOf("type" to "password", "id" to "password"),
                inputType = InputType.TYPE_TEXT_VARIATION_PASSWORD,
                index = 1
            )
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNotNull(username)
        assertNotNull(password)
        assertEquals("field1", username?.htmlAttributes?.get("id"))
    }

    @Test
    fun `命中否定词的字段不参与识别`() {
        val fields = listOf(
            field(
                htmlAttributes = mapOf("type" to "text", "id" to "search-user"),
                index = 0
            ),
            field(
                htmlAttributes = mapOf("type" to "password", "id" to "password"),
                inputType = InputType.TYPE_TEXT_VARIATION_PASSWORD,
                index = 1
            )
        )
        val (username, password) = StructureParser.detectFields(fields)
        assertNull(username)
        assertNotNull(password)
    }
}
