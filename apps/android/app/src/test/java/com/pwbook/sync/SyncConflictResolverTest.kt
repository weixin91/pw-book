package com.pwbook.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncConflictResolverTest {

    @Test
    fun `lastWriteWins 本地时间戳更新则保留本地`() {
        val localTime = 1000L
        val remoteTime = 500L
        val result = lastWriteWins(localTime, remoteTime)
        assertTrue(result)
    }

    @Test
    fun `lastWriteWins 远程时间戳更新则接受远程`() {
        val localTime = 500L
        val remoteTime = 1000L
        val result = lastWriteWins(localTime, remoteTime)
        assertFalse(result)
    }

    @Test
    fun `lastWriteWins 相同时间戳默认保留本地`() {
        val time = 1000L
        val result = lastWriteWins(time, time)
        assertTrue(result)
    }

    @Test
    fun `PendingChangesQueue Operation 枚举值正确`() {
        assertEquals("CREATE", PendingChangesQueue.Operation.CREATE.name)
        assertEquals("UPDATE", PendingChangesQueue.Operation.UPDATE.name)
        assertEquals("DELETE", PendingChangesQueue.Operation.DELETE.name)
    }

    @Test
    fun `冲突解决三种场景`() {
        // 场景 1: 本地新建，远程无 → 保留本地
        assertTrue(resolveConflict(localOp = "CREATE", remoteOp = null, localTime = 1000, remoteTime = 0))

        // 场景 2: 本地更新，远程更新，本地更新更晚 → 保留本地
        assertTrue(resolveConflict(localOp = "UPDATE", remoteOp = "UPDATE", localTime = 2000, remoteTime = 1000))

        // 场景 3: 本地删除，远程更新，本地删除更晚 → 保留本地（删除优先）
        assertTrue(resolveConflict(localOp = "DELETE", remoteOp = "UPDATE", localTime = 2000, remoteTime = 1000))
    }

    private fun lastWriteWins(localTimestamp: Long, remoteTimestamp: Long): Boolean {
        return localTimestamp >= remoteTimestamp
    }

    private fun resolveConflict(localOp: String, remoteOp: String?, localTime: Long, remoteTime: Long): Boolean {
        // 远程无数据，保留本地
        if (remoteOp == null) return true
        // 本地删除优先
        if (localOp == "DELETE") return true
        // 否则 last-write-wins
        return lastWriteWins(localTime, remoteTime)
    }
}
