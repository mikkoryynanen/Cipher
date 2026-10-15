import { describe, expect, it, vi } from "vitest";
import type { KeyInfo } from "../src/api";
import { $, button, click, err, fakeApi, mount, type } from "./helpers";

async function openKeys(over = {}) {
  const api = fakeApi(over);
  const m = await mount(api);
  await click(button(m.root, "Keys"));
  return { api, ...m };
}

const keysSection = (root: HTMLElement) => $(root, "#add-label").closest("section") as HTMLElement;

describe("key list", () => {
  it("shows labels and fingerprints, never key material", async () => {
    const { root } = await openKeys();
    const text = keysSection(root).textContent ?? "";
    expect(text).toContain("Alex");
    expect(text).toContain("1234-5678");
    expect(text).not.toMatch(/[0-9a-f]{32}/i);
  });

  it("says so when there are no keys", async () => {
    const { root } = await openKeys({ listKeys: async () => [] });
    expect(keysSection(root).textContent).toContain("No keys yet");
  });
});

describe("add key", () => {
  it("generates a key", async () => {
    const { api, root } = await openKeys();
    type($(root, "#add-label"), "Sam");
    await click(button(root, "Add key"));
    expect(api.addKey).toHaveBeenCalledWith("Sam", { kind: "generate" });
    expect(keysSection(root).textContent).toContain("Added “Sam”");
  });

  it("after generating a key, says what to do next and can export it for sharing", async () => {
    const { api, root } = await openKeys();
    await click(button(root, "Add key"));
    expect(keysSection(root).textContent).toContain("give this key to your contact out of band");
    await click(button(root, "Export this key to share"));
    expect(api.exportKey).toHaveBeenCalled();
    expect(keysSection(root).textContent).toContain("Never send it through a chat");
  });

  it("derives from a passphrase, shows the salt to share and warns when short", async () => {
    const { api, root } = await openKeys({
      addKey: async () => ({ key: { id: "x", label: "p", fingerprint: "aaaa-bbbb" }, saltHex: "00".repeat(16), alreadyExists: false, weakPassphrase: true }),
    });
    const source = $<HTMLSelectElement>(root, "#add-source");
    source.value = "passphrase";
    source.dispatchEvent(new Event("change"));
    expect($<HTMLInputElement>(root, "#add-pass").hidden).toBe(false);
    expect($<HTMLInputElement>(root, "#add-import").hidden).toBe(true);
    type($(root, "#add-pass"), "short");
    await click(button(root, "Add key"));
    expect(api.addKey).toHaveBeenCalledWith("", { kind: "passphrase", passphrase: "short", saltHex: undefined });
    const text = keysSection(root).textContent ?? "";
    expect(text).toContain("00".repeat(16));
    expect(text).toContain("out of band");
    await click(button(root, "Copy salt"));
    expect(api.copy).toHaveBeenCalledWith("key", "00".repeat(16));
    expect(text).toContain("passphrase is short");
    expect($<HTMLInputElement>(root, "#add-pass").value).toBe("");
  });

  it("passes a given salt through", async () => {
    const { api, root } = await openKeys();
    $<HTMLSelectElement>(root, "#add-source").value = "passphrase";
    type($(root, "#add-pass"), "a long enough phrase");
    type($(root, "#add-salt"), "  0011  ");
    await click(button(root, "Add key"));
    expect(api.addKey).toHaveBeenCalledWith("", { kind: "passphrase", passphrase: "a long enough phrase", saltHex: "0011" });
  });

  it("imports and reports bad input and collisions", async () => {
    const api = fakeApi({ addKey: vi.fn().mockRejectedValueOnce(err("InvalidInput")).mockRejectedValueOnce(err("KeyCollision")) });
    const m = await mount(api);
    await click(button(m.root, "Keys"));
    $<HTMLSelectElement>(m.root, "#add-source").value = "import";
    type($(m.root, "#add-import"), "garbage");
    await click(button(m.root, "Add key"));
    expect(keysSection(m.root).textContent).toContain("That input is not valid.");
    await click(button(m.root, "Add key"));
    expect(keysSection(m.root).textContent).toContain("different key with the same ID");
  });

  it("tells the user when the key already exists", async () => {
    const { root } = await openKeys({
      addKey: async () => ({ key: { id: "x", label: "Alex", fingerprint: "1234-5678" }, alreadyExists: true, weakPassphrase: false }),
    });
    await click(button(root, "Add key"));
    expect(keysSection(root).textContent).toContain("already stored");
  });
});

describe("export", () => {
  it("warns about out-of-band sharing, copies as a key and can be hidden", async () => {
    const { api, root } = await openKeys();
    await click(button(root, "Export"));
    expect(api.exportKey).toHaveBeenCalledWith("aabbccdd");
    expect(keysSection(root).textContent).toContain("Never send it through a chat");
    const box = $<HTMLInputElement>(root, 'input[aria-label="Exported key"][readonly]');
    expect(box.value.startsWith("ck1-")).toBe(true);
    await click(button(root, "Copy key"));
    expect(api.copy).toHaveBeenCalledWith("key", box.value);
    expect(keysSection(root).textContent).toContain("cleared in 30 s");
    await click(button(root, "Hide"));
    expect(root.querySelector('input[aria-label="Exported key"][readonly]')).toBeNull();
    expect(keysSection(root).textContent).not.toContain("Never send it");
  });
});

describe("delete", () => {
  it("only deletes after confirmation", async () => {
    let keys: KeyInfo[] = [{ id: "aabbccdd", label: "Alex", fingerprint: "1234-5678" }];
    const { api, root } = await openKeys({ listKeys: async () => keys, deleteKey: async () => { keys = []; } });
    await click(button(root, "Delete"));
    expect(api.deleteKey).not.toHaveBeenCalled();
    expect(keysSection(root).textContent).toContain("can no longer be read");
    await click(button(root, "Cancel"));
    expect(api.deleteKey).not.toHaveBeenCalled();
    await click(button(root, "Delete"));
    await click(button(root, "Delete key"));
    expect(api.deleteKey).toHaveBeenCalledWith("aabbccdd");
    expect(keysSection(root).textContent).toContain("No keys yet");
  });
});

describe("rename and settings", () => {
  it("renames a key", async () => {
    const { api, root } = await openKeys();
    await click(button(root, "Rename"));
    const input = $<HTMLInputElement>(root, 'input[aria-label="New label"]');
    expect(input.value).toBe("Alex");
    type(input, "Alexandra");
    await click(button(root, "Save"));
    expect(api.renameKey).toHaveBeenCalledWith("aabbccdd", "Alexandra");
  });

  it("saves clipboard settings and has no switch for exported keys", async () => {
    const api = fakeApi();
    const { root } = await mount(api);
    await click(button(root, "Settings"));
    expect($<HTMLInputElement>(root, "#set-timeout").value).toBe("30");
    expect($<HTMLInputElement>(root, "#set-plain").checked).toBe(true);
    expect($<HTMLInputElement>(root, "#set-cipher").checked).toBe(false);
    expect($<HTMLInputElement>(root, "#set-autocopy").checked).toBe(true);
    expect(root.textContent).toContain("Exported keys are always cleared.");
    expect(root.querySelectorAll("#set-timeout, #set-plain, #set-cipher, #set-autocopy")).toHaveLength(4);
    type($(root, "#set-timeout"), "90");
    $<HTMLInputElement>(root, "#set-cipher").checked = true;
    $<HTMLInputElement>(root, "#set-autocopy").checked = false;
    await click(button(root, "Save"));
    expect(api.setClipboardSettings).toHaveBeenCalledWith({ timeoutSecs: 90, clearPlaintext: true, clearCiphertext: true, autoCopyCiphertext: false });
  });
});
