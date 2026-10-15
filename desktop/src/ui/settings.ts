import { h, info, problem, statusLine } from "./dom";
import { describe } from "./messages";
import type { Ctx, Panel } from "./types";

/** Copy and clipboard preferences. Exported keys are always cleared, so there is no switch for them. */
export function settingsPanel(ctx: Ctx): Panel {
  const timeout = h("input", { type: "number", id: "set-timeout", min: "5", max: "600", "aria-label": "Clear after (seconds)" });
  const auto = h("input", { type: "checkbox", id: "set-autocopy" });
  const plain = h("input", { type: "checkbox", id: "set-plain" });
  const cipher = h("input", { type: "checkbox", id: "set-cipher" });
  const msg = statusLine();
  const save = h("button", { type: "button" }, "Save");

  async function refresh(): Promise<void> {
    try {
      const s = await ctx.api.getClipboardSettings();
      timeout.value = String(s.timeoutSecs);
      auto.checked = s.autoCopyCiphertext;
      plain.checked = s.clearPlaintext;
      cipher.checked = s.clearCiphertext;
    } catch (e) {
      problem(msg, describe(ctx.fail(e)));
    }
  }

  save.addEventListener("click", async () => {
    try {
      await ctx.api.setClipboardSettings({
        timeoutSecs: Number(timeout.value),
        clearPlaintext: plain.checked,
        clearCiphertext: cipher.checked,
        autoCopyCiphertext: auto.checked,
      });
      info(msg, "Saved.");
    } catch (e) {
      problem(msg, describe(ctx.fail(e)));
    }
  });

  const el = h(
    "section",
    { className: "panel" },
    h("h2", {}, "Settings"),
    h("p", { className: "lead" }, "Copied keys and decrypted text are removed from the clipboard after a delay, unless you copied something else in the meantime."),
    h("label", { className: "check" }, auto, " Copy encrypted message automatically after encrypting"),
    h("h3", {}, "Clipboard clearing"),
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
