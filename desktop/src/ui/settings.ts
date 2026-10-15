import { h } from "./dom";
import { describe } from "./messages";
import type { Ctx, Panel } from "./types";

/** Clipboard clearing. Exported keys are always cleared, so there is no switch for them. */
export function settingsPanel(ctx: Ctx): Panel {
  const timeout = h("input", { type: "number", id: "set-timeout", min: "5", max: "600", "aria-label": "Clear after (seconds)" });
  const plain = h("input", { type: "checkbox", id: "set-plain" });
  const cipher = h("input", { type: "checkbox", id: "set-cipher" });
  const msg = h("p", { className: "msg", role: "alert" });
  const save = h("button", { type: "button" }, "Save");

  async function refresh(): Promise<void> {
    try {
      const s = await ctx.api.getClipboardSettings();
      timeout.value = String(s.timeoutSecs);
      plain.checked = s.clearPlaintext;
      cipher.checked = s.clearCiphertext;
    } catch (e) {
      msg.textContent = describe(ctx.fail(e));
    }
  }

  save.addEventListener("click", async () => {
    try {
      await ctx.api.setClipboardSettings({
        timeoutSecs: Number(timeout.value),
        clearPlaintext: plain.checked,
        clearCiphertext: cipher.checked,
      });
      msg.textContent = "Saved.";
    } catch (e) {
      msg.textContent = describe(ctx.fail(e));
    }
  });

  const el = h(
    "section",
    { className: "panel" },
    h("h2", {}, "Clipboard"),
    h("p", { className: "lead" }, "Copied keys and decrypted text are removed from the clipboard after a delay, unless you copied something else in the meantime."),
    h("label", { for: "set-timeout" }, "Clear after (seconds)"),
    timeout,
    h("label", { className: "check" }, plain, " Also clear decrypted text"),
    h("label", { className: "check" }, cipher, " Also clear encrypted messages"),
    h("p", { className: "hint" }, "Exported keys are always cleared."),
    save,
    msg,
  );
  return { el, refresh };
}
