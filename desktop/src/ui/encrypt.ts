import type { KeyInfo } from "../api";
import { copyButton } from "./copy";
import { h } from "./dom";
import { describe } from "./messages";
import type { Ctx, Panel } from "./types";

/** Type a message, pick a key, copy the `🔒1.…` text into any messenger. */
export function encryptPanel(ctx: Ctx): Panel {
  const select = h("select", { id: "enc-key", "aria-label": "Key" });
  const input = h("textarea", { id: "enc-input", rows: "6", placeholder: "Type your message here", "aria-label": "Message" });
  const output = h("textarea", { id: "enc-output", rows: "5", readonly: true, "aria-label": "Encrypted message" });
  const msg = h("p", { className: "msg", role: "alert" });
  const note = h("p", { className: "hint" });
  const result = h("div", { className: "result", hidden: true }, output, copyButton(ctx, "ciphertext", () => output.value, note, "Copy encrypted message"), note);
  const run = h("button", { type: "button" }, "Encrypt");

  async function refresh(): Promise<void> {
    let keys: KeyInfo[] = [];
    try {
      keys = await ctx.api.listKeys();
    } catch (e) {
      msg.textContent = describe(ctx.fail(e));
      return;
    }
    const keep = select.value;
    select.replaceChildren(
      h("option", { value: "" }, keys.length ? "Select a key…" : "No keys yet – add one in Keys"),
      ...keys.map((k) => h("option", { value: k.id }, `${k.label} (${k.fingerprint})`)),
    );
    if (keys.some((k) => k.id === keep)) select.value = keep;
  }

  run.addEventListener("click", async () => {
    msg.textContent = "";
    result.hidden = true;
    try {
      output.value = await ctx.api.encrypt(select.value || null, input.value);
      note.textContent = "";
      result.hidden = false;
    } catch (e) {
      output.value = "";
      msg.textContent = describe(ctx.fail(e));
    }
  });

  const el = h(
    "section",
    { className: "panel" },
    h("h2", {}, "Encrypt"),
    h("p", { className: "lead" }, "Encrypt here, then paste the result into your messenger. The messenger only ever sees the encrypted text."),
    h("label", { for: "enc-key" }, "Key"),
    select,
    h("label", { for: "enc-input" }, "Message"),
    input,
    run,
    msg,
    result,
  );
  return { el, refresh };
}
