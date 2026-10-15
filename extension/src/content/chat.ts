import type { Send } from "../shared/client";
import type { ChatSettings } from "../shared/messages";
import { currentChat, type ChatRef } from "../whatsapp/selectors";

export interface ChatState {
  chat: ChatRef | null;
  /** null while loading from the service worker. */
  settings: ChatSettings | null;
  unlocked: boolean;
}

/** Keeps a synchronous view of the open chat's encryption settings. */
export class ChatTracker {
  state: ChatState = { chat: null, settings: null, unlocked: false };
  private listeners = new Set<(s: ChatState) => void>();
  private loading = 0;

  constructor(private send: Send) {}

  onChange(fn: (s: ChatState) => void): void {
    this.listeners.add(fn);
  }

  /** Re-read the open chat; fetch settings if it changed or `force` is set. */
  async refresh(force = false): Promise<void> {
    const chat = currentChat();
    const same = chat?.id === this.state.chat?.id;
    if (same && !force) return;
    this.state = { chat, settings: same ? this.state.settings : null, unlocked: this.state.unlocked };
    this.emit();
    if (!chat) return;
    const ticket = ++this.loading;
    const r = await this.send({ type: "getChat", chatId: chat.id });
    if (ticket !== this.loading || !r.ok) return;
    this.state = { chat, settings: r.settings, unlocked: r.unlocked };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}
