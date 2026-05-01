package com.pwbook.di

import android.content.Context
import androidx.biometric.BiometricManager
import com.pwbook.data.datasource.AutoLockManager
import com.pwbook.data.datasource.BiometricUnlockManager
import com.pwbook.data.datasource.KeystoreManager
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.domain.VaultSession
import com.pwbook.service.credential.PasskeyCreateHandler
import com.pwbook.service.credential.PasskeyGetHandler
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object ServiceModule {

    @Provides
    @Singleton
    fun provideSecurePrefs(@ApplicationContext context: Context): SecurePrefs = SecurePrefs(context)

    @Provides
    @Singleton
    fun provideKeystoreManager(): KeystoreManager = KeystoreManager()

    @Provides
    @Singleton
    fun provideBiometricManager(@ApplicationContext context: Context): BiometricManager =
        BiometricManager.from(context)

    @Provides
    @Singleton
    fun provideBiometricUnlockManager(
        @ApplicationContext context: Context,
        biometricManager: BiometricManager,
        keystoreManager: KeystoreManager,
        securePrefs: SecurePrefs,
        vaultSession: VaultSession
    ): BiometricUnlockManager = BiometricUnlockManager(
        context = context,
        biometricManager = biometricManager,
        keystoreManager = keystoreManager,
        securePrefs = securePrefs,
        vaultSession = vaultSession
    )

    @Provides
    @Singleton
    fun provideAutoLockManager(
        @ApplicationContext context: Context,
        vaultSession: VaultSession,
        securePrefs: SecurePrefs
    ): AutoLockManager = AutoLockManager(context, vaultSession, securePrefs)
}
