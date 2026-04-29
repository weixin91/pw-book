package com.pwbook.data.remote.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import javax.inject.Inject

class DeviceApi @Inject constructor(private val client: HttpClient) {

    suspend fun getDevices(): DevicesResponse {
        return client.get("api/devices").body()
    }

    suspend fun deleteDevice(id: String) {
        client.delete("api/devices/$id")
    }
}

@kotlinx.serialization.Serializable
data class DevicesResponse(
    val data: List<DeviceDto>
)

@kotlinx.serialization.Serializable
data class DeviceDto(
    val id: String,
    val deviceId: String,
    val deviceType: String,
    val deviceName: String,
    val lastSyncAt: Long? = null,
    val createdAt: Long
)
