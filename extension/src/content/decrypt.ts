import type { Send } from "../shared/client";
import { ERROR_MESSAGES, SHORT_REASONS, type ErrorCode } from "../shared/messages";
import { messageTextElements } from "../whatsapp/selectors";
import { extractText } from "./dom";

const PREFIX = "🔒1.";

interface Rendered {
  /** The ciphertext this element showed before we replaced it. */
  cipher: string;
  /** Our own output as read back from the DOM; used to recognise it again. */
  output: string;
  /** Locked placeholders are retried once the vault is unlocked. */
  retry: boolean;
}

/** Decrypts `🔒1.` messages in place, including ones that load later. */
export class MessageDecryptor {
  private rendered = new WeakMap<Element, Rendered>();
  private busy = new WeakSet<Element>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | undefined;

  constructor(
    private send: Send,
    private root: Document = document,
  ) {}

  start(): void {
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.root.body, { childList: true, subtree: true, characterData: true });
    this.schedule();
  }

  stop(): void {
    this.observer?.disconnect();
    clearTimeout(this.timer);
  }

  /** Re-decrypt placeholders that were waiting for an unlock or key change. */
  retryPlaceholders(): void {
    this.schedule(true);
  }

  private retryNext = false;

  private schedule(retry = false): void {
    this.retryNext ||= retry;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const r = this.retryNext;
      this.retryNext = false;
      void this.scan(r);
    }, 50);
  }

  async scan(retry = false): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const el of messageTextElements(this.root)) {
      if (this.busy.has(el)) continue;
      const text = extractText(el);
      const prev = this.rendered.get(el);

      let cipher: string;
      if (prev && text === prev.output) {
        // Our own output: leave it alone unless it is a placeholder worth retrying.
        if (!(retry && prev.retry)) continue;
        cipher = prev.cipher;
      } else if (text.trim().startsWith(PREFIX)) {
        cipher = text.trim();
      } else {
        continue;
      }
      jobs.push(this.process(el, cipher));
    }
    await Promise.all(jobs);
  }

  private async process(el: HTMLElement, cipher: string): Promise<void> {
    this.busy.add(el);
    try {
      const r = await this.send({ type: "decrypt", text: cipher });
      const current = extractText(el);
      const prev = this.rendered.get(el);
      // The page re-rendered while we waited; the next scan will pick it up.
      if (current !== cipher && current !== prev?.output) return;
      if (r.ok) this.show(el, cipher, r.text);
      else this.showError(el, cipher, r.error);
    } finally {
      this.busy.delete(el);
    }
  }

  private show(el: HTMLElement, cipher: string, plaintext: string): void {
    const body = this.root.createElement("span");
    body.className = "cipherchat-plain";
    body.style.whiteSpace = "pre-wrap";
    body.textContent = plaintext;
    el.replaceChildren(body);
    this.rendered.set(el, { cipher, output: extractText(el), retry: false });
  }

  private showError(el: HTMLElement, cipher: string, code: ErrorCode): void {
    const note = this.root.createElement("span");
    note.className = "cipherchat-error";
    note.title = ERROR_MESSAGES[code];
    note.style.fontStyle = "italic";
    note.textContent = `🔒 [${SHORT_REASONS[code]}]`;
    el.replaceChildren(note);
    this.rendered.set(el, { cipher, output: extractText(el), retry: code === "Locked" || code === "UnknownKey" });
  }
}
