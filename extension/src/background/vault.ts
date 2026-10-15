import type { ErrorCode } from "../shared/messages";
import { fromHex, toHex } from "../shared/hex";
import type { CryptoApi } from "./crypto";
import type { KV } from "./storage";

export class AppError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

export interface KeyEntry {
  id: string;
  label: string;
  keyHex: string;
}

interface VaultFile {
  v: 1;
  saltHex: string;
  /** `🔒1.` message holding the JSON key list, sealed under the unlock-derived key. */
  blob: string;
}

const VAULT = "vault";
const SESSION_KEY = "vaultKey";

/**
 * Keys live in `chrome.storage.local` only as one authenticated blob sealed
 * under an Argon2id key derived from the unlock passphrase. The derived key is
 * kept in `chrome.storage.session` (memory only, cleared when the browser closes).
 */
export class Vault {
  constructor(
    private crypto: CryptoApi,
    private local: KV,
    private session: KV,
  ) {}

  async hasVault(): Promise<boolean> {
    return (await this.local.get(VAULT)) !== undefined;
  }

  async isUnlocked(): Promise<boolean> {
    return (await this.session.get(SESSION_KEY)) !== undefined;
  }

  /** Unlock, creating the vault on first use. Returns true if newly created. */
  async unlock(passphrase: string): Promise<boolean> {
    if (!passphrase) throw new AppError("InvalidInput");
    const file = (await this.local.get(VAULT)) as VaultFile | undefined;
    if (!file) {
      const salt = this.crypto.randomSalt();
      const key = this.crypto.deriveKey(passphrase, salt);
      await this.save({ v: 1, saltHex: toHex(salt), blob: "" }, key, []);
      await this.session.set(SESSION_KEY, toHex(key));
      return true;
    }
    const key = this.crypto.deriveKey(passphrase, fromHex(file.saltHex));
    try {
      this.crypto.decrypt(key, file.blob);
    } catch {
      throw new AppError("WrongPassphrase");
    }
    await this.session.set(SESSION_KEY, toHex(key));
    return false;
  }

  async lock(): Promise<void> {
    await this.session.remove(SESSION_KEY);
  }

  async list(): Promise<KeyEntry[]> {
    const { file, key } = await this.open();
    return JSON.parse(this.crypto.decrypt(key, file.blob)) as KeyEntry[];
  }

  async put(entry: KeyEntry): Promise<void> {
    const { file, key } = await this.open();
    const keys = (JSON.parse(this.crypto.decrypt(key, file.blob)) as KeyEntry[]).filter(
      (k) => k.id !== entry.id,
    );
    keys.push(entry);
    await this.save(file, key, keys);
  }

  async remove(id: string): Promise<void> {
    const { file, key } = await this.open();
    const keys = JSON.parse(this.crypto.decrypt(key, file.blob)) as KeyEntry[];
    if (!keys.some((k) => k.id === id)) throw new AppError("NoSuchKey");
    await this.save(
      file,
      key,
      keys.filter((k) => k.id !== id),
    );
  }

  private async open(): Promise<{ file: VaultFile; key: Uint8Array }> {
    const hex = (await this.session.get(SESSION_KEY)) as string | undefined;
    const file = (await this.local.get(VAULT)) as VaultFile | undefined;
    if (!hex || !file) throw new AppError("Locked");
    return { file, key: fromHex(hex) };
  }

  private async save(file: VaultFile, key: Uint8Array, keys: KeyEntry[]): Promise<void> {
    const blob = this.crypto.encrypt(key, JSON.stringify(keys));
    await this.local.set(VAULT, { ...file, blob });
  }
}
