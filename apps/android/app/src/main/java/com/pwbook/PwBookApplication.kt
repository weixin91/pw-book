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
        // 加载 SQLCipher 原生库（必须在打开任何加密 Room 数据库之前调用）
        // sqlcipher-android 4.6+ 已移除 SQLiteDatabase.loadLibs() 静态方法，改用 System.loadLibrary
        System.loadLibrary("sqlcipher")
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
    }
}