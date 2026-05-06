package com.pwbook.data.remote.websocket

import com.pwbook.data.datasource.SecurePrefs
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.min

@Singleton
class SyncWebSocketClient @Inject constructor(
    private val client: HttpClient,
    private val securePrefs: SecurePrefs,
    private val json: Json
) {

    interface Listener {
        fun onSyncRequired()
        fun onDisconnected()
        fun onConnected()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var reconnectJob: Job? = null
    private var pingJob: Job? = null
    private var session: io.ktor.websocket.WebSocketSession? = null
    private val listeners = mutableListOf<Listener>()
    private var reconnectAttempt = 0
    private val maxReconnectDelayMs = 300_000L // 5 minutes
    private val maxReconnectAttempt = 8         // 1000ms shl 8 = 256s，配合上限 300s 后趋于稳定

    @Volatile
    private var isRunning = false

    @Volatile
    private var isAuthenticated = false

    fun addListener(listener: Listener) {
        listeners.add(listener)
    }

    fun removeListener(listener: Listener) {
        listeners.remove(listener)
    }

    fun start() {
        if (isRunning) return
        isRunning = true
        reconnectAttempt = 0
        connect()
    }

    fun stop() {
        isRunning = false
        isAuthenticated = false
        reconnectJob?.cancel()
        pingJob?.cancel()
        scope.launch {
            try {
                session?.incoming?.cancel()
            } catch (_: Exception) {
            }
            session = null
        }
    }

    private fun connect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val token = securePrefs.getString(SecurePrefs.KEY_ACCESS_TOKEN)
            if (token == null) {
                Timber.w("WebSocket: no access token, skipping connection")
                return@launch
            }
            try {
                // 从用户配置读取服务器地址，强制使用 wss://
                val serverUrl = securePrefs.getString(SecurePrefs.KEY_SERVER_URL)
                    ?: "https://10.0.2.2:3000/"
                val wsBaseUrl = serverUrl
                    .replace("http://", "ws://")
                    .replace("https://", "wss://")
                    .removeSuffix("/")
                val wsUrl = "$wsBaseUrl/ws"
                session = client.webSocketSession(wsUrl)
                isAuthenticated = false

                // 连接成功后发送认证消息
                session?.outgoing?.send(Frame.Text("""{"type":"AUTH","token":"$token"}"""))

                receiveMessages()
            } catch (e: Exception) {
                Timber.e(e, "WebSocket connection failed")
                listeners.forEach { it.onDisconnected() }
                scheduleReconnect()
            }
        }
    }

    private suspend fun receiveMessages() {
        val currentSession = session ?: return
        try {
            for (frame in currentSession.incoming) {
                if (frame is Frame.Text) {
                    handleMessage(frame.readText())
                }
            }
        } catch (e: Exception) {
            if (currentCoroutineContext().isActive) {
                Timber.e(e, "WebSocket receive error")
                listeners.forEach { it.onDisconnected() }
                scheduleReconnect()
            }
        }
    }

    private fun handleMessage(text: String) {
        try {
            val message = json.decodeFromString(WsMessage.serializer(), text)
            when (message.type) {
                "AUTH_SUCCESS" -> {
                    isAuthenticated = true
                    reconnectAttempt = 0
                    listeners.forEach { it.onConnected() }
                    Timber.i("WebSocket authenticated")
                    startPing()
                }
                "AUTH_FAILED", "AUTH_REQUIRED" -> {
                    Timber.w("WebSocket authentication failed")
                    isAuthenticated = false
                    listeners.forEach { it.onDisconnected() }
                    scheduleReconnect()
                }
                "SYNC_REQUIRED" -> {
                    if (isAuthenticated) {
                        Timber.i("WebSocket: SYNC_REQUIRED received")
                        listeners.forEach { it.onSyncRequired() }
                    }
                }
                "PONG" -> Timber.d("WebSocket: PONG")
                "DEVICE_LOGOUT" -> Timber.w("WebSocket: DEVICE_LOGOUT received")
                else -> Timber.d("WebSocket unknown message: $text")
            }
        } catch (e: Exception) {
            Timber.e(e, "WebSocket message parse error: $text")
        }
    }

    private fun startPing() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (isActive && isRunning && isAuthenticated) {
                delay(30_000)
                try {
                    session?.outgoing?.send(Frame.Text("""{"type":"PING"}"""))
                } catch (_: Exception) {
                    break
                }
            }
        }
    }

    private fun scheduleReconnect() {
        if (!isRunning) return
        reconnectJob?.cancel()
        // 限制 reconnectAttempt 上限，避免 Int 左移溢出导致负数延迟或重连风暴
        reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(maxReconnectAttempt)
        val delayMs = min(1000L shl reconnectAttempt, maxReconnectDelayMs)
        Timber.i("WebSocket reconnecting in ${delayMs}ms (attempt $reconnectAttempt)")
        reconnectJob = scope.launch {
            delay(delayMs)
            connect()
        }
    }
}

@Serializable
data class WsMessage(
    val type: String,
    val timestamp: String? = null,
    val reason: String? = null
)
