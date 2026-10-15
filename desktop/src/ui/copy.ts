import type { CopyKind } from "../api";
import { h, info, problem } from "./dom";
import { describe } from "./messages";
import type { Ctx } from "./types";

const timers = new WeakMap<HTMLElement, number>();

/** Show a ticking "clears in N s" notice in `note`. */
export function countdown(ctx: Ctx, note: HTMLElement, secs: number): void {
  const old = timers.get(note);
  if (old !== undefined) ctx.clear(old);
  let left = secs;
  const paint = () => {
    info(note, `Copied. The clipboard will be cleared in ${left} s.`);
  };
  paint();
  const id = ctx.every(() => {
    left -= 1;
    if (left <= 0) {
      ctx.clear(id);
      timers.delete(note);
      info(note, "Clipboard cleared.");
    } else paint();
  }, 1000);
  timers.set(note, id);
}

/** A button that copies through the backend (which clears the clipboard later). */
export function copyButton(
  ctx: Ctx,
  kind: CopyKind,
  getText: () => string,
  note: HTMLElement,
  label = "Copy",
): HTMLButtonElement {
  const btn = h("button", { type: "button", className: "secondary" }, label);
  btn.addEventListener("click", async () => {
    try {
      const out = await ctx.api.copy(kind, getText());
      if (out.clearsInSecs) countdown(ctx, note, out.clearsInSecs);
      else info(note, "Copied. This is not cleared automatically.");
    } catch (e) {
      problem(note, describe(ctx.fail(e)));
    }
  });
  return btn;
}
