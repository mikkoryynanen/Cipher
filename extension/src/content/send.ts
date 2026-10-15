import type { Send } from "../shared/client";
import { ERROR_MESSAGES } from "../shared/messages";
import { currentChat, isInComposeBox, isSendControl, sendButton } from "../whatsapp/selectors";
import type { ChatTracker } from "./chat";
import { readCompose, writeCompose } from "./compose";

export interface SendDeps {
  send: Send;
  tracker: ChatTracker;
  notify: (message: string) => void;
  readText?: () => string;
  writeText?: (text: string) => boolean | Promise<boolean>;
  doc?: Document;
}

/**
 * Encrypts the compose box just before it is sent. Intercepts Enter and the
 * send button in the capture phase and FAILS CLOSED: whenever encryption is (or
 * might be) on and anything goes wrong, the send is blocked and plaintext is
 * never released.
 */
export class SendInterceptor {
  private bypass = false;
  private busy = false;
  private readText: () => string;
  private writeText: (text: string) => boolean | Promise<boolean>;
  private doc: Document;
  /** Listen on window: its capture phase runs before any listener WhatsApp adds to the document or elements. */
  private target: Window;

  constructor(private deps: SendDeps) {
    this.readText = deps.readText ?? readCompose;
    this.writeText = deps.writeText ?? writeCompose;
    this.doc = deps.doc ?? document;
    this.target = (this.doc.defaultView ?? this.doc) as Window;
  }

  start(): void {
    this.target.addEventListener("keydown", this.onKey, true);
    this.target.addEventListener("keypress", this.onKey, true);
    this.target.addEventListener("click", this.onClick, true);
  }

  stop(): void {
    this.target.removeEventListener("keydown", this.onKey, true);
    this.target.removeEventListener("keypress", this.onKey, true);
    this.target.removeEventListener("click", this.onClick, true);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.bypass || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    if (!isInComposeBox(e.target)) return;
    this.intercept(e);
  };

  private onClick = (e: MouseEvent): void => {
    if (this.bypass || !isSendControl(e.target)) return;
    this.intercept(e);
  };

  /** Encryption is definitely off for the open chat (or there is nothing to send). */
  private surelyPlain(text: string): boolean {
    if (!text.trim()) return true;
    const chat = currentChat();
    if (!chat) return true; // encryption cannot be enabled without a known chat
    const { chat: known, settings } = this.deps.tracker.state;
    return known?.id === chat.id && settings !== null && !settings.enabled;
  }

  private intercept(e: Event): void {
    if (this.surelyPlain(this.readText())) return;
    console.info("[CipherChat] intercepted send");
    // Block first, decide afterwards. Anything unclear stays blocked.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.busy) return;
    this.busy = true;
    void this.process().finally(() => (this.busy = false));
  }

  private async process(): Promise<void> {
    const original = this.readText();
    const chat = currentChat();
    if (!chat) return this.deps.notify("CipherChat: can't tell which chat is open. Message not sent.");
    try {
      const r = await this.deps.send({ type: "prepareSend", chatId: chat.id, text: original });
      if (!r.ok) return this.deps.notify(`CipherChat: ${ERROR_MESSAGES[r.error]}. Message not sent.`);
      if (r.passthrough) return this.release();
      if (this.readText() !== original) {
        return this.deps.notify("CipherChat: the message changed while encrypting. Message not sent.");
      }
      if (!(await this.writeText(r.text)) || this.readText() !== r.text) {
        await this.writeText(original);
        return this.deps.notify("CipherChat: couldn't encrypt the message in the compose box. Message not sent.");
      }
      this.release();
    } catch {
      this.deps.notify("CipherChat: encryption failed. Message not sent.");
    }
  }

  /** Trigger the real send once the compose box holds what should be sent. */
  private release(): void {
    const button = sendButton(this.doc);
    if (!button) return this.deps.notify("CipherChat: send button not found. Message not sent.");
    this.bypass = true;
    try {
      button.click();
    } finally {
      this.bypass = false;
    }
  }
}
