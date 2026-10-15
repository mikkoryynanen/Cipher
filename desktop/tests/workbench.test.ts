import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, button, click, err, fakeApi, flush, inPanel, mount, type } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("encrypt panel", () => {
  it("requires an explicit key choice and shows the backend's reason", async () => {
    const api = fakeApi({ encrypt: async () => { throw err("NoKey"); } });
    const { root } = await mount(api);
    expect($<HTMLSelectElement>(root, "#enc-key").value).toBe("");
    type($(root, "#enc-input"), "hello");
    await click(inPanel(root, "#enc-input", "Encrypt"));
    expect(api.encrypt).toHaveBeenCalledWith(null, "hello");
    expect($(root, "#enc-key").closest("section")?.querySelector(".msg")?.textContent).toBe("Select a key first.");
  });

  it("encrypts with the chosen key and copies the result without auto-clearing", async () => {
    const api = fakeApi({ copy: async () => ({ clearsInSecs: null }) });
    const { root } = await mount(api);
    const sel = $<HTMLSelectElement>(root, "#enc-key");
    sel.value = "aabbccdd";
    type($(root, "#enc-input"), "hello");
    await click(inPanel(root, "#enc-input", "Encrypt"));
    expect(api.encrypt).toHaveBeenCalledWith("aabbccdd", "hello");
    expect($<HTMLTextAreaElement>(root, "#enc-output").value).toBe("🔒1.ENC(hello)");
    await click(button(root, "Copy encrypted message"));
    expect(api.copy).toHaveBeenCalledWith("ciphertext", "🔒1.ENC(hello)");
    expect(root.textContent).toContain("not cleared automatically");
  });

  it("offers the stored keys with their fingerprints", async () => {
    const { root } = await mount(fakeApi());
    expect($(root, "#enc-key").textContent).toContain("Alex (1234-5678)");
  });
});

describe("decrypt panel", () => {
  async function open() {
    const api = fakeApi();
    const m = await mount(api);
    await click(button(m.root, "Decrypt")); // the tab
    return { api, ...m };
  }

  it("decrypts pasted text and shows the key that was used", async () => {
    const { api, root } = await open();
    type($(root, "#dec-input"), "🔒1.whatever");
    await click(root.querySelector<HTMLButtonElement>(".row button") as HTMLButtonElement);
    expect(api.decrypt).toHaveBeenCalledWith("🔒1.whatever");
    expect(root.querySelector(".plain")?.textContent).toBe("the secret text");
    expect(root.textContent).toContain("Decrypted with “Alex”");
  });

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
    await click(button(root, "Decrypt"));
    await click(root.querySelector<HTMLButtonElement>(".row button") as HTMLButtonElement);
    const items = Array.from(root.querySelectorAll(".item"));
    expect(items).toHaveLength(5);
    expect(items[1]?.textContent).toBe("You do not have the key for this message.");
    expect(items[2]?.textContent).toContain("altered or damaged");
    expect(items[3]?.textContent).toContain("Update CipherChat");
    expect(root.textContent).not.toContain("tampered-plaintext");
  });

  it("reports 'not a CipherChat message' for plain text", async () => {
    const api = fakeApi({ decrypt: async () => { throw err("NotOurFormat"); } });
    const { root } = await mount(api);
    await click(button(root, "Decrypt"));
    type($(root, "#dec-input"), "hello");
    await click(root.querySelector<HTMLButtonElement>(".row button") as HTMLButtonElement);
    expect(root.textContent).toContain("That is not a CipherChat message.");
  });

  it("paste & decrypt uses the backend's clipboard read", async () => {
    const { api, root } = await open();
    await click(button(root, "Paste & decrypt"));
    expect(api.pasteAndDecrypt).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".plain")?.textContent).toBe("pasted secret");
  });

  it("shows a ticking clipboard-clear countdown after copying plaintext", async () => {
    const { api, root } = await open();
    await click(root.querySelector<HTMLButtonElement>(".row button") as HTMLButtonElement);
    await click(button(root, "Copy text"));
    expect(api.copy).toHaveBeenCalledWith("plaintext", "the secret text");
    expect(root.textContent).toContain("cleared in 30 s");
    vi.advanceTimersByTime(10_000);
    expect(root.textContent).toContain("cleared in 20 s");
    vi.advanceTimersByTime(20_000);
    expect(root.textContent).toContain("Clipboard cleared.");
  });
});

describe("locking clears the screen", () => {
  async function filled() {
    const api = fakeApi();
    const m = await mount(api);
    type($(m.root, "#enc-input"), "PRIVATE-DRAFT-TEXT");
    $<HTMLSelectElement>(m.root, "#enc-key").value = "aabbccdd";
    await click(inPanel(m.root, "#enc-input", "Encrypt"));
    await click(button(m.root, "Decrypt"));
    type($(m.root, "#dec-input"), "🔒1.PASTED-CIPHERTEXT");
    await click(m.root.querySelector<HTMLButtonElement>(".row button") as HTMLButtonElement);
    await flush();
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
    expect(root.querySelector("form")).not.toBeNull(); // unlock screen
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
    $<HTMLSelectElement>(root, "#enc-key").value = "aabbccdd";
    type($(root, "#enc-input"), "PRIVATE-DRAFT-TEXT");
    await click(inPanel(root, "#enc-input", "Encrypt"));
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
