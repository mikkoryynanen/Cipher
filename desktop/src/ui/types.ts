import type { Api, AppError } from "../api";

export interface Ctx {
  api: Api;
  /** Report a failed call. A `Locked` error sends the user back to the unlock screen. */
  fail(e: unknown): AppError;
  /** Set an interval that is cleared when the screen is torn down. */
  every(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface Panel {
  el: HTMLElement;
  /** Reload anything that may have changed while the panel was hidden. */
  refresh(): Promise<void>;
}
