package com.pwbook.di

import android.content.Context
import androidx.room.Room
import com.pwbook.data.local.AppDatabase
import com.pwbook.data.local.dao.CipherDao
import com.pwbook.data.local.dao.DomainAssocDao
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
            .fallbackToDestructiveMigration()
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
}
