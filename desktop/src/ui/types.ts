import type { Api, AppError } from "../api";

/** Small, non-secret state that outlives a lock. It lives in memory only. */
export interface Session {
  /** The key last used to encrypt or decrypt. */
  lastKeyId?: string;
  /** Why the app is locked, when the user did not ask for it. */
  lockReason?: "inactivity";
}

export type TabName = "messages" | "keys" | "settings";

export interface Ctx {
  api: Api;
  session: Session;
  /** Report a failed call. A `Locked` error sends the user back to the unlock screen. */
  fail(e: unknown): AppError;
  /** Set an interval that is cleared when the screen is torn down. */
  every(fn: () => void, ms: number): number;
  clear(id: number): void;
  /** Show another tab. */
  go(tab: TabName): void;
}

export interface Panel {
  el: HTMLElement;
  /** Reload anything that may have changed while the panel was hidden. */
  refresh(): Promise<void>;
}
