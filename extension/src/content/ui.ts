import type { Send } from "../shared/client";
import { ERROR_MESSAGES, type KeyInfo } from "../shared/messages";
import { indicatorHost } from "../whatsapp/selectors";
import type { ChatState, ChatTracker } from "./chat";

const ID = "cipherchat-toggle";

/** Transient message shown at the bottom of the page. */
export function toast(message: string, doc: Document = document): void {
  const el = doc.createElement("div");
  el.setAttribute("role", "alert");
  el.className = "cipherchat-toast";
  el.textContent = message;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "80px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    background: "#b91c1c",
    color: "#fff",
    padding: "8px 14px",
    borderRadius: "8px",
    font: "13px system-ui, sans-serif",
    maxWidth: "80vw",
  });
  doc.body.append(el);
  setTimeout(() => el.remove(), 6000);
}

/** Per-chat on/off toggle with a lock indicator, mounted next to the compose box. */
export class ChatToggle {
  private root: HTMLElement | undefined;
  private button!: HTMLButtonElement;
  private select!: HTMLSelectElement;
  private keys: KeyInfo[] = [];

  constructor(
    private send: Send,
    private tracker: ChatTracker,
    private notify: (m: string) => void = toast,
    private doc: Document = document,
  ) {
    tracker.onChange(() => void this.render());
  }

  /** (Re)mount if WhatsApp re-rendered the footer, then draw. */
  async ensureMounted(): Promise<void> {
    if (this.root?.isConnected) return;
    const host = indicatorHost(this.doc);
    if (!host) return;
    this.root = this.doc.createElement("span");
    this.root.id = ID;
    Object.assign(this.root.style, { display: "inline-flex", gap: "4px", padding: "0 8px", alignItems: "center" });
    this.button = this.doc.createElement("button");
    this.button.type = "button";
    this.button.onclick = () => void this.toggle();
    this.select = this.doc.createElement("select");
    this.select.title = "Key for this chat";
    this.select.onchange = () => void this.pickKey();
    this.root.append(this.button, this.select);
    host.prepend(this.root);
    await this.render();
  }

  async render(): Promise<void> {
    if (!this.root?.isConnected) return;
    const { chat, settings, unlocked } = this.tracker.state;
    if (unlocked) {
      const r = await this.send({ type: "listKeys" });
      this.keys = r.ok ? r.keys : [];
    } else {
      this.keys = [];
    }
    const enabled = settings?.enabled ?? false;
    let label = enabled ? "🔒 ON" : "🔓 OFF";
    let title = enabled ? "Messages in this chat are encrypted. Click to turn off." : "Click to encrypt messages in this chat.";
    let disabled = false;
    if (!chat) {
      disabled = true;
      title = "Open a chat to enable encryption (the chat name could not be read).";
    } else if (chat.isGroup) {
      disabled = true;
      title = ERROR_MESSAGES.GroupNotSupported + ".";
    } else if (enabled && !unlocked) {
      label = "⚠ LOCKED";
      title = "Encryption is on but CipherChat is locked. Unlock it in the extension popup; sends are blocked until then.";
    }
    this.button.textContent = label;
    this.button.title = title;
    this.button.disabled = disabled;
    this.button.dataset.state = !chat ? "unavailable" : chat.isGroup ? "group" : enabled ? (unlocked ? "on" : "locked") : "off";
    const look = {
      on: ["#0f766e", "#fff", "ON – messages are encrypted"],
      locked: ["#b45309", "#fff", "LOCKED – sends blocked"],
      off: ["#e5e7eb", "#374151", "OFF – messages sent as plain text"],
      group: ["#e5e7eb", "#9ca3af", "n/a"],
      unavailable: ["#e5e7eb", "#9ca3af", "n/a"],
    }[this.button.dataset.state as "on"];
    Object.assign(this.button.style, {
      background: look[0],
      color: look[1],
      border: "none",
      borderRadius: "14px",
      padding: "4px 10px",
      font: "600 12px system-ui, sans-serif",
      cursor: disabled ? "not-allowed" : "pointer",
    });
    if (!disabled) this.button.title = `${look[2]}. Click to ${enabled ? "turn off" : "turn on"}.`;
    this.select.hidden = disabled || this.keys.length === 0;
    this.select.replaceChildren(
      ...this.keys.map((k) => {
        const o = this.doc.createElement("option");
        o.value = k.id;
        o.textContent = k.label;
        o.selected = k.id === settings?.keyId;
        return o;
      }),
    );
  }

  private async toggle(): Promise<void> {
    const { chat, settings, unlocked } = this.tracker.state;
    if (!chat) return;
    if (settings?.enabled) {
      await this.save({ enabled: false });
      return;
    }
    if (!unlocked) return this.notify("CipherChat: unlock it in the extension popup first.");
    const keyId = this.select.value || settings?.keyId || this.keys[0]?.id;
    if (!keyId) return this.notify("CipherChat: add a key in the extension popup first.");
    await this.save({ enabled: true, keyId });
  }

  private async pickKey(): Promise<void> {
    if (this.select.value) await this.save({ keyId: this.select.value });
  }

  private async save(change: { enabled?: boolean; keyId?: string }): Promise<void> {
    const { chat } = this.tracker.state;
    if (!chat) return;
    const r = await this.send({ type: "setChat", chatId: chat.id, isGroup: chat.isGroup, ...change });
    if (!r.ok) this.notify(`CipherChat: ${ERROR_MESSAGES[r.error]}.`);
    await this.tracker.refresh(true);
  }
}
