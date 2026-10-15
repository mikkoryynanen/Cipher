import { send as realSend, type Send } from "../shared/client";
import {
  ERROR_MESSAGES,
  type ErrorCode,
  type KeyInfo,
  type KeySource,
} from "../shared/messages";

type Props = Record<string, unknown>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  el.append(...children);
  return el;
}

const errorText = (e: ErrorCode) => ERROR_MESSAGES[e];
const MIN_PASSPHRASE = 8;

/** Build the popup UI inside `root`, talking to the service worker through `send`. */
export function mount(root: HTMLElement, send: Send = realSend): { refresh(): Promise<void> } {
  let keys: KeyInfo[] = [];
  let unlocked = false;
  let hasVault = false;

  // --- unlock -----------------------------------------------------------
  const unlockPass = h("input", { type: "password", id: "unlock-pass", placeholder: "Unlock passphrase" });
  const unlockBtn = h("button", { id: "unlock-btn" }, "Unlock");
  const unlockMsg = h("div", { id: "unlock-msg", class: "muted" });
  const unlockTitle = h("h2", {}, "Unlock");
  const unlockSection = h(
    "section",
    { id: "unlock-section" },
    unlockTitle,
    h("div", { class: "row" }, unlockPass, unlockBtn),
    unlockMsg,
  );
  const lockBtn = h("button", { id: "lock-btn" }, "Lock");
  const header = h("header", {}, h("h1", {}, "🔒 CipherChat"), lockBtn);

  // --- keys -------------------------------------------------------------
  const keyList = h("div", { id: "key-list" });
  const keyMsg = h("div", { id: "key-msg", class: "muted" });
  const exportBox = h("div", { id: "export-box", hidden: true });
  const addLabel = h("input", { id: "add-label", placeholder: "Label (e.g. Alice)" });
  const addKind = h(
    "select",
    { id: "add-kind" },
    h("option", { value: "generate" }, "Generate random key"),
    h("option", { value: "passphrase" }, "From shared passphrase + salt"),
    h("option", { value: "import" }, "Import exported key"),
  );
  const addPass = h("input", { id: "add-pass", type: "password", placeholder: "Shared passphrase" });
  const addSalt = h("input", { id: "add-salt", placeholder: "Salt (hex) – leave empty to create one" });
  const addImport = h("input", { id: "add-import", placeholder: "ck1-…" });
  const addBtn = h("button", { id: "add-btn" }, "Add key");
  const keysSection = h(
    "section",
    { id: "keys-section" },
    h("h2", {}, "Keys"),
    keyList,
    exportBox,
    addLabel,
    addKind,
    addPass,
    addSalt,
    addImport,
    addBtn,
    keyMsg,
  );

  // --- encrypt / decrypt ------------------------------------------------
  const encKey = h("select", { id: "enc-key" });
  const encIn = h("textarea", { id: "enc-in", placeholder: "Text to encrypt" });
  const encBtn = h("button", { id: "enc-btn" }, "Encrypt");
  const encOut = h("textarea", { id: "enc-out", readOnly: true, placeholder: "🔒1.… result" });
  const encCopy = h("button", { id: "enc-copy" }, "Copy");
  const encMsg = h("div", { id: "enc-msg", class: "muted" });
  const encSection = h(
    "section",
    { id: "enc-section" },
    h("h2", {}, "Encrypt"),
    encKey,
    encIn,
    h("div", { class: "row" }, encBtn, encCopy),
    encOut,
    encMsg,
  );
  const decIn = h("textarea", { id: "dec-in", placeholder: "Paste 🔒1.… message" });
  const decBtn = h("button", { id: "dec-btn" }, "Decrypt");
  const decOut = h("textarea", { id: "dec-out", readOnly: true, placeholder: "Plaintext result" });
  const decCopy = h("button", { id: "dec-copy" }, "Copy");
  const decMsg = h("div", { id: "dec-msg", class: "muted" });
  const decSection = h(
    "section",
    { id: "dec-section" },
    h("h2", {}, "Decrypt"),
    decIn,
    h("div", { class: "row" }, decBtn, decCopy),
    decOut,
    decMsg,
  );

  root.append(header, unlockSection, keysSection, encSection, decSection);

  // --- helpers ----------------------------------------------------------
  const say = (el: HTMLElement, text: string, kind: "muted" | "error" | "warn" = "muted") => {
    el.textContent = text;
    el.className = kind;
  };
  const sayError = (el: HTMLElement, e: ErrorCode) => say(el, errorText(e), "error");
  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

  function renderKeys() {
    keyList.replaceChildren(
      ...(keys.length === 0
        ? [h("div", { class: "muted" }, unlocked ? "No keys yet." : "Unlock to see keys.")]
        : keys.map((k) =>
            h(
              "div",
              { class: "key", "data-key-id": k.id },
              h("span", {}, `${k.label} `, h("code", {}, k.fingerprint)),
              h(
                "span",
                {},
                h("button", { class: "export-btn", onclick: () => void onExport(k) }, "Export"),
                " ",
                h("button", { class: "delete-btn", onclick: () => void onDelete(k) }, "Delete"),
              ),
            ),
          )),
    );
    encKey.replaceChildren(
      ...keys.map((k) => h("option", { value: k.id }, `${k.label} (${k.fingerprint})`)),
    );
  }

  function applyState() {
    const warnShort = !hasVault ? ` Choose a passphrase of at least ${MIN_PASSPHRASE} characters.` : "";
    unlockTitle.textContent = hasVault ? "Unlock" : "Create your vault";
    unlockBtn.textContent = hasVault ? "Unlock" : "Create";
    if (!unlocked && !unlockMsg.textContent) {
      say(unlockMsg, `Keys are locked.${warnShort}`);
    }
    unlockSection.hidden = unlocked;
    lockBtn.hidden = !unlocked;
    for (const el of [addLabel, addKind, addPass, addSalt, addImport, addBtn, encKey, encIn, encBtn, decIn, decBtn]) {
      (el as HTMLInputElement).disabled = !unlocked;
    }
    encCopy.disabled = decCopy.disabled = !unlocked;
    const kind = addKind.value;
    addPass.hidden = addSalt.hidden = kind !== "passphrase";
    addImport.hidden = kind !== "import";
    if (!unlocked) exportBox.hidden = true;
    encBtn.disabled = !unlocked || keys.length === 0;
    renderKeys();
  }

  async function refresh() {
    const st = await send({ type: "status" });
    if (!st.ok) return;
    unlocked = st.unlocked;
    hasVault = st.hasVault;
    keys = [];
    if (unlocked) {
      const r = await send({ type: "listKeys" });
      if (r.ok) keys = r.keys;
      else if (r.error === "Locked") unlocked = false;
    }
    applyState();
  }

  // --- handlers ---------------------------------------------------------
  async function onUnlock() {
    if (!hasVault && unlockPass.value.length < MIN_PASSPHRASE) {
      say(unlockMsg, `Passphrase too short (minimum ${MIN_PASSPHRASE} characters).`, "warn");
      return;
    }
    const r = await send({ type: "unlock", passphrase: unlockPass.value });
    if (!r.ok) return sayError(unlockMsg, r.error);
    unlockPass.value = "";
    unlockMsg.textContent = "";
    await refresh();
  }

  async function onAdd() {
    let source: KeySource;
    switch (addKind.value) {
      case "passphrase":
        source = { kind: "passphrase", passphrase: addPass.value, saltHex: addSalt.value.trim() || undefined };
        break;
      case "import":
        source = { kind: "import", exported: addImport.value };
        break;
      default:
        source = { kind: "generate" };
    }
    const r = await send({ type: "addKey", label: addLabel.value, source });
    if (!r.ok) return sayError(keyMsg, r.error);
    addLabel.value = addPass.value = addSalt.value = addImport.value = "";
    say(
      keyMsg,
      r.saltHex
        ? `Added ${r.key.fingerprint}. Salt (share with the passphrase, out of band): ${r.saltHex}`
        : `Added key ${r.key.fingerprint}.`,
    );
    await refresh();
  }

  async function onExport(k: KeyInfo) {
    const r = await send({ type: "exportKey", id: k.id });
    if (!r.ok) return sayError(keyMsg, r.error);
    exportBox.replaceChildren(
      h("div", { class: "warn" }, "⚠ Share this key out of band only (in person or another secure channel). Never send it through WhatsApp or any chat."),
      h("code", { id: "export-value" }, r.exported),
      h("div", {}, h("button", { onclick: () => copy(r.exported) }, "Copy")),
    );
    exportBox.hidden = false;
  }

  async function onDelete(k: KeyInfo) {
    if (typeof confirm === "function" && !confirm(`Delete key "${k.label}"? Messages using it can no longer be read.`)) return;
    const r = await send({ type: "deleteKey", id: k.id });
    if (!r.ok) return sayError(keyMsg, r.error);
    exportBox.hidden = true;
    await refresh();
  }

  async function onEncrypt() {
    const r = await send({ type: "encrypt", keyId: encKey.value, text: encIn.value });
    if (!r.ok) return sayError(encMsg, r.error);
    encOut.value = r.text;
    say(encMsg, "Encrypted. Copy the result and paste it into the chat.");
  }

  async function onDecrypt() {
    decOut.value = "";
    const r = await send({ type: "decrypt", text: decIn.value.trim() });
    if (!r.ok) return sayError(decMsg, r.error);
    decOut.value = r.text;
    say(decMsg, "Decrypted.");
  }

  unlockBtn.onclick = () => void onUnlock();
  unlockPass.onkeydown = (e) => { if (e.key === "Enter") void onUnlock(); };
  lockBtn.onclick = async () => { await send({ type: "lock" }); await refresh(); };
  addKind.onchange = applyState;
  addBtn.onclick = () => void onAdd();
  encBtn.onclick = () => void onEncrypt();
  decBtn.onclick = () => void onDecrypt();
  encCopy.onclick = () => void copy(encOut.value);
  decCopy.onclick = () => void copy(decOut.value);

  void refresh();
  return { refresh };
}

const root = typeof document !== "undefined" ? document.getElementById("app") : null;
if (root && typeof chrome !== "undefined" && chrome.runtime?.id) mount(root);
