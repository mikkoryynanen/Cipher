import type { Api, AppError } from "../api";
import { toAppError } from "../api";
import { h, wipeFields } from "./dom";
import { keysPanel } from "./keys";
import { settingsPanel } from "./settings";
import type { Ctx, Panel, Session, TabName } from "./types";
import { unlockScreen } from "./unlock";
import { messagesPanel } from "./workbench";

/** How often user activity is reported to the backend's inactivity timer. */
const TOUCH_EVERY_MS = 15_000;

export class App {
  private timers = new Set<number>();
  private unlisten: (() => void) | undefined;
  private lastTouch = 0;
  private screen: "none" | "unlock" | "main" = "none";
  private session: Session = {};
  /** Set when the user pressed Lock; cleared when the next main screen opens. */
  private manualLock = false;
  private tabNames: TabName[] = ["messages", "keys", "settings"];
  private selectTab: ((i: number) => void) | undefined;

  private ctx: Ctx;

  constructor(
    private root: HTMLElement,
    private api: Api,
  ) {
    this.ctx = {
      api,
      session: this.session,
      go: (tab) => {
        this.selectTab?.(this.tabNames.indexOf(tab));
        if (tab === "keys") this.root.querySelector<HTMLElement>("#add-label")?.focus();
      },
      fail: (e) => this.fail(e),
      every: (fn, ms) => {
        const id = window.setInterval(fn, ms);
        this.timers.add(id);
        return id;
      },
      clear: (id) => {
        window.clearInterval(id);
        this.timers.delete(id);
      },
    };
  }

  async start(): Promise<void> {
    this.unlisten = await this.api.onLocked(() => void this.lockedBehindOurBack());
    this.root.addEventListener("keydown", (ev) => this.shortcut(ev));
    for (const ev of ["keydown", "pointerdown", "input"]) {
      this.root.addEventListener(ev, () => this.activity(), true);
    }
    try {
      const s = await this.api.status();
      if (s.unlocked) this.showMain();
      else this.showUnlock(s.hasVault);
    } catch {
      this.root.textContent = "CipherChat could not start.";
    }
  }

  stop(): void {
    this.unlisten?.();
    this.teardown();
  }

  /** A failed call. `Locked` means the vault locked behind our back, so go to unlock. */
  private fail(e: unknown): AppError {
    const err = toAppError(e);
    if (err.code === "Locked" && this.screen === "main") void this.lockedBehindOurBack();
    return err;
  }

  /** The vault locked without the user asking, which means the inactivity timer fired. */
  private lockedBehindOurBack(): Promise<void> {
    if (!this.manualLock) this.session.lockReason = "inactivity";
    return this.showUnlock();
  }

  /** Ctrl/Cmd+1..3 switches tabs. */
  private shortcut(ev: KeyboardEvent): void {
    if (this.screen !== "main" || !(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    const i = Number(ev.key) - 1;
    if (Number.isInteger(i) && i >= 0 && i < this.tabNames.length) {
      ev.preventDefault();
      this.selectTab?.(i);
    }
  }

  private activity(): void {
    if (this.screen !== "main") return;
    const now = Date.now();
    if (now - this.lastTouch < TOUCH_EVERY_MS) return;
    this.lastTouch = now;
    this.api.touch().catch((e) => this.fail(e));
  }

  /** Remove every screen, emptying all text fields first. */
  private teardown(): void {
    for (const id of this.timers) window.clearInterval(id);
    this.timers.clear();
    wipeFields(this.root);
    this.root.replaceChildren();
    this.screen = "none";
    this.selectTab = undefined;
  }

  async showUnlock(hasVault?: boolean): Promise<void> {
    this.teardown();
    this.screen = "unlock";
    const s = await this.api.status().catch(() => undefined);
    const known = hasVault ?? s?.hasVault ?? true;
    if (this.screen !== "unlock") return;
    this.root.append(unlockScreen(this.ctx, known, () => this.showMain(), this.session.lockReason, s?.minPassphrase));
    this.root.querySelector<HTMLInputElement>("#pass")?.focus();
  }

  showMain(): void {
    this.teardown();
    this.screen = "main";
    this.lastTouch = Date.now();
    this.manualLock = false;
    this.session.lockReason = undefined;
    const panels: [string, Panel][] = [
      ["Messages", messagesPanel(this.ctx)],
      ["Keys", keysPanel(this.ctx)],
      ["Settings", settingsPanel(this.ctx)],
    ];
    const tabs = h("nav", { className: "tabs", role: "tablist" });
    const body = h("main", {});
    const buttons: HTMLButtonElement[] = [];
    const select = (i: number) => {
      if (i < 0 || i >= panels.length) return;
      panels.forEach(([, p], j) => {
        p.el.hidden = i !== j;
        buttons[j]?.setAttribute("aria-selected", String(i === j));
        buttons[j]?.setAttribute("tabindex", i === j ? "0" : "-1");
      });
      void panels[i]?.[1].refresh();
    };
    this.selectTab = select;
    panels.forEach(([name, p], i) => {
      const b = h("button", { type: "button", role: "tab", className: "tab" }, name);
      b.addEventListener("click", () => select(i));
      b.addEventListener("keydown", (ev) => {
        const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
        const to = ev.key === "Home" ? 0 : ev.key === "End" ? panels.length - 1 : (i + step + panels.length) % panels.length;
        if (!step && ev.key !== "Home" && ev.key !== "End") return;
        ev.preventDefault();
        select(to);
        buttons[to]?.focus();
      });
      buttons.push(b);
      tabs.append(b);
      body.append(p.el);
    });
    const lock = h("button", { type: "button", className: "secondary", id: "lock" }, "Lock");
    lock.addEventListener("click", async () => {
      this.manualLock = true;
      try {
        await this.api.lock();
      } catch {
        /* the locked event (or the next call) takes us to the unlock screen */
      }
      await this.showUnlock();
    });
    this.root.append(h("header", { className: "bar" }, h("strong", {}, "CipherChat"), tabs, lock), body);
    select(0);
  }
}
