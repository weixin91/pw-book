package com.pwbook.ui.navigation

import androidx.compose.runtime.Composable
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.pwbook.data.repository.SettingsRepository
import com.pwbook.ui.login.LoginScreen
import com.pwbook.ui.login.RegisterScreen
import com.pwbook.ui.screens.VaultListScreen
import com.pwbook.ui.screens.VaultListViewModel
import com.pwbook.ui.screens.edit.CipherEditScreen
import com.pwbook.ui.generator.PasswordGeneratorScreen
import com.pwbook.ui.settings.SettingsScreen
import com.pwbook.ui.unlock.UnlockScreen

@Composable
fun AppNavHost(
    navController: NavHostController = rememberNavController(),
    settingsViewModel: SettingsViewModel = hiltViewModel()
) {
    val settingsRepository = settingsViewModel.settingsRepository
    // accessToken 存储在 SecurePrefs 中，不通过 Room Flow 观察
    val hasToken = settingsRepository.getAccessToken() != null

    val startDestination = if (hasToken) NavRoutes.Unlock.route else NavRoutes.Login.route

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(NavRoutes.Login.route) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(NavRoutes.Unlock.route) {
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
                    navController.navigate(NavRoutes.Unlock.route) {
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
            VaultListScreen(
                viewModel = hiltViewModel(),
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
                    navController.navigate(NavRoutes.Unlock.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
        composable(NavRoutes.Settings.route) {
            SettingsScreen(
                viewModel = hiltViewModel<VaultListViewModel>(),
                settingsRepository = settingsRepository,
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
    }
}