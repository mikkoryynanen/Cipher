import type {
  ChatSettings,
  ErrorCode,
  KeyInfo,
  KeySource,
  Request,
  ResponseFor,
} from "../shared/messages";
import { fromHex, toHex } from "../shared/hex";
import type { CryptoApi } from "./crypto";
import type { KV } from "./storage";
import { AppError, Vault, type KeyEntry } from "./vault";

const CHATS = "chats";
export const EPOCH = "epoch";
const CHANGING = new Set<Request["type"]>(["unlock", "lock", "addKey", "deleteKey", "setChat"]);
const EXPORT_PREFIX = "ck1-";
const KNOWN_WASM_CODES = new Set(["NotOurFormat", "UnknownVersion", "WrongKey", "Tampered"]);

type ChatMap = Record<string, ChatSettings>;

export class Service {
  private vault: Vault;

  constructor(
    private crypto: CryptoApi,
    private local: KV,
    session: KV,
  ) {
    this.vault = new Vault(crypto, local, session);
  }

  async handle<R extends Request>(req: R): Promise<ResponseFor<R>> {
    try {
      const res = (await this.dispatch(req)) as ResponseFor<R>;
      // Wake content scripts in other tabs (they watch this key) after state changes.
      if (CHANGING.has(req.type)) await this.local.set(EPOCH, Date.now());
      return res;
    } catch (e) {
      return { ok: false, error: this.toCode(e) } as ResponseFor<R>;
    }
  }

  private toCode(e: unknown): ErrorCode {
    if (e instanceof AppError) return e.code;
    const msg = e instanceof Error ? e.message : "";
    if (msg === "WrongKey") return "UnknownKey";
    if (KNOWN_WASM_CODES.has(msg)) return msg as ErrorCode;
    return "Internal";
  }

  private async dispatch(req: Request): Promise<unknown> {
    switch (req.type) {
      case "status":
        return {
          ok: true,
          unlocked: await this.vault.isUnlocked(),
          hasVault: await this.vault.hasVault(),
        };
      case "unlock":
        return { ok: true, created: await this.vault.unlock(req.passphrase) };
      case "lock":
        await this.vault.lock();
        return { ok: true };
      case "listKeys":
        return { ok: true, keys: (await this.vault.list()).map((k) => this.info(k)) };
      case "addKey":
        return { ok: true, ...(await this.addKey(req.label, req.source)) };
      case "deleteKey":
        await this.vault.remove(req.id);
        return { ok: true };
      case "exportKey": {
        const entry = await this.find(req.id);
        return { ok: true, exported: EXPORT_PREFIX + entry.keyHex };
      }
      case "encrypt": {
        const entry = await this.find(req.keyId);
        return { ok: true, text: this.crypto.encrypt(fromHex(entry.keyHex), req.text) };
      }
      case "decrypt":
        return { ok: true, ...(await this.decrypt(req.text)) };
      case "getChat":
        return {
          ok: true,
          settings: (await this.chats())[await chatHash(req.chatId)] ?? DEFAULT_CHAT,
          unlocked: await this.vault.isUnlocked(),
        };
      case "setChat":
        return { ok: true, settings: await this.setChat(req) };
      case "prepareSend":
        return { ok: true, ...(await this.prepareSend(req.chatId, req.text)) };
    }
  }

  private info(k: KeyEntry): KeyInfo {
    const fingerprint = this.crypto.fingerprint(fromHex(k.keyHex));
    return { id: k.id, label: k.label, fingerprint };
  }

  private async find(id: string): Promise<KeyEntry> {
    const entry = (await this.vault.list()).find((k) => k.id === id);
    if (!entry) throw new AppError("NoSuchKey");
    return entry;
  }

  private async addKey(label: string, source: KeySource) {
    let key: Uint8Array;
    let saltHex: string | undefined;
    switch (source.kind) {
      case "generate":
        key = this.crypto.generateKey();
        break;
      case "passphrase": {
        if (!source.passphrase) throw new AppError("InvalidInput");
        let salt: Uint8Array;
        try {
          salt = source.saltHex ? fromHex(source.saltHex) : this.crypto.randomSalt();
        } catch {
          throw new AppError("InvalidInput");
        }
        if (salt.length !== 16) throw new AppError("InvalidInput");
        key = this.crypto.deriveKey(source.passphrase, salt);
        saltHex = toHex(salt);
        break;
      }
      case "import": {
        const hex = source.exported.trim();
        if (!hex.startsWith(EXPORT_PREFIX)) throw new AppError("InvalidInput");
        try {
          key = fromHex(hex.slice(EXPORT_PREFIX.length));
        } catch {
          throw new AppError("InvalidInput");
        }
        if (key.length !== 32) throw new AppError("InvalidInput");
        break;
      }
    }
    const id = toHex(this.crypto.keyId(key));
    const existing = (await this.vault.list()).find((k) => k.id === id);
    if (existing) return { key: this.info(existing), saltHex };
    const fingerprint = this.crypto.fingerprint(key);
    const entry: KeyEntry = { id, label: label.trim() || fingerprint, keyHex: toHex(key) };
    await this.vault.put(entry);
    return { key: this.info(entry), saltHex };
  }

  private async decrypt(text: string): Promise<{ text: string; keyId: string }> {
    // Parse before the lock check so non-CipherChat text reports NotOurFormat.
    const id = toHex(this.crypto.keyIdOf(text));
    const entry = (await this.vault.list()).find((k) => k.id === id);
    if (!entry) throw new AppError("UnknownKey");
    return { text: this.crypto.decrypt(fromHex(entry.keyHex), text), keyId: id };
  }

  private async chats(): Promise<ChatMap> {
    return ((await this.local.get(CHATS)) as ChatMap | undefined) ?? {};
  }

  private async setChat(req: Extract<Request, { type: "setChat" }>): Promise<ChatSettings> {
    if (req.enabled && req.isGroup) throw new AppError("GroupNotSupported");
    const hash = await chatHash(req.chatId);
    const all = await this.chats();
    const next: ChatSettings = { ...(all[hash] ?? DEFAULT_CHAT) };
    if (req.keyId !== undefined) {
      if (req.keyId !== null) await this.find(req.keyId);
      next.keyId = req.keyId;
    }
    if (req.enabled !== undefined) {
      if (req.enabled && !next.keyId) throw new AppError("NoKey");
      next.enabled = req.enabled;
    }
    all[hash] = next;
    await this.local.set(CHATS, all);
    return next;
  }

  private async prepareSend(chatId: string, text: string) {
    const settings = (await this.chats())[await chatHash(chatId)] ?? DEFAULT_CHAT;
    if (!settings.enabled) return { text, passthrough: true };
    // Fail closed: from here on any error blocks the send.
    if (!settings.keyId) throw new AppError("NoKey");
    const entry = await this.find(settings.keyId);
    return { text: this.crypto.encrypt(fromHex(entry.keyHex), text), passthrough: false };
  }
}

const DEFAULT_CHAT: ChatSettings = { enabled: false, keyId: null };

/** Chat identifiers are stored hashed so the plain-text settings reveal no phone numbers. */
async function chatHash(chatId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(chatId));
  return toHex(new Uint8Array(digest)).slice(0, 32);
}
