import init, * as wasm from "../wasm-pkg/cipherchat_wasm";

/** The subset of the WASM module the extension uses (also lets tests inject it). */
export interface CryptoApi {
  generateKey(): Uint8Array;
  randomSalt(): Uint8Array;
  deriveKey(passphrase: string, salt: Uint8Array): Uint8Array;
  keyId(key: Uint8Array): Uint8Array;
  fingerprint(key: Uint8Array): string;
  fingerprintOfId(id: Uint8Array): string;
  encrypt(key: Uint8Array, plaintext: string): string;
  decrypt(key: Uint8Array, text: string): string;
  isEncrypted(text: string): boolean;
  keyIdOf(text: string): Uint8Array;
}

/** Load the WASM module in the service worker. */
export async function loadCrypto(wasmUrl: string): Promise<CryptoApi> {
  await init({ module_or_path: wasmUrl });
  return wasm;
}
