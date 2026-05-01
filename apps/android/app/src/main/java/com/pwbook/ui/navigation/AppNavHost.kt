package com.pwbook.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.pwbook.data.datasource.BiometricUnlockManager
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.domain.VaultSession
import com.pwbook.ui.login.LoginScreen
import com.pwbook.ui.login.RegisterScreen
import com.pwbook.ui.screens.VaultListScreen
import com.pwbook.ui.screens.VaultListViewModel
import com.pwbook.ui.screens.edit.CipherEditScreen
import com.pwbook.ui.generator.PasswordGeneratorScreen
import com.pwbook.ui.screens.scan.TotpScanScreen
import com.pwbook.ui.screens.settings.DomainAssocScreen
import com.pwbook.ui.settings.SettingsScreen
import com.pwbook.ui.unlock.UnlockScreen
import javax.inject.Inject

@Composable
fun AppNavHost(
    navController: NavHostController = rememberNavController(),
    settingsViewModel: SettingsViewModel = hiltViewModel(),
    vaultSession: VaultSession,
    autofillMode: String? = null,
    autofillUri: String? = null,
    autofillRequestId: String? = null,
    onCipherSelected: ((String) -> Unit)? = null,
    onCancel: (() -> Unit)? = null
) {
    val settingsRepository = settingsViewModel.settingsRepository
    val biometricUnlockManager = settingsViewModel.biometricUnlockManager
    val isUnlocked by vaultSession.isUnlocked.collectAsState()
    // accessToken 存储在 SecurePrefs 中，不通过 Room Flow 观察
    val hasToken = settingsRepository.getAccessToken() != null

    val startDestination = when {
        !hasToken -> NavRoutes.Login.route
        isUnlocked -> NavRoutes.VaultList.route
        else -> NavRoutes.Unlock.route
    }

    LaunchedEffect(isUnlocked) {
        if (!isUnlocked && hasToken && navController.currentDestination?.route != NavRoutes.Unlock.route) {
            navController.navigate(NavRoutes.Unlock.route) {
                popUpTo(0) { inclusive = true }
            }
        }
    }

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(NavRoutes.Login.route) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(NavRoutes.VaultList.route) {
                        popUpTo(NavRoutes.Login.route) { inclusive = true }
                    }
                },
                onNavigateToRegister = {
                    navController.navigate(NavRoutes.Register.route)
                }
            )
        }
        composable(NavRoutes.Register.route) {
            RegisterScreen(
                onRegisterSuccess = {
                    navController.navigate(NavRoutes.VaultList.route) {
                        popUpTo(NavRoutes.Register.route) { inclusive = true }
                    }
                },
                onNavigateToLogin = {
                    navController.popBackStack()
                }
            )
        }
        composable(NavRoutes.Unlock.route) {
            UnlockScreen(
                onUnlockSuccess = {
                    navController.navigate(NavRoutes.VaultList.route) {
                        popUpTo(NavRoutes.Unlock.route) { inclusive = true }
                    }
                }
            )
        }
        composable(NavRoutes.VaultList.route) {
            val viewModel = hiltViewModel<VaultListViewModel>()
            VaultListScreen(
                viewModel = viewModel,
                isAutofillMode = autofillMode != null,
                targetUri = autofillUri,
                onNavigateToEdit = { cipherId ->
                    navController.navigate(NavRoutes.CipherEdit.createRoute(cipherId))
                },
                onNavigateToGenerator = {
                    navController.navigate(NavRoutes.PasswordGenerator.route)
                },
                onNavigateToSettings = {
                    navController.navigate(NavRoutes.Settings.route)
                },
                onLock = {
                    viewModel.lock()
                    navController.navigate(NavRoutes.Unlock.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onCipherSelected = onCipherSelected,
                onCancel = onCancel
            )
        }
        composable(NavRoutes.Settings.route) {
            SettingsScreen(
                viewModel = hiltViewModel<VaultListViewModel>(),
                settingsRepository = settingsRepository,
                biometricUnlockManager = biometricUnlockManager,
                onBack = { navController.popBackStack() },
                onLogout = {
                    navController.navigate(NavRoutes.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
        composable(NavRoutes.CipherEdit.route) { backStackEntry ->
            val cipherId = backStackEntry.arguments?.getString("cipherId")
            CipherEditScreen(
                cipherId = cipherId.takeIf { it != "new" },
                viewModel = hiltViewModel(),
                onBack = { navController.popBackStack() }
            )
        }
        composable(NavRoutes.PasswordGenerator.route) {
            PasswordGeneratorScreen(
                viewModel = hiltViewModel(),
                onBack = { navController.popBackStack() }
            )
        }
        composable(NavRoutes.DomainAssoc.route) {
            DomainAssocScreen(
                onBack = { navController.popBackStack() }
            )
        }
        composable(NavRoutes.TotpScan.route) {
            TotpScanScreen(
                onBack = { navController.popBackStack() },
                onTotpScanned = { secret, account, issuer ->
                    navController.popBackStack()
                }
            )
        }
    }
}