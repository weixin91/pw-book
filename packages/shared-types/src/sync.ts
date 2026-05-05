// 同步协议相关共享类型

import type { Cipher, DomainAssociation } from "./cipher.js";

export interface SyncResponse {
  profile: {
    id: string;
    email: string;
    kdfType: string;
    kdfIterations: number;
    kdfMemory?: number;
    kdfParallelism?: number;
    publicKey: string;
    securityStamp: string;
  };
  ciphers: Cipher[];
  deletedCipherIds?: string[];
  domainAssociations: DomainAssociation[];
  syncToken: string;
}

export interface SyncPushRequest {
  changes: SyncChange[];
  lastSyncToken: string;
}

export interface SyncChange {
  id: string;
  type: "CREATE" | "UPDATE" | "DELETE";
  cipher: Cipher;
  clientTimestamp: string;
}

export interface SyncPushResponse {
  accepted: string[];
  rejected: string[];
  conflicts: string[];
  newSyncToken: string;
}

export interface PendingChange {
  id: string;
  cipherId: string;
  operation: "CREATE" | "UPDATE" | "DELETE";
  encryptedData: string;
  clientTimestamp: string;
  retryCount: number;
}

export interface SyncStatus {
  state: "IDLE" | "SYNCING" | "ERROR" | "OFFLINE";
  lastSyncAt: string | null;
  pendingChanges: number;
  error: string | null;
}

export interface WebSocketMessage {
  type: "SYNC_REQUIRED" | "DEVICE_LOGOUT" | "PONG" | "PING";
  timestamp?: string;
  reason?: string;
}

export interface CookieSyncPayload {
  domain: string;
  encryptedData: string;
  modifiedAt: string;
}
