package com.pwbook.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.WorkInfo
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
        private const val SYNC_INTERVAL_MINUTES = 15L

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

        fun triggerImmediate(context: Context) {
            val request = androidx.work.OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .addTag("immediate_sync")
                .build()
            WorkManager.getInstance(context).enqueue(request)
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
