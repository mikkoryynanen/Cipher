import { describe, expect, it } from "vitest";
import { makeService, ok, tamper } from "./helpers";

async function unlocked() {
  const t = makeService();
  await ok(t.service.handle({ type: "unlock", passphrase: "unlock-pass" }));
  const { key } = await ok(
    t.service.handle({ type: "addKey", label: "Alice", source: { kind: "generate" } }),
  );
  return { ...t, key };
}

describe("message API round trip (4.2)", () => {
  it("encrypts and decrypts through the service", async () => {
    const { service, key } = await unlocked();
    const text = "hi 🔒🎉\nsecond line";
    const enc = await ok(service.handle({ type: "encrypt", keyId: key.id, text }));
    expect(enc.text.startsWith("🔒1.")).toBe(true);
    const dec = await ok(service.handle({ type: "decrypt", text: enc.text }));
    expect(dec).toMatchObject({ text, keyId: key.id });
  });

  it("reports distinct decrypt errors", async () => {
    const { service, key } = await unlocked();
    const enc = await ok(service.handle({ type: "encrypt", keyId: key.id, text: "secret" }));

    expect(await service.handle({ type: "decrypt", text: "hello" })).toEqual({
      ok: false,
      error: "NotOurFormat",
    });
    const flipped = tamper(enc.text);
    expect(await service.handle({ type: "decrypt", text: flipped })).toEqual({
      ok: false,
      error: "Tampered",
    });

    // A message for a key we don't hold.
    const other = makeService();
    await ok(other.service.handle({ type: "unlock", passphrase: "x" }));
    const k2 = await ok(
      other.service.handle({ type: "addKey", label: "", source: { kind: "generate" } }),
    );
    const foreign = await ok(
      other.service.handle({ type: "encrypt", keyId: k2.key.id, text: "hi" }),
    );
    expect(await service.handle({ type: "decrypt", text: foreign.text })).toEqual({
      ok: false,
      error: "UnknownKey",
    });
  });

  it("reports unknown version", async () => {
    const { service } = await unlocked();
    // version byte 2, then 4 + 24 + 16 bytes of filler (base64url of 45 bytes)
    const bytes = new Uint8Array(45);
    bytes[0] = 2;
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await service.handle({ type: "decrypt", text: `🔒1.${b64}` })).toEqual({
      ok: false,
      error: "UnknownVersion",
    });
  });
});

describe("key store (4.3)", () => {
  it("stores no plaintext key bytes", async () => {
    const { service, local, key } = await unlocked();
    const { exported } = await ok(service.handle({ type: "exportKey", id: key.id }));
    const keyHex = exported.slice("ck1-".length);
    const stored = JSON.stringify(local.dump());
    expect(stored).not.toContain(keyHex);
    expect(stored).not.toContain("Alice"); // labels are sealed too
    expect(stored).not.toContain("keyHex");
  });

  it("starts locked and keeps keys unusable", async () => {
    const { service, key, restartBrowser } = await unlocked();
    const fresh = restartBrowser();
    expect(await ok(fresh.handle({ type: "status" }))).toMatchObject({
      unlocked: false,
      hasVault: true,
    });
    expect(await fresh.handle({ type: "listKeys" })).toEqual({ ok: false, error: "Locked" });
    expect(await fresh.handle({ type: "encrypt", keyId: key.id, text: "x" })).toEqual({
      ok: false,
      error: "Locked",
    });
    void service;
  });

  it("wrong passphrase fails and stays locked; right one restores keys", async () => {
    const { key, restartBrowser } = await unlocked();
    const fresh = restartBrowser();
    expect(await fresh.handle({ type: "unlock", passphrase: "nope" })).toEqual({
      ok: false,
      error: "WrongPassphrase",
    });
    expect(await fresh.handle({ type: "listKeys" })).toEqual({ ok: false, error: "Locked" });
    await ok(fresh.handle({ type: "unlock", passphrase: "unlock-pass" }));
    const { keys } = await ok(fresh.handle({ type: "listKeys" }));
    expect(keys.map((k) => k.id)).toEqual([key.id]);
  });

  it("lock clears access", async () => {
    const { service } = await unlocked();
    await ok(service.handle({ type: "lock" }));
    expect(await service.handle({ type: "listKeys" })).toEqual({ ok: false, error: "Locked" });
  });

  it("passphrase keys are deterministic with the same salt; export/import round-trips", async () => {
    const a = makeService();
    const b = makeService();
    for (const t of [a, b]) await ok(t.service.handle({ type: "unlock", passphrase: "u" }));
    const k1 = await ok(
      a.service.handle({
        type: "addKey",
        label: "shared",
        source: { kind: "passphrase", passphrase: "correct horse" },
      }),
    );
    expect(k1.saltHex).toHaveLength(32);
    const k2 = await ok(
      b.service.handle({
        type: "addKey",
        label: "shared",
        source: { kind: "passphrase", passphrase: "correct horse", saltHex: k1.saltHex },
      }),
    );
    expect(k2.key.id).toBe(k1.key.id);
    expect(k2.key.fingerprint).toBe(k1.key.fingerprint);

    const c = makeService();
    await ok(c.service.handle({ type: "unlock", passphrase: "u" }));
    const { exported } = await ok(a.service.handle({ type: "exportKey", id: k1.key.id }));
    const k3 = await ok(
      c.service.handle({ type: "addKey", label: "", source: { kind: "import", exported } }),
    );
    expect(k3.key.id).toBe(k1.key.id);
  });

  it("deletes keys and rejects bad imports", async () => {
    const { service, key } = await unlocked();
    await ok(service.handle({ type: "deleteKey", id: key.id }));
    expect((await ok(service.handle({ type: "listKeys" }))).keys).toEqual([]);
    expect(await service.handle({ type: "deleteKey", id: key.id })).toEqual({
      ok: false,
      error: "NoSuchKey",
    });
    expect(
      await service.handle({
        type: "addKey",
        label: "",
        source: { kind: "import", exported: "garbage" },
      }),
    ).toEqual({ ok: false, error: "InvalidInput" });
  });
});
