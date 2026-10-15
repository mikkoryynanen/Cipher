/**
 * The ONLY module that knows WhatsApp Web's DOM. If WhatsApp changes its
 * markup, fix it here and nowhere else (tests/selectors.test.ts enforces this).
 *
 * Each selector is a list of fallbacks tried in order.
 */

const SELECTORS = {
  /** Element holding the text of a message; always inside a message row. */
  messageText: [
    "[data-id] span.selectable-text.copyable-text",
    "[data-id] span.selectable-text",
    "[data-id] .copyable-text span",
  ],
  /** Elements carrying "[time, date] Sender: " for the message they wrap. */
  authored: ["[data-pre-plain-text]"],
  conversationHeader: ["#main header", "header"],
  /** The chat name inside the header. */
  chatTitle: [
    '#main header [data-testid="conversation-info-header-chat-title"]',
    '#main header span[dir="auto"][title]',
    '#main header span[title]',
    '#main header span[dir="auto"]',
  ],
  composeBox: [
    'footer div[contenteditable="true"][data-tab="10"]',
    'footer div[contenteditable="true"][role="textbox"]',
    'footer div[contenteditable="true"]',
  ],
  sendButton: [
    'footer button[aria-label="Send"]',
    "footer button:has(span[data-icon='send'])",
    "footer [data-icon='send']",
  ],
  footer: ["#main footer", "footer"],
  footerButtons: ["footer button", "footer [role='button']"],
} as const;

type Name = keyof typeof SELECTORS;

function all(name: Name, root: ParentNode): HTMLElement[] {
  for (const sel of SELECTORS[name]) {
    const found = Array.from(root.querySelectorAll<HTMLElement>(sel));
    if (found.length) return found;
  }
  return [];
}

function first(name: Name, root: ParentNode): HTMLElement | null {
  return all(name, root)[0] ?? null;
}

function closest(name: Name, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  for (const sel of SELECTORS[name]) {
    const hit = target.closest<HTMLElement>(sel);
    if (hit) return hit;
  }
  return null;
}

/** Elements that may contain message text (callers check the content). */
export function messageTextElements(root: ParentNode = document): HTMLElement[] {
  return all("messageText", root);
}

export interface ChatRef {
  /** Chat identifier: the chat name shown in the header (WhatsApp exposes no JID). */
  id: string;
  /** True when the chat looks like anything other than a 1:1 chat. */
  isGroup: boolean;
}

function senders(root: ParentNode): Set<string> {
  const out = new Set<string>();
  for (const el of all("authored", root)) {
    const m = /\]\s*(.*?):\s*$/.exec(el.getAttribute("data-pre-plain-text") ?? "");
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}

/**
 * The open chat, or null when it cannot be determined. Groups are detected
 * heuristically (member list in the header, or more than two distinct senders
 * on screen), so this errs towards calling a chat a group.
 */
export function currentChat(root: ParentNode = document): ChatRef | null {
  const titleEl = first("chatTitle", root);
  const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "").trim();
  if (!title) return null;
  const header = first("conversationHeader", root);
  const subtitle = (header?.textContent ?? "").replace(title, "");
  const isGroup = subtitle.includes(",") || senders(root).size > 2;
  return { id: `title:${title}`, isGroup };
}

export function composeBox(root: ParentNode = document): HTMLElement | null {
  return first("composeBox", root);
}

/**
 * The send button. WhatsApp's labels and icons change, so besides the known
 * ones we use position: once text is typed, send is the last footer button
 * (it replaces the voice-message button). Our own toggle is excluded.
 */
export function sendButton(root: ParentNode = document): HTMLElement | null {
  const el = first("sendButton", root);
  if (el) return el.closest("button") ?? el;
  const buttons = all("footerButtons", root).filter((b) => !b.closest("#cipherchat-toggle"));
  return buttons.at(-1) ?? null;
}

/** Where to mount the CipherChat toggle. */
export function indicatorHost(root: ParentNode = document): HTMLElement | null {
  return first("footer", root);
}

export function isInComposeBox(target: EventTarget | null): boolean {
  return closest("composeBox", target) !== null;
}

export function isSendControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest("#cipherchat-toggle")) return false;
  const send = sendButton(target.ownerDocument);
  if (!send) return false;
  const hit = target.closest("button, [role='button']");
  return send === target || send.contains(target) || (hit !== null && hit === send);
}
