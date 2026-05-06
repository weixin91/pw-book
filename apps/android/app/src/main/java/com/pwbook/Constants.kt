package com.pwbook

// 全局常量：同步、轮询、超时等阈值统一集中，避免散落各文件

object Constants {
    // 同步
    const val SYNC_INTERVAL_MINUTES = 15L

    // 密码生成器
    const val DEFAULT_PASSWORD_LENGTH = 16
    const val DEFAULT_MIN_NUMBERS = 1
    const val DEFAULT_MIN_SPECIAL = 1
    const val PASSWORD_LENGTH_MAX = 128
    const val PASSWORD_LENGTH_MIN = 5

    // 自动填充
    const val AUTO_FILL_TIMEOUT_MS = 5_000L
    const val SAVE_PROMPT_AUTO_DISMISS_MS = 10_000L
}
