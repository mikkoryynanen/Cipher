import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, button, click, fakeApi, flush, mount } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tabs = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>(".tab"));
const selected = (root: HTMLElement) => tabs(root).findIndex((t) => t.getAttribute("aria-selected") === "true");

function press(el: HTMLElement, key: string, mods: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
}

describe("tabs", () => {
  it("are Messages, Keys and Settings", async () => {
    const { root } = await mount(fakeApi());
    expect(tabs(root).map((t) => t.textContent)).toEqual(["Messages", "Keys", "Settings"]);
  });

  it("move with the arrow keys, wrapping around, with a roving tabindex", async () => {
    const { root } = await mount(fakeApi());
    const t = tabs(root);
    expect(t.map((x) => x.tabIndex)).toEqual([0, -1, -1]);
    press(t[0] as HTMLElement, "ArrowRight");
    expect(selected(root)).toBe(1);
    expect(document.activeElement).toBe(t[1]);
    press(t[1] as HTMLElement, "ArrowLeft");
    press(t[0] as HTMLElement, "ArrowLeft");
    expect(selected(root)).toBe(2);
    expect(t.map((x) => x.tabIndex)).toEqual([-1, -1, 0]);
    press(t[2] as HTMLElement, "Home");
    expect(selected(root)).toBe(0);
  });

  it("switch with Ctrl/Cmd+1..3 and ignore other keys", async () => {
    const { root } = await mount(fakeApi());
    press($(root, "#enc-input"), "2", { ctrlKey: true });
    expect(selected(root)).toBe(1);
    press($(root, "#add-label"), "3", { metaKey: true });
    expect(selected(root)).toBe(2);
    press($(root, "#set-timeout"), "1", { ctrlKey: true });
    expect(selected(root)).toBe(0);
    press($(root, "#enc-input"), "2");
    press($(root, "#enc-input"), "4", { ctrlKey: true });
    expect(selected(root)).toBe(0);
  });
});

describe("settings", () => {
  it("saving the auto-copy switch is picked up by the Messages page", async () => {
    let settings = { timeoutSecs: 30, clearPlaintext: true, clearCiphertext: false, autoCopyCiphertext: true };
    const api = fakeApi({
      getClipboardSettings: async () => settings,
      setClipboardSettings: async (s) => (settings = s),
    });
    const { root } = await mount(api);
    await click(button(root, "Settings"));
    $<HTMLInputElement>(root, "#set-autocopy").checked = false;
    await click(button(root, "Save"));
    expect(root.textContent).toContain("Saved.");
    await click(button(root, "Messages"));
    $<HTMLTextAreaElement>(root, "#enc-input").value = "hello";
    await click($(root, "#encrypt"));
    expect(api.copy).not.toHaveBeenCalled();
  });
});

describe("lock reason", () => {
  it("explains an inactivity lock on the unlock screen", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    api.emitLocked();
    await flush();
    expect(root.querySelector("form")).not.toBeNull();
    expect(root.textContent).toContain("locked after a period of inactivity");
  });

  it("shows no warning after the user pressed Lock, even if the event arrives late", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    await click(button(root, "Lock"));
    api.emitLocked();
    await flush();
    expect(root.querySelector(".warning")).toBeNull();
  });

  it("forgets the reason once the user has unlocked again", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    api.emitLocked();
    await flush();
    $(root, "form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await click(button(root, "Lock"));
    expect(root.querySelector(".warning")).toBeNull();
  });
});
