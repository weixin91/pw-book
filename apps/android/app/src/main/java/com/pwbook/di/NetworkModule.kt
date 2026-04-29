package com.pwbook.di

import com.pwbook.data.remote.api.AuthApi
import com.pwbook.data.remote.api.CipherApi
import com.pwbook.data.remote.api.DomainAssocApi
import com.pwbook.data.remote.api.SyncApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
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
    fun provideHttpClient(json: Json): HttpClient {
        return HttpClient(Android) {
            install(ContentNegotiation) { json(json) }
            install(Logging) { level = LogLevel.BODY }
            install(WebSockets)
            defaultRequest {
                url("http://localhost:3000/")
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
}
