// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageDecryptor } from "../src/content/decrypt";
import { makeService, ok, tamper } from "./helpers";
import { loadFixture } from "./fixtures";

const texts = () =>
  Array.from(document.querySelectorAll("[data-id] span.selectable-text")).map((e) => e.textContent);

async function world() {
  const t = makeService();
  await ok(t.service.handle({ type: "unlock", passphrase: "unlock-pass" }));
  const { key } = await ok(
    t.service.handle({ type: "addKey", label: "Alice", source: { kind: "generate" } }),
  );
  const enc = async (text: string) =>
    (await ok(t.service.handle({ type: "encrypt", keyId: key.id, text }))).text;
  const calls = vi.fn();
  const send = ((req: never) => {
    calls(req);
    return t.service.handle(req);
  }) as never;
  return { ...t, key, enc, calls, send };
}

let dec: MessageDecryptor | undefined;
afterEach(() => dec?.stop());

describe("inline decryption (6.2)", () => {
  it("decrypts existing messages with a lock indicator and leaves others alone", async () => {
    const w = await world();
    loadFixture("chat-1to1.html", {
      __CIPHER_1__: await w.enc("hello from Alice 🎉"),
      __CIPHER_2__: await w.enc("line one\nline two"),
    });
    dec = new MessageDecryptor(w.send);
    await dec.scan();
    const t = texts();
    expect(t[0]).toBe("just a normal message");
    expect(t[1]).toBe("hello from Alice 🎉");
    expect(t[2]).toBe("line one\nline two");
    expect(document.querySelectorAll(".cipherchat-plain")).toHaveLength(2);
  });

  it("decrypts messages that arrive later via the observer", async () => {
    const w = await world();
    loadFixture("chat-1to1.html", { __CIPHER_1__: "x", __CIPHER_2__: "y" });
    dec = new MessageDecryptor(w.send);
    dec.start();
    const row = document.querySelector("[data-id]")!.closest("[role=row]")!.cloneNode(true) as HTMLElement;
    row.querySelector("[data-id]")!.setAttribute("data-id", "NEWMSG");
    row.querySelector("span.selectable-text span")!.textContent = await w.enc("brand new");
    document.querySelector("[data-testid=conversation-panel-messages]")!.append(row);
    await vi.waitFor(() => expect(texts().at(-1)).toBe("brand new"));
  });

  it("shows a short reason for undecryptable messages", async () => {
    const w = await world();
    const good = await w.enc("secret");
    const tampered = tamper(good);
    const other = makeService();
    await ok(other.service.handle({ type: "unlock", passphrase: "p" }));
    const k = await ok(other.service.handle({ type: "addKey", label: "", source: { kind: "generate" } }));
    const foreign = (await ok(other.service.handle({ type: "encrypt", keyId: k.key.id, text: "hi" }))).text;
    loadFixture("chat-1to1.html", { __CIPHER_1__: foreign, __CIPHER_2__: tampered });
    dec = new MessageDecryptor(w.send);
    await dec.scan();
    expect(texts()[1]).toBe("🔒 [unknown key]");
    expect(texts()[2]).toBe("🔒 [tampered or corrupted]");
    expect(texts().join()).not.toContain("🔒1.");
  });

  it("shows a locked placeholder, then decrypts after unlock", async () => {
    const w = await world();
    const cipher = await w.enc("later");
    loadFixture("chat-1to1.html", { __CIPHER_1__: cipher, __CIPHER_2__: "plain" });
    await w.service.handle({ type: "lock" });
    dec = new MessageDecryptor(w.send);
    await dec.scan();
    expect(texts()[1]).toContain("[locked");
    await ok(w.service.handle({ type: "unlock", passphrase: "unlock-pass" }));
    await dec.scan(); // no retry flag: placeholder stays
    expect(texts()[1]).toContain("[locked");
    await dec.scan(true);
    expect(texts()[1]).toBe("later");
  });

  it("does not reprocess already-decrypted messages", async () => {
    const w = await world();
    loadFixture("chat-1to1.html", { __CIPHER_1__: await w.enc("once"), __CIPHER_2__: "plain" });
    dec = new MessageDecryptor(w.send);
    await dec.scan();
    const decryptCalls = () => w.calls.mock.calls.filter(([r]) => r.type === "decrypt").length;
    expect(decryptCalls()).toBe(1);
    await dec.scan();
    await dec.scan();
    expect(decryptCalls()).toBe(1);
  });

  it("re-decrypts when the page re-renders the ciphertext, and handles plaintext that looks like ciphertext", async () => {
    const w = await world();
    const cipher = await w.enc("🔒1.looks-encrypted");
    loadFixture("chat-1to1.html", { __CIPHER_1__: cipher, __CIPHER_2__: "plain" });
    dec = new MessageDecryptor(w.send);
    await dec.scan();
    expect(texts()[1]).toBe("🔒1.looks-encrypted");
    await dec.scan(); // must not loop on its own output
    expect(texts()[1]).toBe("🔒1.looks-encrypted");

    document.querySelectorAll("span.selectable-text")[1]!.textContent = cipher; // React re-render
    await dec.scan();
    expect(texts()[1]).toBe("🔒1.looks-encrypted");
  });

  it("reads ciphertext whose lock emoji is rendered as an image", async () => {
    const w = await world();
    const cipher = await w.enc("emoji img");
    loadFixture("chat-1to1.html", { __CIPHER_1__: "x", __CIPHER_2__: "y" });
    document.querySelectorAll("span.selectable-text")[1]!.innerHTML =
      `<span><img alt="🔒" class="emoji">${cipher.slice("🔒".length)}</span>`;
    dec = new MessageDecryptor(w.send);
    await dec.scan();
    expect(texts()[1]).toBe("emoji img");
  });
});
