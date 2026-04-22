// API 相关共享类型

export enum KdfType {
  PBKDF2_SHA256 = "PBKDF2_SHA256",
  ARGON2ID = "ARGON2ID",
}

export enum DeviceType {
  BROWSER = "BROWSER",
  ANDROID = "ANDROID",
}

export interface RegisterRequest {
  email: string;
  masterPasswordHash: string;
  protectedKey: string;
  publicKey: string;
  encryptedPrivateKey: string;
  kdfType: KdfType;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  recoveryKeyHash: string;
  encryptedRecoveryKey: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
  protectedKey: string;
}

export interface LoginRequest {
  email: string;
  masterPasswordHash: string;
  deviceId: string;
  deviceType: DeviceType;
  deviceName: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  protectedKey: string;
  securityStamp: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  token: string;
  refreshToken: string;
}

export interface RecoverRequest {
  email: string;
  recoveryKey: string;
  newMasterPasswordHash: string;
  newProtectedKey: string;
}

export interface UserProfile {
  id: string;
  email: string;
  kdfType: KdfType;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  publicKey: string;
  securityStamp: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface DeviceInfo {
  id: string;
  deviceId: string;
  deviceType: DeviceType;
  deviceName: string;
  lastSyncAt: string | null;
  createdAt: string;
  isCurrentDevice?: boolean;
}
