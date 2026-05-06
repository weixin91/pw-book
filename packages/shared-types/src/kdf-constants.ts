// 跨平台共享的 KDF 与密码学常量，防止各端重复硬编码

export const RECOVERY_KEY_PBKDF2_ITERATIONS = 100_000;
export const MASTER_KEY_PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_HASH_ALGORITHM = "SHA-256";
