import { send } from "../shared/client";
import { ChatTracker } from "./chat";
import { MessageDecryptor } from "./decrypt";
import { SendInterceptor } from "./send";
import { ChatToggle, toast } from "./ui";

const tracker = new ChatTracker(send);
const decryptor = new MessageDecryptor(send);
const interceptor = new SendInterceptor({ send, tracker, notify: toast });
const toggle = new ChatToggle(send, tracker);

decryptor.start();
interceptor.start();

// Follow chat switches and WhatsApp re-rendering the footer.
let timer: ReturnType<typeof setTimeout> | undefined;
new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void tracker.refresh();
    void toggle.ensureMounted();
  }, 100);
}).observe(document.body, { childList: true, subtree: true });

// The service worker bumps `epoch` whenever the vault, keys or chat settings change.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.epoch) return;
  decryptor.retryPlaceholders();
  void tracker.refresh(true);
});

void tracker.refresh(true).then(() => toggle.ensureMounted());
