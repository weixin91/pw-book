package com.pwbook.di

import android.content.Context
import android.util.Base64
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.pwbook.data.datasource.SecurePrefs
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
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.security.SecureRandom
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    private const val DB_NAME = "pwbook.db"
    private const val PASSPHRASE_BYTES = 32

    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context,
        securePrefs: SecurePrefs
    ): AppDatabase {
        val passphrase = getOrCreateDbPassphrase(securePrefs)
        // 若设备上已存在 v3 之前未加密的数据库，使用 SQLCipher 打开会失败；
        // 此时回退到销毁式重建，本地数据丢失但服务端会重新拉取（cipher 数据本身已用主密钥加密）。
        val unencryptedDb = context.getDatabasePath(DB_NAME)
        if (unencryptedDb.exists() && !isCipherDatabase(unencryptedDb.absolutePath, passphrase)) {
            unencryptedDb.delete()
            // 删除可能存在的 -journal/-wal/-shm 副文件
            java.io.File("${unencryptedDb.absolutePath}-journal").delete()
            java.io.File("${unencryptedDb.absolutePath}-wal").delete()
            java.io.File("${unencryptedDb.absolutePath}-shm").delete()
        }
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            DB_NAME
        )
            .openHelperFactory(SupportOpenHelperFactory(passphrase))
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
            .build()
    }

    /** 检查路径下的 SQLite 文件是否能被给定密钥解开（即是否已经是 SQLCipher 库） */
    private fun isCipherDatabase(path: String, passphrase: ByteArray): Boolean {
        return try {
            net.zetetic.database.sqlcipher.SQLiteDatabase.openDatabase(
                path,
                passphrase,
                null,
                net.zetetic.database.sqlcipher.SQLiteDatabase.OPEN_READONLY,
                null
            ).use { true }
        } catch (_: Throwable) {
            false
        }
    }

    private fun getOrCreateDbPassphrase(securePrefs: SecurePrefs): ByteArray {
        val existing = securePrefs.getString(SecurePrefs.KEY_DB_PASSPHRASE)
        if (existing != null) {
            return Base64.decode(existing, Base64.NO_WRAP)
        }
        val passphrase = ByteArray(PASSPHRASE_BYTES).apply { SecureRandom().nextBytes(this) }
        securePrefs.putString(
            SecurePrefs.KEY_DB_PASSPHRASE,
            Base64.encodeToString(passphrase, Base64.NO_WRAP)
        )
        return passphrase
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

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // v1 → v2: 为热点查询补充 Room 生成的索引
        db.execSQL("CREATE INDEX IF NOT EXISTS index_cipher_userId_modifiedAt ON cipher(userId, modifiedAt)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_cipher_userId ON cipher(userId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_domain_association_userId ON domain_association(userId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_sync_queue_cipherId ON sync_queue(cipherId)")
    }
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
