package com.pwbook.crypto

/**
 * 简化 CBOR 编码器，仅覆盖 attestationObject 与 COSE_Key 编码所需的最小子集。
 * 输出与 Edge 端 passkey-storage.ts 中 CBOR 字节级一致。
 */
object CborEncoder {

    /**
     * 编码 CBOR text string（UTF-8）。
     */
    fun pushCborTextString(out: MutableList<Byte>, text: String) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        pushByteStringHeader(out, bytes.size, major = 3)
        for (b in bytes) out.add(b)
    }

    /**
     * 编码 CBOR byte string。
     */
    fun pushCborByteString(out: MutableList<Byte>, data: ByteArray) {
        pushByteStringHeader(out, data.size, major = 2)
        for (b in data) out.add(b)
    }

    /**
     * 编码 CBOR map header。
     */
    fun pushCborMapHeader(out: MutableList<Byte>, size: Int) {
        pushUnsigned(out, size, major = 5)
    }

    /**
     * 编码 CBOR 有符号整数（正数或负数）。
     */
    fun pushCborInt(out: MutableList<Byte>, value: Int) {
        if (value >= 0) {
            pushUnsigned(out, value, major = 0)
        } else {
            // 负数编码：-1 → 0x20, -7 → 0x26
            pushUnsigned(out, -value - 1, major = 1)
        }
    }

    /**
     * 编码 attestationObject = {"fmt": "none", "attStmt": {}, "authData": <bytes>}
     */
    fun encodeAttestationObjectNone(authData: ByteArray): ByteArray {
        val out = mutableListOf<Byte>()
        pushCborMapHeader(out, 3)

        // "fmt" -> "none"
        pushCborTextString(out, "fmt")
        pushCborTextString(out, "none")

        // "attStmt" -> {}
        pushCborTextString(out, "attStmt")
        out.add(0xA0.toByte()) // empty map

        // "authData" -> authData bytes
        pushCborTextString(out, "authData")
        pushCborByteString(out, authData)

        return out.toByteArray()
    }

    /**
     * 将 EC P-256 公钥编码为 COSE_Key（CBOR）。
     * 与 Edge 端 encodeCoseKeyEs256() 输出字节级一致。
     */
    fun encodeCoseKeyEs256(x: ByteArray, y: ByteArray): ByteArray {
        val out = mutableListOf<Byte>()
        out.add(0xA5.toByte()) // map(5)

        // 1 (kty) -> 2 (EC2)
        out.add(0x01)
        out.add(0x02)

        // 3 (alg) -> -7 (ES256)
        out.add(0x03)
        out.add(0x26) // negative integer -7

        // -1 (crv) -> 1 (P-256)
        out.add(0x20) // negative 0 == -1
        out.add(0x01)

        // -2 (x) -> bstr(32)
        out.add(0x21) // negative 1 == -2
        out.add(0x58) // bytes with 1-byte length
        out.add(0x20) // length 32
        for (i in 0 until 32) out.add(x[i])

        // -3 (y) -> bstr(32)
        out.add(0x22) // negative 2 == -3
        out.add(0x58)
        out.add(0x20) // length 32
        for (i in 0 until 32) out.add(y[i])

        return out.toByteArray()
    }

    private fun pushByteStringHeader(out: MutableList<Byte>, size: Int, major: Int) {
        val initial = (major shl 5).toByte()
        when {
            size <= 23 -> out.add((initial.toInt() or size).toByte())
            size <= 0xFF -> {
                out.add((initial.toInt() or 24).toByte())
                out.add(size.toByte())
            }
            size <= 0xFFFF -> {
                out.add((initial.toInt() or 25).toByte())
                out.add((size ushr 8).toByte())
                out.add((size and 0xFF).toByte())
            }
            else -> {
                out.add((initial.toInt() or 26).toByte())
                out.add((size ushr 24).toByte())
                out.add((size ushr 16).toByte())
                out.add((size ushr 8).toByte())
                out.add((size and 0xFF).toByte())
            }
        }
    }

    private fun pushUnsigned(out: MutableList<Byte>, value: Int, major: Int) {
        val initial = (major shl 5).toByte()
        when {
            value <= 23 -> out.add((initial.toInt() or value).toByte())
            value <= 0xFF -> {
                out.add((initial.toInt() or 24).toByte())
                out.add(value.toByte())
            }
            value <= 0xFFFF -> {
                out.add((initial.toInt() or 25).toByte())
                out.add((value ushr 8).toByte())
                out.add((value and 0xFF).toByte())
            }
            else -> {
                out.add((initial.toInt() or 26).toByte())
                out.add((value ushr 24).toByte())
                out.add((value ushr 16).toByte())
                out.add((value ushr 8).toByte())
                out.add((value and 0xFF).toByte())
            }
        }
    }
}
