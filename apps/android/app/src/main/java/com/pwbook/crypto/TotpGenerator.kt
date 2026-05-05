package com.pwbook.crypto

import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.floor
import kotlin.math.pow

/**
 * TOTP (Time-based One-Time Password) 生成器
 * 遵循 RFC 6238，支持 SHA-1 / SHA-256 / SHA-512
 */
object TotpGenerator {

    private const val DEFAULT_PERIOD = 30
    private const val DEFAULT_DIGITS = 6

    /**
     * 生成当前时间窗口的 TOTP 码
     *
     * @param secretBase32 Base32 编码的密钥
     * @param period 时间窗口（秒），默认 30
     * @param digits 输出位数，默认 6
     * @param algorithm 哈希算法："SHA1"、"SHA256"、"SHA512"
     */
    fun generate(
        secretBase32: String,
        period: Int = DEFAULT_PERIOD,
        digits: Int = DEFAULT_DIGITS,
        algorithm: String = "SHA1"
    ): String {
        val secret = base32Decode(secretBase32)
        val counter = floor(System.currentTimeMillis() / 1000.0 / period).toLong()
        return generateHotp(secret, counter, digits, algorithm)
    }

    /**
     * 获取当前时间窗口的剩余秒数
     */
    fun remainingSeconds(period: Int = DEFAULT_PERIOD): Int {
        val currentSeconds = (System.currentTimeMillis() / 1000) % period
        return period - currentSeconds.toInt()
    }

    private fun generateHotp(
        secret: ByteArray,
        counter: Long,
        digits: Int,
        algorithm: String
    ): String {
        val mac = Mac.getInstance("Hmac$algorithm")
        mac.init(SecretKeySpec(secret, "Hmac$algorithm"))

        val buffer = ByteBuffer.allocate(8)
        buffer.putLong(counter)
        val hash = mac.doFinal(buffer.array())

        val offset = hash[hash.size - 1].toInt() and 0x0f
        val binary = ((hash[offset].toInt() and 0x7f) shl 24) or
                ((hash[offset + 1].toInt() and 0xff) shl 16) or
                ((hash[offset + 2].toInt() and 0xff) shl 8) or
                (hash[offset + 3].toInt() and 0xff)

        val otp = binary % (10.0.pow(digits.toDouble()).toInt())
        return otp.toString().padStart(digits, '0')
    }

    /**
     * Base32 解码（支持大写/小写，忽略填充符 =）
     */
    private fun base32Decode(input: String): ByteArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val cleaned = input.uppercase().replace("=", "")
        val output = mutableListOf<Byte>()
        var buffer = 0
        var bitsLeft = 0

        for (char in cleaned) {
            val valChar = alphabet.indexOf(char)
            if (valChar < 0) continue
            buffer = (buffer shl 5) or valChar
            bitsLeft += 5
            if (bitsLeft >= 8) {
                bitsLeft -= 8
                output.add((buffer shr bitsLeft and 0xFF).toByte())
            }
        }
        return output.toByteArray()
    }
}
