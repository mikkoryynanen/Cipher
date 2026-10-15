import { vi } from "vitest";
import type { Api, AppError, KeyInfo } from "../src/api";
import { App } from "../src/ui/app";

export type FakeApi = { [K in keyof Api]: ReturnType<typeof vi.fn> & Api[K] } & {
  /** Fire the backend's `locked` event. */
  emitLocked(): void;
};

const KEY: KeyInfo = { id: "aabbccdd", label: "Alex", fingerprint: "1234-5678" };

export function fakeApi(over: Partial<Api> = {}): FakeApi {
  let lockedHandler: (() => void) | undefined;
  const base: Api = {
    status: async () => ({ unlocked: true, hasVault: true }),
    createVault: async () => {},
    unlock: async () => {},
    lock: async () => {},
    touch: async () => {},
    listKeys: async () => [KEY],
    addKey: async (label) => ({ key: { ...KEY, label: label || KEY.fingerprint }, alreadyExists: false, weakPassphrase: false }),
    renameKey: async (_id, label) => ({ ...KEY, label }),
    deleteKey: async () => {},
    exportKey: async () => "ck1-" + "ab".repeat(32),
    encrypt: async (_k, text) => `🔒1.ENC(${text})`,
    decrypt: async () => [{ status: "ok", text: "the secret text", keyId: KEY.id, keyLabel: KEY.label }],
    pasteAndDecrypt: async () => [{ status: "ok", text: "pasted secret", keyId: KEY.id, keyLabel: KEY.label }],
    copy: async () => ({ clearsInSecs: 30 }),
    getClipboardSettings: async () => ({ timeoutSecs: 30, clearPlaintext: true, clearCiphertext: false }),
    setClipboardSettings: async (s) => s,
    onLocked: async (fn) => {
      lockedHandler = fn;
      return () => {
        lockedHandler = undefined;
      };
    },
    ...over,
  };
  const wrapped = Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, vi.fn(v as (...a: never[]) => unknown)]),
  ) as unknown as FakeApi;
  wrapped.emitLocked = () => lockedHandler?.();
  return wrapped;
}

export function err(code: AppError["code"], waitSecs?: number): AppError {
  return { code, waitSecs };
}

export async function flush(): Promise<void> {
  // Let pending promise chains (API calls and the renders that follow) settle.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

export async function mount(api: FakeApi): Promise<{ root: HTMLElement; app: App }> {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app") as HTMLElement;
  const app = new App(root, api);
  await app.start();
  await flush();
  return { root, app };
}

export function $<T extends HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

export function button(root: ParentNode, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll("button")).find((x) => x.textContent === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
}

export async function click(el: HTMLElement): Promise<void> {
  el.click();
  await flush();
}

export function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The action button inside the panel that contains `fieldSel` (tabs share some labels). */
export function inPanel(root: ParentNode, fieldSel: string, text: string): HTMLButtonElement {
  const section = $(root, fieldSel).closest("section");
  if (!section) throw new Error(`no panel for ${fieldSel}`);
  return button(section, text);
}
