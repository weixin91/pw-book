package com.pwbook.di

import com.pwbook.crypto.AesGcmEngine
import com.pwbook.crypto.KdfEngine
import com.pwbook.crypto.KeyDerivation
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object CryptoModule {

    @Provides
    @Singleton
    fun provideKdfEngine(): KdfEngine = KdfEngine()

    @Provides
    @Singleton
    fun provideAesGcmEngine(): AesGcmEngine = AesGcmEngine()

    @Provides
    @Singleton
    fun provideKeyDerivation(kdfEngine: KdfEngine): KeyDerivation = KeyDerivation(kdfEngine)
}
