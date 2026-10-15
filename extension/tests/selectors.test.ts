// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadFixture } from "./fixtures";
import { describe, expect, it } from "vitest";
import {
  composeBox,
  currentChat,
  indicatorHost,
  isInComposeBox,
  isSendControl,
  messageTextElements,
  sendButton,
} from "../src/whatsapp/selectors";

describe("selectors against fixtures", () => {
  it("finds messages, chat, compose box and send button in a 1:1 chat", () => {
    loadFixture("chat-1to1.html");
    expect(messageTextElements()).toHaveLength(3);
    expect(currentChat()).toEqual({ id: "title:Alice", isGroup: false });
    expect(composeBox()).not.toBeNull();
    expect(sendButton()?.tagName).toBe("BUTTON");
    expect(indicatorHost()?.tagName).toBe("FOOTER");
    expect(isInComposeBox(composeBox()!.querySelector("p"))).toBe(true);
    expect(isSendControl(document.querySelector("[data-icon='send']"))).toBe(true);
    expect(isSendControl(document.querySelector("header"))).toBe(false);
  });

  it("detects group chats", () => {
    loadFixture("chat-group.html");
    expect(currentChat()).toEqual({ id: "title:Family", isGroup: true });
  });

  it("detects a group from the number of distinct senders", () => {
    loadFixture("chat-1to1.html");
    document.querySelectorAll("[data-pre-plain-text]").forEach((e, i) =>
      e.setAttribute("data-pre-plain-text", `[10:0${i}, 1/1/2026] Person${i}: `));
    expect(currentChat()?.isGroup).toBe(true);
  });

  it("works in a chat with no messages", () => {
    loadFixture("chat-1to1.html");
    document.querySelectorAll("[data-id]").forEach((e) => e.remove());
    expect(currentChat()).toEqual({ id: "title:Alice", isGroup: false });
  });

  it("returns null when the chat cannot be determined", () => {
    document.body.innerHTML = "<main><footer></footer></main>";
    expect(currentChat()).toBeNull();
  });
});

describe("selector containment", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  // Anything that reaches into WhatsApp's DOM must live in selectors.ts.
  const forbidden = [
    /querySelector(All)?\s*\(/,
    /\.closest\s*\(/,
    /\.matches\s*\(/,
    /getElementsBy/,
    /data-(id|tab|icon|testid|pre-plain-text)/,
    /aria-label/,
    /contenteditable/i,
    /selectable-text|copyable-text/,
  ];

  it("no WhatsApp selectors outside src/whatsapp/selectors.ts", () => {
    const offenders: string[] = [];
    for (const file of walk("src").filter((f) => /\.ts$/.test(f) && !f.includes("wasm-pkg"))) {
      if (file.endsWith("whatsapp/selectors.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const re of forbidden) if (re.test(src)) offenders.push(`${file}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });
});
