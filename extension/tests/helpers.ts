import { readFileSync } from "node:fs";
import * as wasm from "../src/wasm-pkg/cipherchat_wasm";
import { Service } from "../src/background/service";
import { memoryKV } from "../src/background/storage";
import type { Request, ResponseFor } from "../src/shared/messages";

wasm.initSync({ module: readFileSync("src/wasm-pkg/cipherchat_wasm_bg.wasm") });

export const crypto = wasm;

export function makeService() {
  const local = memoryKV();
  const session = memoryKV();
  const service = new Service(crypto, local, session);
  /** Simulates the browser closing: session storage is wiped, local storage persists. */
  const restartBrowser = () => new Service(crypto, local, memoryKV());
  return { service, local, session, restartBrowser };
}

/** Unwrap a successful response or fail the test. */
export async function ok<R extends Request>(p: Promise<ResponseFor<R>>) {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
}

/** Corrupt a message by changing one character in the middle (always a fully used base64 char). */
export function tamper(wire: string): string {
  const i = "🔒1.".length + 30;
  return wire.slice(0, i) + (wire[i] === "A" ? "B" : "A") + wire.slice(i + 1);
}
