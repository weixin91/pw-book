package com.pwbook.di

import com.pwbook.BuildConfig
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.remote.api.AuthApi
import com.pwbook.data.remote.api.CipherApi
import com.pwbook.data.remote.api.DeviceApi
import com.pwbook.data.remote.api.DomainAssocApi
import com.pwbook.data.remote.api.SyncApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.bearer
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Provides
    @Singleton
    fun provideHttpClient(json: Json, securePrefs: SecurePrefs): HttpClient {
        return HttpClient(Android) {
            install(ContentNegotiation) { json(json) }
            // 仅在 DEBUG 模式下启用详细日志，生产环境关闭以防止敏感信息泄露
            install(Logging) {
                level = if (BuildConfig.DEBUG) LogLevel.BODY else LogLevel.NONE
            }
            install(WebSockets)
            install(Auth) {
                bearer {
                    loadTokens {
                        val accessToken = securePrefs.getString(SecurePrefs.KEY_ACCESS_TOKEN)
                        val refreshToken = securePrefs.getString(SecurePrefs.KEY_REFRESH_TOKEN)
                        if (accessToken != null && refreshToken != null) {
                            BearerTokens(accessToken, refreshToken)
                        } else null
                    }
                    refreshTokens {
                        val currentRefresh = oldTokens?.refreshToken
                            ?: securePrefs.getString(SecurePrefs.KEY_REFRESH_TOKEN)
                            ?: return@refreshTokens null
                        try {
                            val authApi = AuthApi(client)
                            val response = authApi.refresh(currentRefresh)
                            securePrefs.putString(SecurePrefs.KEY_ACCESS_TOKEN, response.token)
                            securePrefs.putString(SecurePrefs.KEY_REFRESH_TOKEN, response.refreshToken)
                            BearerTokens(response.token, response.refreshToken)
                        } catch (_: Exception) {
                            securePrefs.putString(SecurePrefs.KEY_ACCESS_TOKEN, null)
                            securePrefs.putString(SecurePrefs.KEY_REFRESH_TOKEN, null)
                            null
                        }
                    }
                }
            }
            defaultRequest {
                val serverUrl = securePrefs.getString(SecurePrefs.KEY_SERVER_URL)
                    ?: "http://10.0.2.2:3000/"
                url(serverUrl)
                headers.append("Content-Type", "application/json")
            }
            engine {
                connectTimeout = 30_000
                socketTimeout = 30_000
            }
        }
    }

    @Provides
    @Singleton
    fun provideAuthApi(client: HttpClient): AuthApi = AuthApi(client)

    @Provides
    @Singleton
    fun provideSyncApi(client: HttpClient): SyncApi = SyncApi(client)

    @Provides
    @Singleton
    fun provideCipherApi(client: HttpClient): CipherApi = CipherApi(client)

    @Provides
    @Singleton
    fun provideDomainAssocApi(client: HttpClient): DomainAssocApi = DomainAssocApi(client)

    @Provides
    @Singleton
    fun provideDeviceApi(client: HttpClient): DeviceApi = DeviceApi(client)
}
