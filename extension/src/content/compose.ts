import { composeBox } from "../whatsapp/selectors";
import { extractText } from "./dom";

export const readCompose = (): string => {
  const box = composeBox();
  return box ? extractText(box) : "";
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** WhatsApp's editor updates its DOM asynchronously; wait until it shows `text`. */
async function settled(text: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if (readCompose() === text) return true;
    await sleep(25);
  }
  return false;
}

function selectAll(box: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel) return false;
  box.focus();
  const range = document.createRange();
  range.selectNodeContents(box);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/**
 * Replace the compose-box contents the way a user would, so WhatsApp's rich-text
 * editor registers it. Tries typing-style insertion, then a synthetic paste.
 * Resolves true only once the box visibly contains exactly `text`.
 */
export async function writeCompose(text: string): Promise<boolean> {
  const box = composeBox();
  if (!box || !selectAll(box)) return false;
  try {
    document.execCommand("insertText", false, text);
  } catch {
    /* fall through to paste */
  }
  if (await settled(text)) return true;

  if (!selectAll(box)) return false;
  const data = new DataTransfer();
  data.setData("text/plain", text);
  box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  if (await settled(text)) return true;

  console.warn("[CipherChat] compose box did not accept text", { expected: text.length, got: readCompose().length });
  return false;
}
