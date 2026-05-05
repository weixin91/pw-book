package com.pwbook.di

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.pwbook.data.local.AppDatabase
import com.pwbook.data.local.dao.CipherDao
import com.pwbook.data.local.dao.CipherIndexDao
import com.pwbook.data.local.dao.DomainAssocDao
import com.pwbook.data.local.dao.PendingRebuildDao
import com.pwbook.data.local.dao.SettingDao
import com.pwbook.data.local.dao.SyncQueueDao
import com.pwbook.data.local.dao.RejectedSiteDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "pwbook.db"
        )
            .addMigrations(MIGRATION_2_3)
            .build()
    }

    @Provides
    fun provideCipherDao(db: AppDatabase): CipherDao = db.cipherDao()

    @Provides
    fun provideDomainAssocDao(db: AppDatabase): DomainAssocDao = db.domainAssocDao()

    @Provides
    fun provideSyncQueueDao(db: AppDatabase): SyncQueueDao = db.syncQueueDao()

    @Provides
    fun provideSettingDao(db: AppDatabase): SettingDao = db.settingDao()

    @Provides
    fun provideRejectedSiteDao(db: AppDatabase): RejectedSiteDao = db.rejectedSiteDao()

    @Provides
    fun provideCipherIndexDao(db: AppDatabase): CipherIndexDao = db.cipherIndexDao()

    @Provides
    fun providePendingRebuildDao(db: AppDatabase): PendingRebuildDao = db.pendingRebuildDao()
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS cipher_index (
                cipherId TEXT PRIMARY KEY NOT NULL,
                userId TEXT NOT NULL,
                domainsJson TEXT NOT NULL,
                rpIdsJson TEXT NOT NULL,
                hasLogin INTEGER NOT NULL,
                hasPasskey INTEGER NOT NULL
            )
        """)
        db.execSQL("CREATE INDEX IF NOT EXISTS index_cipher_index_userId ON cipher_index(userId)")
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS pending_rebuild (
                cipherId TEXT PRIMARY KEY NOT NULL,
                userId TEXT NOT NULL
            )
        """)
        db.execSQL("CREATE INDEX IF NOT EXISTS index_pending_rebuild_userId ON pending_rebuild(userId)")
    }
}
