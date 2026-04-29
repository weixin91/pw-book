package com.pwbook

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import org.bouncycastle.jce.provider.BouncyCastleProvider
import timber.log.Timber
import java.security.Security

@HiltAndroidApp
class PwBookApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // 注册 BouncyCastle Provider 以支持 Argon2
        Security.addProvider(BouncyCastleProvider())
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
    }
}