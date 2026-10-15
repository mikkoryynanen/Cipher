// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatTracker } from "../src/content/chat";
import { extractText } from "../src/content/dom";
import { SendInterceptor } from "../src/content/send";
import { ERROR_MESSAGES } from "../src/shared/messages";
import { composeBox } from "../src/whatsapp/selectors";
import { loadFixture } from "./fixtures";
import { makeService, ok } from "./helpers";

const JID = "title:Alice";
const box = () => composeBox()!;
const setPlain = (text: string) => (box().innerHTML = `<p>${text}</p>`);
const fakeWrite = (text: string) => {
  setPlain(text);
  return true;
};

let interceptor: SendInterceptor | undefined;
afterEach(() => interceptor?.stop());

async function setup(opts: { enable?: boolean; lock?: boolean; fixture?: string; writeText?: (t: string) => boolean } = {}) {
  const t = makeService();
  await ok(t.service.handle({ type: "unlock", passphrase: "unlock-pass" }));
  const { key } = await ok(
    t.service.handle({ type: "addKey", label: "Alice", source: { kind: "generate" } }),
  );
  loadFixture(opts.fixture ?? "chat-1to1.html", { __CIPHER_1__: "x", __CIPHER_2__: "y" });
  if (opts.enable) {
    await ok(t.service.handle({ type: "setChat", chatId: JID, keyId: key.id, enabled: true }));
  }
  if (opts.lock) await t.service.handle({ type: "lock" });

  const send = ((req: never) => t.service.handle(req)) as never;
  const tracker = new ChatTracker(send);
  await tracker.refresh(true);
  const notify = vi.fn();
  interceptor = new SendInterceptor({ send, tracker, notify, writeText: opts.writeText ?? fakeWrite });
  interceptor.start();

  // Stand-in for WhatsApp's own handlers (bubble phase): records what would be sent.
  const sent: string[] = [];
  document.addEventListener("click", (e) => {
    if ((e.target as Element).closest("button")) sent.push(extractText(box()));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) sent.push(extractText(box()));
  });
  return { ...t, key, notify, sent, tracker };
}

const clickSend = () => {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  document.querySelector("button")!.dispatchEvent(ev);
  return ev;
};
const pressEnter = (shiftKey = false) => {
  const ev = new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true, cancelable: true });
  box().querySelector("p")!.dispatchEvent(ev);
  return ev;
};

describe("encrypt on send (6.3)", () => {
  it("sends only ciphertext via the send button", async () => {
    const w = await setup({ enable: true });
    setPlain("top secret plan");
    const ev = clickSend();
    expect(ev.defaultPrevented).toBe(true); // original click was blocked
    await vi.waitFor(() => expect(w.sent).toHaveLength(1));
    expect(w.sent[0]).toMatch(/^🔒1\./);
    expect(w.sent.join()).not.toContain("top secret");
    const dec = await ok(w.service.handle({ type: "decrypt", text: w.sent[0]! }));
    expect(dec.text).toBe("top secret plan");
  });

  it("sends only ciphertext when pressing Enter", async () => {
    const w = await setup({ enable: true });
    setPlain("via enter");
    expect(pressEnter().defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(w.sent).toHaveLength(1));
    expect(w.sent[0]).toMatch(/^🔒1\./);
    expect(w.sent.join()).not.toContain("via enter");
  });

  it("blocks and explains when storage is locked", async () => {
    const w = await setup({ enable: true, lock: true });
    setPlain("must not leak");
    clickSend();
    pressEnter();
    await vi.waitFor(() => expect(w.notify).toHaveBeenCalled());
    expect(w.notify.mock.calls[0]![0]).toContain(ERROR_MESSAGES.Locked);
    await new Promise((r) => setTimeout(r, 50));
    expect(w.sent).toEqual([]);
    expect(extractText(box())).toBe("must not leak");
  });

  it("blocks when the chat's key no longer exists", async () => {
    const w = await setup({ enable: true });
    await ok(w.service.handle({ type: "deleteKey", id: w.key.id }));
    setPlain("no key now");
    clickSend();
    await vi.waitFor(() => expect(w.notify).toHaveBeenCalled());
    expect(w.notify.mock.calls[0]![0]).toContain(ERROR_MESSAGES.NoSuchKey);
    expect(w.sent).toEqual([]);
  });

  it("blocks if the service worker call throws", async () => {
    const w = await setup({ enable: true });
    interceptor!.stop();
    const tracker = w.tracker;
    interceptor = new SendInterceptor({
      send: (() => Promise.reject(new Error("sw gone"))) as never,
      tracker,
      notify: w.notify,
      writeText: fakeWrite,
    });
    interceptor.start();
    setPlain("sw down");
    clickSend();
    await vi.waitFor(() => expect(w.notify).toHaveBeenCalled());
    expect(w.sent).toEqual([]);
  });

  it("blocks and restores the text if the compose box cannot be updated", async () => {
    for (const writeText of [() => false, (t: string) => (setPlain("garbled " + t.length), true)]) {
      const w = await setup({ enable: true, writeText });
      setPlain("original text");
      clickSend();
      await vi.waitFor(() => expect(w.notify).toHaveBeenCalled());
      expect(w.sent).toEqual([]);
      interceptor!.stop();
    }
  });

  it("blocks while the chat's settings are still unknown (fail closed)", async () => {
    const w = await setup({ enable: true });
    w.tracker.state = { ...w.tracker.state, settings: null };
    setPlain("racing");
    const ev = clickSend();
    expect(ev.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(w.sent).toHaveLength(1));
    expect(w.sent[0]).toMatch(/^🔒1\./);
  });
});

describe("passthrough when encryption is off", () => {
  it("does not touch sends in chats with encryption off", async () => {
    const w = await setup();
    setPlain("hello plain");
    const ev = clickSend();
    expect(ev.defaultPrevented).toBe(false);
    expect(w.sent).toEqual(["hello plain"]);
  });

  it("lets Shift+Enter (newline) and empty sends through", async () => {
    const w = await setup({ enable: true });
    setPlain("multi");
    expect(pressEnter(true).defaultPrevented).toBe(false);
    box().innerHTML = "<p><br></p>";
    expect(clickSend().defaultPrevented).toBe(false);
    expect(w.notify).not.toHaveBeenCalled();
  });

  it("stale cache for another chat falls back to the service worker's answer", async () => {
    const w = await setup();
    w.tracker.state = { chat: { id: "someone-else@c.us", isGroup: false }, settings: { enabled: false, keyId: null }, unlocked: true };
    setPlain("plain via passthrough");
    clickSend();
    await vi.waitFor(() => expect(w.sent).toEqual(["plain via passthrough"]));
  });
});
