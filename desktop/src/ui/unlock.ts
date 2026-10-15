import { describe, passphraseHint } from "./messages";
import { h, info, problem, statusLine } from "./dom";
import type { Ctx } from "./types";

/** Unlock an existing vault, or create one on first use. */
export function unlockScreen(ctx: Ctx, hasVault: boolean, onDone: () => void, lockReason?: "inactivity", minPassphrase = 12): HTMLElement {
  const pass = h("input", { type: "password", id: "pass", autocomplete: "off", "aria-label": "Passphrase" });
  const confirm = h("input", { type: "password", id: "confirm", autocomplete: "off", "aria-label": "Repeat passphrase" });
  const msg = statusLine();
  const go = h("button", { type: "submit" }, hasVault ? "Unlock" : "Create vault");
  let waitTimer: number | undefined;

  const say = (text: string) => problem(msg, text);

  /** Disable the button and count down a throttling wait. */
  const wait = (secs: number) => {
    if (waitTimer !== undefined) ctx.clear(waitTimer);
    let left = secs;
    go.disabled = true;
    const paint = () => say(`Too many attempts. Try again in ${left} s.`);
    paint();
    waitTimer = ctx.every(() => {
      left -= 1;
      if (left <= 0) {
        ctx.clear(waitTimer as number);
        waitTimer = undefined;
        go.disabled = false;
        info(msg, "You can try again now.");
      } else paint();
    }, 1000);
  };

  const form = h(
    "form",
    { className: "card", autocomplete: "off" },
    h("h1", {}, "CipherChat"),
    lockReason === "inactivity" && hasVault
      ? h("p", { className: "warning", role: "status" }, "CipherChat locked after a period of inactivity. Text you had not copied was cleared.")
      : null,
    h("p", { className: "lead" }, hasVault ? "Enter your passphrase to unlock your keys." : "Create a passphrase to protect your keys on this computer."),
    h("label", { for: "pass" }, hasVault ? "Passphrase" : "New passphrase"),
    pass,
    hasVault ? null : h("label", { for: "confirm" }, "Repeat passphrase"),
    hasVault ? null : confirm,
    hasVault ? null : h("p", { className: "hint" }, passphraseHint(minPassphrase)),
    go,
    msg,
  );

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (go.disabled) return;
    if (!hasVault && pass.value !== confirm.value) return say("The two passphrases do not match.");
    go.disabled = true;
    try {
      if (hasVault) await ctx.api.unlock(pass.value);
      else await ctx.api.createVault(pass.value);
      pass.value = confirm.value = "";
      onDone();
    } catch (e) {
      const err = ctx.fail(e);
      go.disabled = false;
      pass.value = "";
      if (err.code === "Throttled") wait(err.waitSecs ?? 5);
      else if (err.code === "InvalidInput" && !hasVault) say(minPassphrase > 1 ? `The passphrase must be at least ${minPassphrase} characters.` : "Enter a passphrase.");
      else say(describe(err));
    }
  });
  return form;
}
