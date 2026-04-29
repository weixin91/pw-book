package com.pwbook.data.repository

import com.pwbook.data.local.dao.RejectedSiteDao
import com.pwbook.data.local.entity.RejectedSiteEntity
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RejectedSiteRepository @Inject constructor(
    private val rejectedSiteDao: RejectedSiteDao
) {

    suspend fun isRejected(userId: String, domain: String): Boolean {
        val record = rejectedSiteDao.get(userId, domain)
        return record != null && System.currentTimeMillis() < record.expireAt
    }

    suspend fun addRejected(userId: String, domain: String, durationDays: Int = 30) {
        val now = System.currentTimeMillis()
        val entity = RejectedSiteEntity(
            id = UUID.randomUUID().toString(),
            userId = userId,
            domain = domain,
            rejectedAt = now,
            expireAt = now + durationDays * 24 * 60 * 60 * 1000L
        )
        rejectedSiteDao.insert(entity)
    }

    suspend fun clearExpired() {
        rejectedSiteDao.deleteExpired(System.currentTimeMillis())
    }

    suspend fun removeRejected(userId: String, domain: String) {
        rejectedSiteDao.delete(userId, domain)
    }
}
