import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadFixture(name: string, subs: Record<string, string> = {}): void {
  let html = readFileSync(join("tests/fixtures", name), "utf8");
  for (const [k, v] of Object.entries(subs)) html = html.replaceAll(k, v);
  document.body.innerHTML = html;
}
