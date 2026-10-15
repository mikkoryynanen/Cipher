import type { DecryptItem } from "../api";
import { copyButton } from "./copy";
import { h } from "./dom";
import { describe } from "./messages";
import type { Ctx, Panel } from "./types";

/** Paste received `🔒1.…` text and read it here, never in the messenger. */
export function decryptPanel(ctx: Ctx): Panel {
  const input = h("textarea", { id: "dec-input", rows: "5", placeholder: "Paste the encrypted message(s) here", "aria-label": "Encrypted message" });
  const msg = h("p", { className: "msg", role: "alert" });
  const results = h("div", { className: "results" });
  const run = h("button", { type: "button" }, "Decrypt");
  const paste = h("button", { type: "button", className: "secondary" }, "Paste & decrypt");

  function show(items: DecryptItem[]): void {
    results.replaceChildren(
      ...items.map((it) => {
        if (it.status === "error") return h("div", { className: "item error" }, describe(it.error));
        const note = h("p", { className: "hint" });
        const plain = h("pre", { className: "plain" }, it.text);
        return h(
          "div",
          { className: "item" },
          h("p", { className: "meta" }, `Decrypted with “${it.keyLabel}”`),
          plain,
          copyButton(ctx, "plaintext", () => it.text, note, "Copy text"),
          note,
        );
      }),
    );
  }

  async function go(source: () => Promise<DecryptItem[]>): Promise<void> {
    msg.textContent = "";
    results.replaceChildren();
    try {
      show(await source());
    } catch (e) {
      msg.textContent = describe(ctx.fail(e));
    }
  }

  run.addEventListener("click", () => go(() => ctx.api.decrypt(input.value)));
  paste.addEventListener("click", () => go(() => ctx.api.pasteAndDecrypt()));

  const el = h(
    "section",
    { className: "panel" },
    h("h2", {}, "Decrypt"),
    h("p", { className: "lead" }, "Copy the encrypted message from your messenger, then paste it here."),
    input,
    h("div", { className: "row" }, run, paste),
    msg,
    results,
  );
  return { el, refresh: async () => {} };
}
