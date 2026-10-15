import type { AppError, ErrorCode } from "../api";

const TEXT: Record<ErrorCode, string> = {
  NotOurFormat: "That is not a CipherChat message.",
  UnknownVersion: "This message uses a newer format. Update CipherChat to read it.",
  UnknownKey: "You do not have the key for this message.",
  Tampered: "This message was altered or damaged, so it was not decrypted.",
  Locked: "CipherChat is locked. Unlock it first.",
  WrongPassphrase: "Wrong passphrase.",
  Throttled: "Too many attempts.",
  InvalidInput: "That input is not valid.",
  NoKey: "Select a key first.",
  NoSuchKey: "That key no longer exists.",
  KeyCollision: "A different key with the same ID is already stored. Nothing was changed.",
  VaultExists: "A vault already exists.",
  NoVault: "No vault yet. Create one first.",
  Internal: "Something went wrong.",
};

/** Short reason shown next to a message that could not be decrypted. */
export function describe(e: AppError | ErrorCode): string {
  const code = typeof e === "string" ? e : e.code;
  return TEXT[code];
}

export const MIN_PASSPHRASE = 12;

export const PASSPHRASE_HINT = `Use at least ${MIN_PASSPHRASE} characters. A long phrase of several words works well. If you forget it, your keys cannot be recovered.`;

export const EXPORT_WARNING =
  "Share this key only out of band (in person, by phone call, or a password manager). Never send it through a chat.";
