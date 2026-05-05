package com.pwbook.domain.model

data class Cipher(
    val id: String,
    val type: CipherType,
    val name: String,
    val notes: String?,
    val favorite: Boolean,
    val reprompt: RepromptType,
    val login: LoginData?,
    val passkey: PasskeyData?,
    val createdAt: Long,
    val modifiedAt: Long
)

enum class CipherType(val value: Int) {
    LOGIN(1),
    CARD(2),
    IDENTITY(3),
    SECURE_NOTE(4),
    PASSKEY(5)
}

enum class RepromptType(val value: Int) {
    NONE(0),
    PASSWORD(1)
}
