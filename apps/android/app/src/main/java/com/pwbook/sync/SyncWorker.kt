package com.pwbook.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.WorkInfo
import com.pwbook.Constants
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.map
import timber.log.Timber
import java.util.concurrent.TimeUnit

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val syncManager: SyncManager
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            Timber.i("SyncWorker: starting background sync")
            val result = syncManager.syncAll()
            if (result.isSuccess) {
                Timber.i("SyncWorker: sync completed successfully")
                Result.success()
            } else {
                Timber.w("SyncWorker: sync failed, will retry")
                Result.retry()
            }
        } catch (e: Exception) {
            Timber.e(e, "SyncWorker: unexpected error")
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "pwbook_sync_worker"
        private val SYNC_INTERVAL_MINUTES = Constants.SYNC_INTERVAL_MINUTES

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = PeriodicWorkRequestBuilder<SyncWorker>(
                SYNC_INTERVAL_MINUTES,
                TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .addTag(WORK_NAME)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request
                )

            Timber.i("SyncWorker scheduled every $SYNC_INTERVAL_MINUTES minutes")
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }

        fun observeState(context: Context): Flow<Boolean> {
            return WorkManager.getInstance(context)
                .getWorkInfosForUniqueWorkLiveData(WORK_NAME)
                .asFlow()
                .map { infos ->
                    infos.any { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED }
                }
        }

        private const val IMMEDIATE_WORK_NAME = "pwbook_sync_worker_immediate"

        fun triggerImmediate(context: Context) {
            val request = androidx.work.OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .addTag("immediate_sync")
                .build()
            // 使用唯一工作名 + KEEP：已在排队/运行中的同步会被复用，避免并发触发多个 Worker
            WorkManager.getInstance(context)
                .enqueueUniqueWork(IMMEDIATE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }

        private fun <T> androidx.lifecycle.LiveData<T>.asFlow(): kotlinx.coroutines.flow.Flow<T> {
            return kotlinx.coroutines.flow.callbackFlow {
                val observer = androidx.lifecycle.Observer<T> { trySend(it) }
                observeForever(observer)
                awaitClose { removeObserver(observer) }
            }
        }
    }
}
