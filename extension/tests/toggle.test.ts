// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ChatTracker } from "../src/content/chat";
import { ChatToggle } from "../src/content/ui";
import { loadFixture } from "./fixtures";
import { makeService, ok } from "./helpers";

const btn = () => document.querySelector<HTMLButtonElement>("#cipherchat-toggle button")!;
const sel = () => document.querySelector<HTMLSelectElement>("#cipherchat-toggle select")!;

async function setup(fixture = "chat-1to1.html", opts: { withKey?: boolean; unlock?: boolean; service?: ReturnType<typeof makeService> } = {}) {
  const t = opts.service ?? makeService();
  if (opts.unlock !== false) await ok(t.service.handle({ type: "unlock", passphrase: "unlock-pass" }));
  let key;
  if (opts.withKey !== false && opts.unlock !== false) {
    key = (await ok(t.service.handle({ type: "addKey", label: "Alice", source: { kind: "generate" } }))).key;
  }
  loadFixture(fixture, { __CIPHER_1__: "x", __CIPHER_2__: "y" });
  const send = ((req: never) => t.service.handle(req)) as never;
  const tracker = new ChatTracker(send);
  const notify = vi.fn();
  const toggle = new ChatToggle(send, tracker, notify);
  await tracker.refresh(true);
  await toggle.ensureMounted();
  return { ...t, key, tracker, toggle, notify, send };
}

describe("per-chat toggle and indicator (6.4)", () => {
  it("defaults to off, and turning on shows the locked indicator", async () => {
    const w = await setup();
    expect(btn().dataset.state).toBe("off");
    expect(btn().textContent).toBe("🔓 OFF");
    btn().click();
    await vi.waitFor(() => expect(btn().dataset.state).toBe("on"));
    expect(btn().textContent).toBe("🔒 ON");
    expect(w.tracker.state.settings).toEqual({ enabled: true, keyId: w.key!.id });
  });

  it("persists per chat across reloads", async () => {
    const first = await setup();
    btn().click();
    await vi.waitFor(() => expect(btn().dataset.state).toBe("on"));
    // New page load: fresh tracker/UI over the same storage.
    await setup("chat-1to1.html", { service: first, unlock: false });
    expect(btn().dataset.state).toBe("on");
  });

  it("turns off again, and states are per chat", async () => {
    const w = await setup();
    btn().click();
    await vi.waitFor(() => expect(btn().dataset.state).toBe("on"));
    btn().click();
    await vi.waitFor(() => expect(btn().dataset.state).toBe("off"));
    const other = await ok(w.service.handle({ type: "getChat", chatId: "someone-else@c.us" }));
    expect(other.settings.enabled).toBe(false);
  });

  it("cannot be enabled in group chats", async () => {
    const w = await setup("chat-group.html");
    expect(btn().dataset.state).toBe("group");
    expect(btn().disabled).toBe(true);
    expect(btn().title).toContain("group");
    // The service refuses as well, independent of the UI.
    expect(
      await w.service.handle({ type: "setChat", chatId: "g@g.us", keyId: w.key!.id, enabled: true, isGroup: true }),
    ).toEqual({ ok: false, error: "GroupNotSupported" });
  });

  it("is unavailable when the open chat cannot be identified", async () => {
    await setup();
    document.querySelectorAll("header span").forEach((e) => e.remove());
    const t = makeService();
    const send = ((r: never) => t.service.handle(r)) as never;
    const tracker = new ChatTracker(send);
    const toggle = new ChatToggle(send, tracker, vi.fn());
    document.getElementById("cipherchat-toggle")?.remove();
    await tracker.refresh(true);
    await toggle.ensureMounted();
    expect(btn().dataset.state).toBe("unavailable");
    expect(btn().disabled).toBe(true);
  });

  it("explains instead of enabling when locked or keyless", async () => {
    const locked = await setup("chat-1to1.html", { unlock: false });
    btn().click();
    await vi.waitFor(() => expect(locked.notify).toHaveBeenCalled());
    expect(locked.notify.mock.calls[0]![0]).toContain("unlock");
    expect(btn().dataset.state).toBe("off");

    const keyless = await setup("chat-1to1.html", { withKey: false });
    btn().click();
    await vi.waitFor(() => expect(keyless.notify).toHaveBeenCalled());
    expect(keyless.notify.mock.calls[0]![0]).toContain("add a key");
  });

  it("shows Locked when enabled but the vault is locked", async () => {
    const w = await setup();
    btn().click();
    await vi.waitFor(() => expect(btn().dataset.state).toBe("on"));
    await w.service.handle({ type: "lock" });
    await w.tracker.refresh(true);
    await vi.waitFor(() => expect(btn().dataset.state).toBe("locked"));
    expect(btn().textContent).toBe("⚠ LOCKED");
  });

  it("remounts after WhatsApp re-renders the footer", async () => {
    const w = await setup();
    document.querySelector("footer")!.innerHTML = "<div></div>";
    expect(document.getElementById("cipherchat-toggle")).toBeNull();
    await w.toggle.ensureMounted();
    expect(document.getElementById("cipherchat-toggle")).not.toBeNull();
  });

  it("only offers keys that exist, and switching the key persists", async () => {
    const w = await setup();
    const k2 = (await ok(w.service.handle({ type: "addKey", label: "Bob", source: { kind: "generate" } }))).key;
    await w.toggle.render();
    expect(Array.from(sel().options).map((o) => o.textContent)).toEqual(["Alice", "Bob"]);
    sel().value = k2.id;
    sel().dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(w.tracker.state.settings?.keyId).toBe(k2.id));
  });
});
