import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, button, err, fakeApi, flush, mount, type } from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function submit(root: HTMLElement) {
  $(root, "form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
}

describe("create vault", () => {
  it("shows the length rule and reports a short passphrase from the backend", async () => {
    const api = fakeApi({
      status: async () => ({ unlocked: false, hasVault: false }),
      createVault: async () => {
        throw err("InvalidInput");
      },
    });
    const { root } = await mount(api);
    expect(root.textContent).toContain("at least 12 characters");
    type($(root, "#pass"), "short");
    type($(root, "#confirm"), "short");
    await submit(root);
    expect(api.createVault).toHaveBeenCalledWith("short");
    expect($(root, ".msg").textContent).toBe("The passphrase must be at least 12 characters.");
    expect(root.querySelector("#lock")).toBeNull();
  });

  it("does not call the backend when the two passphrases differ", async () => {
    const api = fakeApi({ status: async () => ({ unlocked: false, hasVault: false }) });
    const { root } = await mount(api);
    type($(root, "#pass"), "a long passphrase one");
    type($(root, "#confirm"), "a long passphrase two");
    await submit(root);
    expect(api.createVault).not.toHaveBeenCalled();
    expect($(root, ".msg").textContent).toContain("do not match");
  });

  it("opens the app and forgets the passphrase after a successful create", async () => {
    const api = fakeApi({ status: async () => ({ unlocked: false, hasVault: false }) });
    const { root } = await mount(api);
    const pass = $<HTMLInputElement>(root, "#pass");
    type(pass, "a long passphrase here");
    type($(root, "#confirm"), "a long passphrase here");
    await submit(root);
    expect(api.createVault).toHaveBeenCalledWith("a long passphrase here");
    expect(root.querySelector("#lock")).not.toBeNull();
    expect(pass.value).toBe("");
  });
});

describe("unlock", () => {
  const locked = { status: async () => ({ unlocked: false, hasVault: true }) };

  it("reports a wrong passphrase and stays locked", async () => {
    const api = fakeApi({ ...locked, unlock: async () => { throw err("WrongPassphrase"); } });
    const { root } = await mount(api);
    type($(root, "#pass"), "nope");
    await submit(root);
    expect($(root, ".msg").textContent).toBe("Wrong passphrase.");
    expect($<HTMLInputElement>(root, "#pass").value).toBe("");
    expect(root.querySelector("#lock")).toBeNull();
  });

  it("shows the wait period, counts down and re-enables the button", async () => {
    const api = fakeApi({ ...locked, unlock: async () => { throw err("Throttled", 5); } });
    const { root } = await mount(api);
    type($(root, "#pass"), "whatever");
    await submit(root);
    const go = button(root, "Unlock");
    expect(go.disabled).toBe(true);
    expect($(root, ".msg").textContent).toBe("Too many attempts. Try again in 5 s.");
    vi.advanceTimersByTime(2000);
    expect($(root, ".msg").textContent).toBe("Too many attempts. Try again in 3 s.");
    vi.advanceTimersByTime(3000);
    expect(go.disabled).toBe(false);
    expect($(root, ".msg").textContent).toBe("You can try again now.");
  });

  it("does not submit while a wait is running", async () => {
    const api = fakeApi({ ...locked, unlock: async () => { throw err("Throttled", 30); } });
    const { root } = await mount(api);
    type($(root, "#pass"), "x");
    await submit(root);
    await submit(root);
    expect(api.unlock).toHaveBeenCalledTimes(1);
  });

  it("unlocks into the main screen", async () => {
    const api = fakeApi(locked);
    const { root } = await mount(api);
    type($(root, "#pass"), "right passphrase");
    await submit(root);
    expect(api.unlock).toHaveBeenCalledWith("right passphrase");
    expect(root.querySelector("#lock")).not.toBeNull();
  });
});
