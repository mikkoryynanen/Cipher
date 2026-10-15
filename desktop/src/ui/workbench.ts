import type { DecryptItem, KeyInfo } from "../api";
import { copyButton, countdown } from "./copy";
import { h, info, problem, statusLine } from "./dom";
import { describe } from "./messages";
import type { Ctx, Panel } from "./types";

/**
 * Encrypt and decrypt on one page, sharing one key selector, so a conversation does not
 * need tab switching: type, encrypt (and copy), paste a reply, decrypt, reply.
 */
export function messagesPanel(ctx: Ctx): Panel {
  let keys: KeyInfo[] = [];
  let autoCopy = true;

  // ---- key selector and first-run guidance ----
  const select = h("select", { id: "msg-key", "aria-label": "Key" });
  const guide = h("div", { className: "guide", hidden: true });
  const addKey = h("button", { type: "button" }, "Add a key");
  addKey.addEventListener("click", () => ctx.go("keys"));
  guide.append(
    h("strong", {}, "Start with a key"),
    h("p", {}, "A key is the shared secret that locks and unlocks your messages. You and your contact both need the same key. Create it here, then give it to your contact in person or by phone, never through the chat."),
    addKey,
  );
  const using = h("p", { className: "hint", id: "enc-using" });

  // ---- encrypt ----
  const input = h("textarea", { id: "enc-input", rows: "6", placeholder: "Type your message here", "aria-label": "Message" });
  const output = h("textarea", { id: "enc-output", rows: "4", readonly: true, "aria-label": "Encrypted message" });
  const encStatus = statusLine();
  const copyNote = statusLine();
  const result = h("div", { className: "result", hidden: true }, output, copyButton(ctx, "ciphertext", () => output.value, copyNote, "Copy encrypted message"), copyNote);
  const encrypt = h("button", { type: "button", id: "encrypt" }, "Encrypt");
  const clear = h("button", { type: "button", className: "secondary" }, "Clear");

  // ---- decrypt ----
  const pasted = h("textarea", { id: "dec-input", rows: "6", placeholder: "Paste the encrypted message(s) here", "aria-label": "Encrypted message to read" });
  const decStatus = statusLine();
  const results = h("div", { className: "results" });
  const decrypt = h("button", { type: "button", id: "decrypt" }, "Decrypt");
  const paste = h("button", { type: "button", className: "secondary" }, "Paste & decrypt");

  function remember(id: string | undefined): void {
    if (id) ctx.session.lastKeyId = id;
  }

  function updateUsing(): void {
    const k = keys.find((x) => x.id === select.value);
    using.textContent = k ? `Encrypting with “${k.label}” (${k.fingerprint}).` : keys.length ? "Select a key to encrypt." : "";
  }

  async function refresh(): Promise<void> {
    try {
      keys = await ctx.api.listKeys();
      autoCopy = (await ctx.api.getClipboardSettings()).autoCopyCiphertext;
    } catch (e) {
      problem(encStatus, describe(ctx.fail(e)));
      return;
    }
    const keep = select.value;
    select.replaceChildren(
      h("option", { value: "" }, keys.length ? "Select a key…" : "No keys yet"),
      ...keys.map((k) => h("option", { value: k.id }, `${k.label} (${k.fingerprint})`)),
    );
    const has = (id: string | undefined) => !!id && keys.some((k) => k.id === id);
    if (has(keep)) select.value = keep;
    else if (keys.length === 1) select.value = (keys[0] as KeyInfo).id;
    else if (has(ctx.session.lastKeyId)) select.value = ctx.session.lastKeyId as string;
    else select.value = "";
    guide.hidden = keys.length > 0;
    updateUsing();
  }

  select.addEventListener("change", () => {
    remember(select.value);
    updateUsing();
  });

  async function runEncrypt(): Promise<void> {
    info(encStatus, "");
    info(copyNote, "");
    result.hidden = true;
    try {
      output.value = await ctx.api.encrypt(select.value || null, input.value);
    } catch (e) {
      output.value = "";
      problem(encStatus, describe(ctx.fail(e)));
      return;
    }
    remember(select.value);
    result.hidden = false;
    if (!autoCopy) return;
    try {
      const out = await ctx.api.copy("ciphertext", output.value);
      if (out.clearsInSecs) countdown(ctx, copyNote, out.clearsInSecs);
      else info(copyNote, "Copied. This is not cleared automatically.");
    } catch (e) {
      problem(copyNote, describe(ctx.fail(e)));
    }
  }

  function runClear(): void {
    input.value = "";
    output.value = "";
    result.hidden = true;
    info(encStatus, "");
    info(copyNote, "");
    input.focus();
  }

  function reply(keyId: string): void {
    if (keys.some((k) => k.id === keyId)) select.value = keyId;
    remember(keyId);
    updateUsing();
    input.value = "";
    input.focus();
  }

  function show(items: DecryptItem[]): void {
    const first = items.find((it) => it.status === "ok");
    if (first?.status === "ok") remember(first.keyId);
    results.replaceChildren(
      ...items.map((it) => {
        if (it.status === "error") return h("div", { className: "item error" }, describe(it.error));
        const note = statusLine();
        const replyBtn = h("button", { type: "button" }, "Reply");
        replyBtn.addEventListener("click", () => reply(it.keyId));
        return h(
          "div",
          { className: "item" },
          h("p", { className: "meta" }, `Decrypted with “${it.keyLabel}”`),
          h("pre", { className: "plain" }, it.text),
          h("div", { className: "row" }, replyBtn, copyButton(ctx, "plaintext", () => it.text, note, "Copy text")),
          note,
        );
      }),
    );
  }

  async function runDecrypt(source: () => Promise<DecryptItem[]>): Promise<void> {
    info(decStatus, "");
    results.replaceChildren();
    try {
      show(await source());
    } catch (e) {
      problem(decStatus, describe(ctx.fail(e)));
    }
  }

  const submitOnCtrlEnter = (el: HTMLElement, fn: () => void) =>
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        fn();
      }
    });
  submitOnCtrlEnter(input, () => void runEncrypt());
  submitOnCtrlEnter(pasted, () => void runDecrypt(() => ctx.api.decrypt(pasted.value)));
  encrypt.addEventListener("click", () => void runEncrypt());
  clear.addEventListener("click", runClear);
  decrypt.addEventListener("click", () => void runDecrypt(() => ctx.api.decrypt(pasted.value)));
  paste.addEventListener("click", () => void runDecrypt(() => ctx.api.pasteAndDecrypt()));

  const el = h(
    "section",
    { className: "panel" },
    h("h2", {}, "Messages"),
    guide,
    h("label", { for: "msg-key" }, "Key"),
    select,
    h(
      "div",
      { className: "columns" },
      h(
        "div",
        { className: "col" },
        h("h3", {}, "Write"),
        h("label", { for: "enc-input" }, "Message"),
        input,
        using,
        h("div", { className: "row" }, encrypt, clear),
        encStatus,
        result,
      ),
      h(
        "div",
        { className: "col" },
        h("h3", {}, "Read"),
        h("label", { for: "dec-input" }, "Received message"),
        pasted,
        h("div", { className: "row" }, decrypt, paste),
        decStatus,
        results,
      ),
    ),
  );
  return { el, refresh };
}
