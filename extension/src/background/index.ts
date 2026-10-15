import type { Request } from "../shared/messages";
import { loadCrypto } from "./crypto";
import { Service } from "./service";
import { chromeKV } from "./storage";

const service = loadCrypto(chrome.runtime.getURL("cipherchat_wasm_bg.wasm")).then(
  (crypto) => new Service(crypto, chromeKV(chrome.storage.local), chromeKV(chrome.storage.session)),
);

// Only our own popup and content scripts may talk to the service worker.
chrome.runtime.onMessage.addListener((req: Request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  service
    .then((s) => s.handle(req))
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: "Internal" }));
  return true; // async response
});
