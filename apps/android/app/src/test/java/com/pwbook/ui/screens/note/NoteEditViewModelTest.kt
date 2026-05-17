package com.pwbook.ui.screens.note

import com.pwbook.crypto.VaultEncryption
import com.pwbook.data.datasource.SecurePrefs
import com.pwbook.data.local.entity.CipherEntity
import com.pwbook.data.repository.CipherRepository
import com.pwbook.domain.VaultSession
import com.pwbook.sync.PendingChangesQueue
import com.pwbook.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@ExperimentalCoroutinesApi
class NoteEditViewModelTest {

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var cipherRepository: CipherRepository
    private lateinit var vaultSession: VaultSession
    private lateinit var vaultEncryption: VaultEncryption
    private lateinit var pendingChangesQueue: PendingChangesQueue
    private lateinit var securePrefs: SecurePrefs
    private lateinit var syncManager: SyncManager
    private lateinit var viewModel: NoteEditViewModel

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        cipherRepository = mockk(relaxed = true)
        vaultSession = mockk(relaxed = true)
        vaultEncryption = mockk(relaxed = true)
        pendingChangesQueue = mockk(relaxed = true)
        securePrefs = mockk(relaxed = true)
        syncManager = mockk(relaxed = true)

        every { vaultSession.getUserKey() } returns ByteArray(64) { it.toByte() }
        every { vaultEncryption.encryptString(any(), any()) } returns "encrypted"
        every { securePrefs.getString(SecurePrefs.KEY_USER_ID) } returns "user-1"

        viewModel = NoteEditViewModel(
            cipherRepository,
            vaultSession,
            vaultEncryption,
            pendingChangesQueue,
            securePrefs,
            syncManager,
            Json { ignoreUnknownKeys = true }
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `初始状态应为新建模式`() {
        val state = viewModel.uiState.value
        assertTrue(state.isNew)
        assertEquals("", state.name)
        assertEquals("", state.notes)
    }

    @Test
    fun `更新标题后状态同步`() {
        viewModel.updateName("测试笔记")
        assertEquals("测试笔记", viewModel.uiState.value.name)
    }

    @Test
    fun `更新内容后状态同步`() {
        viewModel.updateNotes("笔记正文")
        assertEquals("笔记正文", viewModel.uiState.value.notes)
    }

    @Test
    fun `保存新建笔记时调用 repository saveCipher`() = runTest {
        viewModel.updateName("我的笔记")
        viewModel.updateNotes("内容")

        var successCalled = false
        viewModel.save { successCalled = true }
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify { cipherRepository.saveCipher(any()) }
        coVerify { pendingChangesQueue.enqueue(any(), any(), any(), any()) }
        verify { syncManager.launchSyncAll() }
        assertTrue(successCalled)
    }

    @Test
    fun `加载已有笔记时状态正确`() = runTest {
        val entity = CipherEntity(
            id = "note-1",
            userId = "user-1",
            type = 4,
            data = "encrypted",
            favorite = false,
            reprompt = 0,
            createdAt = 1000L,
            modifiedAt = 2000L
        )
        coEvery { cipherRepository.getCipher("note-1") } returns entity

        val decrypted = com.pwbook.domain.DecryptedCipher(
            id = "note-1",
            type = 4,
            name = "已有笔记",
            notes = "已有内容",
            favorite = false,
            username = null,
            password = null,
            uris = emptyList(),
            totp = null,
            passkey = null,
            modifiedAt = 2000L
        )
        every { vaultSession.decryptCipher(entity) } returns decrypted

        viewModel.loadCipher("note-1")
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isNew)
        assertEquals("已有笔记", state.name)
        assertEquals("已有内容", state.notes)
        assertEquals("note-1", state.id)
    }
}
