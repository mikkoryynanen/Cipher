type Child = Node | string | null | undefined | false;

/** Tiny element builder. Text always goes in as text nodes, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v === undefined) continue;
    if (k === "className") el.className = String(v);
    else if (k === "value") (el as unknown as HTMLInputElement).value = String(v);
    else if (typeof v === "boolean") el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Empty every text field under `root` before it is discarded. */
export function wipeFields(root: ParentNode): void {
  for (const f of root.querySelectorAll("input, textarea")) {
    (f as HTMLInputElement | HTMLTextAreaElement).value = "";
  }
}
