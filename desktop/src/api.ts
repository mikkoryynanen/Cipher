/** Typed access to the backend. The UI never handles key bytes except via `exportKey`. */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ErrorCode =
  | "NotOurFormat"
  | "UnknownVersion"
  | "UnknownKey"
  | "Tampered"
  | "Locked"
  | "WrongPassphrase"
  | "Throttled"
  | "InvalidInput"
  | "NoKey"
  | "NoSuchKey"
  | "KeyCollision"
  | "VaultExists"
  | "NoVault"
  | "Internal";

export interface AppError {
  code: ErrorCode;
  /** Seconds to wait, for `Throttled`. */
  waitSecs?: number;
}

export interface VaultStatus {
  unlocked: boolean;
  hasVault: boolean;
}

export interface KeyInfo {
  id: string;
  label: string;
  fingerprint: string;
}

export type KeySource =
  | { kind: "generate" }
  | { kind: "passphrase"; passphrase: string; saltHex?: string }
  | { kind: "import"; exported: string };

export interface AddOutcome {
  key: KeyInfo;
  saltHex?: string;
  alreadyExists: boolean;
  weakPassphrase: boolean;
}

export type DecryptItem =
  | { status: "ok"; text: string; keyId: string; keyLabel: string }
  | { status: "error"; error: ErrorCode };

export type CopyKind = "key" | "plaintext" | "ciphertext";

export interface CopyOutcome {
  clearsInSecs?: number | null;
}

export interface ClipboardSettings {
  timeoutSecs: number;
  clearPlaintext: boolean;
  clearCiphertext: boolean;
}

export interface Api {
  status(): Promise<VaultStatus>;
  createVault(passphrase: string): Promise<void>;
  unlock(passphrase: string): Promise<void>;
  lock(): Promise<void>;
  touch(): Promise<void>;
  listKeys(): Promise<KeyInfo[]>;
  addKey(label: string, source: KeySource): Promise<AddOutcome>;
  renameKey(id: string, label: string): Promise<KeyInfo>;
  deleteKey(id: string): Promise<void>;
  exportKey(id: string): Promise<string>;
  encrypt(keyId: string | null, text: string): Promise<string>;
  decrypt(text: string): Promise<DecryptItem[]>;
  pasteAndDecrypt(): Promise<DecryptItem[]>;
  copy(kind: CopyKind, text: string): Promise<CopyOutcome>;
  getClipboardSettings(): Promise<ClipboardSettings>;
  setClipboardSettings(s: ClipboardSettings): Promise<ClipboardSettings>;
  /** Subscribe to the backend's `locked` event. Returns an unsubscribe function. */
  onLocked(fn: () => void): Promise<() => void>;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && typeof (e as AppError).code === "string";
}

/** Anything thrown that is not an AppError becomes `Internal`. */
export function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : { code: "Internal" };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toAppError(e);
  }
}

export function createTauriApi(): Api {
  return {
    status: () => call("status"),
    createVault: (passphrase) => call("create_vault", { passphrase }),
    unlock: (passphrase) => call("unlock", { passphrase }),
    lock: () => call("lock"),
    touch: () => call("touch"),
    listKeys: () => call("list_keys"),
    addKey: (label, source) => call("add_key", { label, source }),
    renameKey: (id, label) => call("rename_key", { id, label }),
    deleteKey: (id) => call("delete_key", { id }),
    exportKey: (id) => call("export_key", { id }),
    encrypt: (keyId, text) => call("encrypt", { keyId, text }),
    decrypt: (text) => call("decrypt", { text }),
    pasteAndDecrypt: () => call("paste_and_decrypt"),
    copy: (kind, text) => call("copy_to_clipboard", { kind, text }),
    getClipboardSettings: () => call("get_clipboard_settings"),
    setClipboardSettings: (settings) => call("set_clipboard_settings", { settings }),
    onLocked: async (fn) => listen("locked", fn),
  };
}
