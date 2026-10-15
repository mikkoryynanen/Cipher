import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyInfo } from "../src/api";
import { $, button, click, err, fakeApi, flush, mount, type } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ALEX: KeyInfo = { id: "aabbccdd", label: "Alex", fingerprint: "1234-5678" };
const SAM: KeyInfo = { id: "11223344", label: "Sam", fingerprint: "9999-0000" };

const keySelect = (root: HTMLElement) => $<HTMLSelectElement>(root, "#msg-key");
const status = (root: HTMLElement) => root.querySelector<HTMLElement>(".col .status");

function press(el: HTMLElement, key: string, mods: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
}

describe("one page for both directions", () => {
  it("has the key selector, the write box and the read box without switching tabs", async () => {
    const { root } = await mount(fakeApi());
    expect(Array.from(root.querySelectorAll(".tab")).map((t) => t.textContent)).toEqual(["Messages", "Keys", "Settings"]);
    const page = $(root, "#enc-input").closest("section");
    expect(page?.contains($(root, "#dec-input"))).toBe(true);
    expect(page?.contains(keySelect(root))).toBe(true);
    expect(page?.hidden).toBe(false);
  });

  it("encrypts and decrypts from the same panel", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    type($(root, "#enc-input"), "hello");
    await click($(root, "#encrypt"));
    expect(api.encrypt).toHaveBeenCalledWith("aabbccdd", "hello");
    expect($<HTMLTextAreaElement>(root, "#enc-output").value).toBe("ENC(hello)");
    type($(root, "#dec-input"), "whatever");
    await click($(root, "#decrypt"));
    expect(api.decrypt).toHaveBeenCalledWith("whatever");
    expect(root.querySelector(".plain")?.textContent).toBe("the secret text");
    expect(root.textContent).toContain("Decrypted with “Alex”");
  });
});

describe("key preselection", () => {
  it("selects the only key", async () => {
    const { root } = await mount(fakeApi());
    expect(keySelect(root).value).toBe("aabbccdd");
    expect(root.querySelector("#enc-using")?.textContent).toContain("Alex");
  });

  it("selects the last used key, also after a lock", async () => {
    const api = fakeApi({ listKeys: async () => [ALEX, SAM] });
    const { root } = await mount(api);
    expect(keySelect(root).value).toBe("");
    keySelect(root).value = SAM.id;
    type($(root, "#enc-input"), "hi");
    await click($(root, "#encrypt"));
    await click(button(root, "Lock"));
    const pass = $<HTMLInputElement>(root, "#pass");
    type(pass, "right passphrase");
    $(root, "form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(keySelect(root).value).toBe(SAM.id);
  });

  it("selects nothing when the remembered key was deleted", async () => {
    let keys = [ALEX, SAM];
    const api = fakeApi({ listKeys: async () => keys });
    const { root } = await mount(api);
    keySelect(root).value = SAM.id;
    type($(root, "#enc-input"), "hi");
    await click($(root, "#encrypt"));
    keys = [ALEX, { ...SAM, id: "55555555" }];
    await click(button(root, "Keys"));
    await click(button(root, "Messages"));
    keySelect(root).value = "";
    await click(button(root, "Keys"));
    await click(button(root, "Messages"));
    expect(keySelect(root).value).toBe("");
  });

  it("requires a key and shows the backend's reason next to the action", async () => {
    const api = fakeApi({ listKeys: async () => [ALEX, SAM], encrypt: async () => { throw err("NoKey"); } });
    const { root } = await mount(api);
    type($(root, "#enc-input"), "hello");
    await click($(root, "#encrypt"));
    expect(api.encrypt).toHaveBeenCalledWith(null, "hello");
    expect(status(root)?.textContent).toBe("Select a key first.");
    expect(status(root)?.classList.contains("error")).toBe(true);
  });
});

describe("automatic copy", () => {
  it("copies the encrypted message right away when the setting is on", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    type($(root, "#enc-input"), "hello");
    await click($(root, "#encrypt"));
    expect(api.copy).toHaveBeenCalledWith("ciphertext", "ENC(hello)");
    expect(root.textContent).toContain("cleared in 30 s");
  });

  it("says so when the copy is not cleared automatically", async () => {
    const api = fakeApi({ copy: async () => ({ clearsInSecs: null }) });
    const { root } = await mount(api);
    type($(root, "#enc-input"), "hello");
    await click($(root, "#encrypt"));
    expect(root.textContent).toContain("not cleared automatically");
  });

  it("leaves the clipboard alone when the setting is off, until Copy is pressed", async () => {
    const api = fakeApi({ getClipboardSettings: async () => ({ timeoutSecs: 30, clearPlaintext: true, clearCiphertext: false, autoCopyCiphertext: false }) });
    const { root } = await mount(api);
    type($(root, "#enc-input"), "hello");
    await click($(root, "#encrypt"));
    expect($<HTMLTextAreaElement>(root, "#enc-output").value).toBe("ENC(hello)");
    expect(api.copy).not.toHaveBeenCalled();
    await click(button(root, "Copy encrypted message"));
    expect(api.copy).toHaveBeenCalledWith("ciphertext", "ENC(hello)");
  });

  it("copies nothing when encryption fails", async () => {
    const api = fakeApi({ encrypt: async () => { throw err("InvalidInput"); } });
    const { root } = await mount(api);
    await click($(root, "#encrypt"));
    expect(api.copy).not.toHaveBeenCalled();
    expect(status(root)?.textContent).toBe("That input is not valid.");
  });
});

describe("keyboard and clearing", () => {
  it("Ctrl/Cmd+Enter encrypts from the message field", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    type($(root, "#enc-input"), "hello");
    press($(root, "#enc-input"), "Enter", { ctrlKey: true });
    await flush();
    expect(api.encrypt).toHaveBeenCalledWith("aabbccdd", "hello");
    press($(root, "#enc-input"), "Enter");
    await flush();
    expect(api.encrypt).toHaveBeenCalledTimes(1);
  });

  it("Ctrl/Cmd+Enter decrypts from the received-message field", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    type($(root, "#dec-input"), "pasted text");
    press($(root, "#dec-input"), "Enter", { metaKey: true });
    await flush();
    expect(api.decrypt).toHaveBeenCalledWith("pasted text");
  });

  it("Clear empties the message and the result", async () => {
    const { root } = await mount(fakeApi());
    type($(root, "#enc-input"), "hello");
    await click($(root, "#encrypt"));
    await click(button(root, "Clear"));
    expect($<HTMLTextAreaElement>(root, "#enc-input").value).toBe("");
    expect($<HTMLTextAreaElement>(root, "#enc-output").value).toBe("");
    expect($(root, ".result").hidden).toBe(true);
  });
});

describe("decrypting", () => {
  it("shows every message separately, with reasons for the ones that fail", async () => {
    const api = fakeApi({
      decrypt: async () => [
        { status: "ok", text: "one", keyId: "a", keyLabel: "Alex" },
        { status: "error", error: "UnknownKey" },
        { status: "error", error: "Tampered" },
        { status: "error", error: "UnknownVersion" },
        { status: "ok", text: "two", keyId: "a", keyLabel: "Alex" },
      ],
    });
    const { root } = await mount(api);
    await click($(root, "#decrypt"));
    const items = Array.from(root.querySelectorAll(".item"));
    expect(items).toHaveLength(5);
    expect(items[1]?.textContent).toBe("You do not have the key for this message.");
    expect(items[2]?.textContent).toContain("altered or damaged");
    expect(items[3]?.textContent).toContain("Update CipherChat");
  });

  it("reports 'not a CipherChat message' for plain text", async () => {
    const api = fakeApi({ decrypt: async () => { throw err("NotOurFormat"); } });
    const { root } = await mount(api);
    type($(root, "#dec-input"), "hello");
    await click($(root, "#decrypt"));
    expect(root.textContent).toContain("That is not a CipherChat message.");
  });

  it("paste & decrypt uses the backend's clipboard read, and only when pressed", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    $<HTMLTextAreaElement>(root, "#dec-input").focus();
    expect(api.pasteAndDecrypt).not.toHaveBeenCalled();
    await click(button(root, "Paste & decrypt"));
    expect(api.pasteAndDecrypt).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".plain")?.textContent).toBe("pasted secret");
  });

  it("shows a ticking clipboard-clear countdown after copying plaintext", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    await click($(root, "#decrypt"));
    await click(button(root, "Copy text"));
    expect(api.copy).toHaveBeenCalledWith("plaintext", "the secret text");
    expect(root.textContent).toContain("cleared in 30 s");
    vi.advanceTimersByTime(10_000);
    expect(root.textContent).toContain("cleared in 20 s");
    vi.advanceTimersByTime(20_000);
    expect(root.textContent).toContain("Clipboard cleared.");
  });

  it("Reply selects the key that decrypted the message and focuses an empty message field", async () => {
    const api = fakeApi({
      listKeys: async () => [ALEX, SAM],
      decrypt: async () => [{ status: "ok", text: "yo", keyId: SAM.id, keyLabel: "Sam" }],
    });
    const { root } = await mount(api);
    document.body.append(root);
    type($(root, "#enc-input"), "old draft");
    await click($(root, "#decrypt"));
    await click(button(root, "Reply"));
    expect(keySelect(root).value).toBe(SAM.id);
    expect($<HTMLTextAreaElement>(root, "#enc-input").value).toBe("");
    expect(document.activeElement?.id).toBe("enc-input");
    expect(api.pasteAndDecrypt).not.toHaveBeenCalled();
  });
});

describe("first-run guidance", () => {
  it("explains keys and offers to add one when there are none", async () => {
    const { root } = await mount(fakeApi({ listKeys: async () => [] }));
    const guide = $(root, ".guide");
    expect(guide.hidden).toBe(false);
    expect(guide.textContent).toContain("never through the chat");
    await click(button(root, "Add a key"));
    expect($(root, "#add-label").closest("section")?.hidden).toBe(false);
    expect($(root, "#enc-input").closest("section")?.hidden).toBe(true);
  });

  it("is not shown once a key exists", async () => {
    const { root } = await mount(fakeApi());
    expect($(root, ".guide").hidden).toBe(true);
  });
});

describe("locking clears the screen", () => {
  async function filled() {
    const api = fakeApi();
    const m = await mount(api);
    type($(m.root, "#enc-input"), "PRIVATE-DRAFT-TEXT");
    await click($(m.root, "#encrypt"));
    type($(m.root, "#dec-input"), "PASTED-CIPHERTEXT");
    await click($(m.root, "#decrypt"));
    return { api, ...m };
  }

  function assertEmpty(root: HTMLElement, before: HTMLElement[]) {
    for (const f of before) expect((f as HTMLTextAreaElement).value, f.id).toBe("");
    const text = document.body.textContent ?? "";
    for (const secret of ["PRIVATE-DRAFT-TEXT", "PASTED-CIPHERTEXT", "the secret text", "ENC("]) {
      expect(text).not.toContain(secret);
    }
    expect(root.querySelectorAll("textarea")).toHaveLength(0);
  }

  it("empties all fields when the backend reports the vault locked", async () => {
    const { api, root } = await filled();
    expect(document.body.textContent).toContain("the secret text");
    const fields = Array.from(root.querySelectorAll<HTMLElement>("textarea, input"));
    api.emitLocked();
    await flush();
    assertEmpty(root, fields);
    expect(root.querySelector("form")).not.toBeNull();
  });

  it("empties all fields when the user presses Lock", async () => {
    const { api, root } = await filled();
    const fields = Array.from(root.querySelectorAll<HTMLElement>("textarea, input"));
    await click(button(root, "Lock"));
    expect(api.lock).toHaveBeenCalled();
    assertEmpty(root, fields);
  });

  it("goes back to unlock when a call fails with Locked (inactivity timeout)", async () => {
    const api = fakeApi({ encrypt: async () => { throw err("Locked"); } });
    const { root } = await mount(api);
    type($(root, "#enc-input"), "PRIVATE-DRAFT-TEXT");
    await click($(root, "#encrypt"));
    await flush();
    expect(document.body.textContent).not.toContain("PRIVATE-DRAFT-TEXT");
    expect(root.querySelector("form")).not.toBeNull();
  });
});

describe("inactivity reporting", () => {
  it("tells the backend about typing, at most once per interval", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    vi.setSystemTime(Date.now() + 20_000);
    type($(root, "#enc-input"), "a");
    type($(root, "#enc-input"), "ab");
    type($(root, "#enc-input"), "abc");
    await flush();
    expect(api.touch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 20_000);
    type($(root, "#enc-input"), "abcd");
    await flush();
    expect(api.touch).toHaveBeenCalledTimes(2);
  });
});
