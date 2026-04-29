package com.pwbook.domain.model

data class LoginData(
    val username: String?,
    val password: String?,
    val uris: List<LoginUri>,
    val totp: String?
)

data class LoginUri(
    val uri: String,
    val match: UriMatchType?
)

enum class UriMatchType(val value: Int) {
    DOMAIN(0),
    HOST(1),
    STARTS_WITH(2),
    EXACT(3),
    REGULAR_EXPRESSION(4),
    NEVER(5)
}
