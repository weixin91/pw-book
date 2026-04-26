// 凭据条目相关类型

export enum CipherType {
  LOGIN = 1,
  CARD = 2,
  IDENTITY = 3,
  SECURE_NOTE = 4,
  PASSKEY = 5,
}

export enum UriMatchType {
  DOMAIN = 0,
  HOST = 1,
  STARTS_WITH = 2,
  EXACT = 3,
  REGULAR_EXPRESSION = 4,
  NEVER = 5,
}

export enum RepromptType {
  NONE = 0,
  PASSWORD = 1,
}

export interface LoginUri {
  uri: string;
  match: UriMatchType | null;
}

export interface CustomField {
  name: string;
  value: string;
  type: FieldType;
}

export enum FieldType {
  TEXT = 0,
  HIDDEN = 1,
  BOOLEAN = 2,
}

export interface CipherData {
  name: string;
  notes: string | null;
  fields: CustomField[];
  lastUsedAt: string | null;
  login?: {
    username: string | null;
    password: string | null;
    uris: LoginUri[];
    totp: string | null;
  };
  card?: {
    number: string;
    brand: string;
    expMonth: string;
    expYear: string;
    code: string;
  };
  identity?: {
    title: string;
    firstName: string;
    lastName: string;
    address: string;
  };
  secureNote?: {
    type: number;
  };
  passkey?: {
    credentialId: string;
    privateKey: string;
    publicKey: string;
    rpId: string;
    rpName?: string;
    userHandle: string;
    userName?: string;
    userDisplayName?: string;
    counter: number;
    createdAt: string;
  };
}

export interface Cipher {
  id: string;
  userId: string;
  type: CipherType;
  data: string; // 加密后的 JSON Base64
  favorite: boolean;
  reprompt: RepromptType;
  createdAt: string;
  modifiedAt: string;
}

export interface DomainAssociation {
  id: string;
  userId: string;
  domains: string[];
  packageNames: string[];
  createdAt: string;
}
