package com.pwbook.ui.navigation

sealed class NavRoutes(val route: String) {
    data object Login : NavRoutes("login")
    data object Register : NavRoutes("register")
    data object Unlock : NavRoutes("unlock")
    data object VaultList : NavRoutes("vault_list")
    data object Settings : NavRoutes("settings")
    data object CipherEdit : NavRoutes("cipher_edit/{cipherId}") {
        fun createRoute(cipherId: String? = null) =
            "cipher_edit/${cipherId ?: "new"}"
    }
    data object PasswordGenerator : NavRoutes("password_generator")
    data object DomainAssoc : NavRoutes("domain_assoc")
    data object TotpScan : NavRoutes("totp_scan")
}