package com.pwbook.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.pwbook.data.local.dao.CipherDao
import com.pwbook.data.local.dao.DomainAssocDao
import com.pwbook.data.local.dao.RejectedSiteDao
import com.pwbook.data.local.dao.SettingDao
import com.pwbook.data.local.dao.SyncQueueDao
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.local.entity.DomainAssocEntity
import com.pwbook.data.local.entity.RejectedSiteEntity
import com.pwbook.data.local.entity.SettingEntity
import com.pwbook.data.local.entity.SyncQueueEntity

@Database(
    entities = [
        CipherEntity::class,
        DomainAssocEntity::class,
        SyncQueueEntity::class,
        SettingEntity::class,
        RejectedSiteEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun cipherDao(): CipherDao
    abstract fun domainAssocDao(): DomainAssocDao
    abstract fun syncQueueDao(): SyncQueueDao
    abstract fun settingDao(): SettingDao
    abstract fun rejectedSiteDao(): RejectedSiteDao
}
