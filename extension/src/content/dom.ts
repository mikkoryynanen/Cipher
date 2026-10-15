const BLOCKS = new Set(["P", "DIV"]);

/**
 * Plain text of a DOM subtree. Unlike textContent this keeps emoji that
 * WhatsApp renders as <img alt="🔒"> and turns <br>/blocks into newlines.
 */
export function extractText(root: Node): string {
  let out = "";
  const walk = (node: Node, first: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node instanceof HTMLImageElement) {
      out += node.alt;
    } else if (node instanceof HTMLBRElement) {
      out += "\n";
    } else if (node instanceof HTMLElement || node instanceof DocumentFragment) {
      const block = node instanceof HTMLElement && BLOCKS.has(node.tagName);
      if (block && !first && !out.endsWith("\n")) out += "\n";
      let i = 0;
      for (const child of Array.from(node.childNodes)) walk(child, i++ === 0);
    }
  };
  walk(root, true);
  return out.replace(/\n$/, "");
}
