// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "../src/popup/popup";
import { ERROR_MESSAGES } from "../src/shared/messages";
import { makeService, tamper } from "./helpers";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const click = (el: HTMLElement) => el.click();
const settle = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  document.body.innerHTML = '<div id="app"></div>';
  const { service, restartBrowser } = makeService();
  const send = ((req: never) => service.handle(req)) as Parameters<typeof mount>[1];
  const ui = mount($("app"), send);
  await vi.waitFor(() => expect($("unlock-btn")).toBeTruthy());
  await ui.refresh();
  return { ui, service, send, restartBrowser };
}

async function unlock(pass = "unlock-passphrase") {
  $<HTMLInputElement>("unlock-pass").value = pass;
  click($("unlock-btn"));
  await vi.waitFor(() => expect($("unlock-section").hidden).toBe(true));
}

async function addKey(label: string) {
  $<HTMLInputElement>("add-label").value = label;
  click($("add-btn"));
  await vi.waitFor(() => expect($("key-list").textContent).toContain(label));
}

beforeEach(() => {
  window.confirm = () => true;
});

describe("locked state", () => {
  it("disables controls and shows an unlock prompt", async () => {
    await setup();
    expect($("unlock-section").hidden).toBe(false);
    for (const id of ["enc-btn", "dec-btn", "enc-in", "dec-in", "add-btn"]) {
      expect($<HTMLButtonElement>(id).disabled, id).toBe(true);
    }
  });

  it("rejects a short passphrase when creating the vault", async () => {
    await setup();
    $<HTMLInputElement>("unlock-pass").value = "short";
    click($("unlock-btn"));
    await settle();
    expect($("unlock-msg").textContent).toContain("too short");
    expect($("unlock-section").hidden).toBe(false);
  });

  it("wrong passphrase shows an error and stays locked", async () => {
    const { restartBrowser } = await setup();
    await unlock();
    document.body.innerHTML = '<div id="app"></div>';
    const fresh = restartBrowser();
    mount($("app"), ((r: never) => fresh.handle(r)) as Parameters<typeof mount>[1]);
    await vi.waitFor(() => expect($("unlock-btn").textContent).toBe("Unlock"));
    $<HTMLInputElement>("unlock-pass").value = "not-the-passphrase";
    click($("unlock-btn"));
    await vi.waitFor(() => expect($("unlock-msg").textContent).toBe(ERROR_MESSAGES.WrongPassphrase));
    expect($("unlock-section").hidden).toBe(false);
  });
});

describe("key management view", () => {
  it("generates a key and lists it by fingerprint", async () => {
    await setup();
    await unlock();
    await addKey("Alice");
    expect($("key-list").textContent).toMatch(/Alice\s+[0-9a-f]{4}-[0-9a-f]{4}/);
    expect($("enc-key").children.length).toBe(1);
  });

  it("derives from passphrase and shows the salt to share", async () => {
    await setup();
    await unlock();
    $<HTMLSelectElement>("add-kind").value = "passphrase";
    $<HTMLSelectElement>("add-kind").dispatchEvent(new Event("change"));
    $<HTMLInputElement>("add-pass").value = "correct horse";
    $<HTMLInputElement>("add-label").value = "Bob";
    click($("add-btn"));
    await vi.waitFor(() => expect($("key-msg").textContent).toMatch(/Salt .*[0-9a-f]{32}/));
  });

  it("exports with an out-of-band warning, and deletes", async () => {
    await setup();
    await unlock();
    await addKey("Alice");
    click(document.querySelector(".export-btn") as HTMLElement);
    await vi.waitFor(() => expect($("export-box").hidden).toBe(false));
    expect($("export-box").textContent).toMatch(/out of band/i);
    expect($("export-value").textContent).toMatch(/^ck1-[0-9a-f]{64}$/);
    click(document.querySelector(".delete-btn") as HTMLElement);
    await vi.waitFor(() => expect($("key-list").textContent).toContain("No keys yet"));
  });
});

describe("encrypt / decrypt boxes", () => {
  it("round-trips, and each error type shows its message", async () => {
    const { service } = await setup();
    await unlock();
    await addKey("Alice");

    $<HTMLTextAreaElement>("enc-in").value = "hello 🔒";
    click($("enc-btn"));
    await vi.waitFor(() => expect($<HTMLTextAreaElement>("enc-out").value).toMatch(/^🔒1\./));
    const wire = $<HTMLTextAreaElement>("enc-out").value;

    const decrypt = async (text: string) => {
      $<HTMLTextAreaElement>("dec-in").value = text;
      click($("dec-btn"));
      await settle();
      await settle();
    };

    await decrypt(wire);
    expect($<HTMLTextAreaElement>("dec-out").value).toBe("hello 🔒");

    await decrypt("plain text");
    expect($("dec-msg").textContent).toBe(ERROR_MESSAGES.NotOurFormat);
    expect($<HTMLTextAreaElement>("dec-out").value).toBe("");

    const flipped = tamper(wire);
    await decrypt(flipped);
    expect($("dec-msg").textContent).toBe(ERROR_MESSAGES.Tampered);

    const v2 = new Uint8Array(45);
    v2[0] = 2;
    const b64 = btoa(String.fromCharCode(...v2)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await decrypt(`🔒1.${b64}`);
    expect($("dec-msg").textContent).toBe(ERROR_MESSAGES.UnknownVersion);

    // Remove the key: same message is now an unknown key.
    const { keys } = (await service.handle({ type: "listKeys" })) as { keys: { id: string }[] };
    await service.handle({ type: "deleteKey", id: keys[0]!.id });
    await decrypt(wire);
    expect($("dec-msg").textContent).toBe(ERROR_MESSAGES.UnknownKey);
  });
});
