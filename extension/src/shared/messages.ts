/** Typed request/response API between popup / content script and the service worker. */

export type DecryptErrorCode =
  | "NotOurFormat"
  | "UnknownVersion"
  | "UnknownKey"
  | "Tampered"
  | "Locked";

export type ErrorCode =
  | DecryptErrorCode
  | "WrongPassphrase"
  | "NoKey"
  | "NoSuchKey"
  | "InvalidInput"
  | "GroupNotSupported"
  | "Internal";

export interface KeyInfo {
  /** Key ID as 8 hex chars. */
  id: string;
  label: string;
  fingerprint: string;
}

export interface ChatSettings {
  enabled: boolean;
  keyId: string | null;
}

export type KeySource =
  | { kind: "generate" }
  | { kind: "passphrase"; passphrase: string; saltHex?: string }
  | { kind: "import"; exported: string };

export type Request =
  | { type: "status" }
  | { type: "unlock"; passphrase: string }
  | { type: "lock" }
  | { type: "listKeys" }
  | { type: "addKey"; label: string; source: KeySource }
  | { type: "deleteKey"; id: string }
  | { type: "exportKey"; id: string }
  | { type: "encrypt"; keyId: string; text: string }
  | { type: "decrypt"; text: string }
  | { type: "getChat"; chatId: string }
  | { type: "setChat"; chatId: string; enabled?: boolean; keyId?: string | null; isGroup?: boolean }
  | { type: "prepareSend"; chatId: string; text: string };

export interface Failure {
  ok: false;
  error: ErrorCode;
}

export type Ok<T> = { ok: true } & T;
export type Result<T> = Ok<T> | Failure;

export interface ResponseMap {
  status: { unlocked: boolean; hasVault: boolean };
  unlock: { created: boolean };
  lock: Record<string, never>;
  listKeys: { keys: KeyInfo[] };
  addKey: { key: KeyInfo; saltHex?: string };
  deleteKey: Record<string, never>;
  exportKey: { exported: string };
  encrypt: { text: string };
  decrypt: { text: string; keyId: string };
  getChat: { settings: ChatSettings; unlocked: boolean };
  setChat: { settings: ChatSettings };
  /** `passthrough`: encryption is off for this chat, send the original text. */
  prepareSend: { text: string; passthrough: boolean };
}

export type ResponseFor<R extends Request> = Result<ResponseMap[R["type"]]>;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  NotOurFormat: "Not a CipherChat message",
  UnknownVersion: "Unknown message version (update CipherChat?)",
  UnknownKey: "Unknown key – you don't have the key for this message",
  Tampered: "Message was tampered with or corrupted",
  Locked: "CipherChat is locked – unlock it in the extension popup",
  WrongPassphrase: "Wrong unlock passphrase",
  NoKey: "No key selected for this chat",
  NoSuchKey: "That key no longer exists",
  InvalidInput: "Invalid input",
  GroupNotSupported: "Encryption is not supported in group chats yet",
  Internal: "Unexpected error",
};

/** Short reasons shown in place of a message that cannot be decrypted. */
export const SHORT_REASONS: Record<ErrorCode, string> = {
  NotOurFormat: "not a valid encrypted message",
  UnknownVersion: "unknown version",
  UnknownKey: "unknown key",
  Tampered: "tampered or corrupted",
  Locked: "locked – unlock CipherChat",
  WrongPassphrase: "wrong passphrase",
  NoKey: "no key",
  NoSuchKey: "unknown key",
  InvalidInput: "invalid message",
  GroupNotSupported: "group chats not supported",
  Internal: "error",
};
