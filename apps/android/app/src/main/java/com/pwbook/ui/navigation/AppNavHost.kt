package com.pwbook.ui.navigation

import androidx.compose.runtime.Composable
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.pwbook.ui.screens.VaultListScreen
import com.pwbook.ui.screens.edit.CipherEditScreen
import com.pwbook.ui.generator.PasswordGeneratorScreen
import com.pwbook.ui.unlock.UnlockScreen

@Composable
fun AppNavHost(
    navController: NavHostController = rememberNavController()
) {
    NavHost(
        navController = navController,
        startDestination = NavRoutes.Unlock.route
    ) {
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
                onLock = {
                    navController.navigate(NavRoutes.Unlock.route) {
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
