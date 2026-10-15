import type { AddOutcome, KeyInfo, KeySource } from "../api";
import { copyButton } from "./copy";
import { h, problem, statusLine, wipeFields } from "./dom";
import { EXPORT_WARNING, describe } from "./messages";
import type { Ctx, Panel } from "./types";

type SourceKind = KeySource["kind"];

/** Key list, export/rename/delete, and the add-key form. */
export function keysPanel(ctx: Ctx): Panel {
  const list = h("div", { className: "keys" });
  const listMsg = statusLine();

  async function refresh(): Promise<void> {
    try {
      render(await ctx.api.listKeys());
    } catch (e) {
      problem(listMsg, describe(ctx.fail(e)));
    }
  }

  function render(keys: KeyInfo[]): void {
    list.replaceChildren(
      ...(keys.length ? keys.map(row) : [h("p", { className: "hint" }, "No keys yet. Add one below.")]),
    );
  }

  /** Fetch the exported key and show it, with its warning and a copy button, inside `detail`. */
  async function showExport(id: string, detail: HTMLElement): Promise<void> {
    const close = () => {
      wipeFields(detail);
      detail.replaceChildren();
    };
    close();
    try {
      const exported = await ctx.api.exportKey(id);
      const note = statusLine();
      const box = h("input", { type: "text", readonly: true, value: exported, "aria-label": "Exported key" });
      const hide = h("button", { type: "button", className: "secondary" }, "Hide");
      hide.addEventListener("click", close);
      detail.append(
        h("p", { className: "warning" }, EXPORT_WARNING),
        box,
        h("div", { className: "row" }, copyButton(ctx, "key", () => box.value, note, "Copy key"), hide),
        note,
      );
    } catch (e) {
      detail.replaceChildren(h("p", { className: "status error" }, describe(ctx.fail(e))));
    }
  }

  function row(k: KeyInfo): HTMLElement {
    const detail = h("div", { className: "detail" });
    const actions = h("div", { className: "row" });
    const button = (label: string, fn: () => void, cls = "secondary") => {
      const b = h("button", { type: "button", className: cls }, label);
      b.addEventListener("click", fn);
      actions.append(b);
      return b;
    };
    const close = () => {
      wipeFields(detail);
      detail.replaceChildren();
    };

    button("Export", async () => {
      await showExport(k.id, detail);
    });

    button("Rename", () => {
      close();
      const input = h("input", { type: "text", value: k.label, maxlength: "64", "aria-label": "New label" });
      const save = h("button", { type: "button" }, "Save");
      const cancel = h("button", { type: "button", className: "secondary" }, "Cancel");
      const m = statusLine();
      cancel.addEventListener("click", close);
      save.addEventListener("click", async () => {
        try {
          await ctx.api.renameKey(k.id, input.value);
          await refresh();
        } catch (e) {
          problem(m, describe(ctx.fail(e)));
        }
      });
      detail.append(input, h("div", { className: "row" }, save, cancel), m);
    });

    const del = button(
      "Delete",
      () => {
        close();
        const sure = h("button", { type: "button", className: "danger" }, "Delete key");
        const cancel = h("button", { type: "button", className: "secondary" }, "Cancel");
        const m = statusLine();
        cancel.addEventListener("click", close);
        sure.addEventListener("click", async () => {
          try {
            await ctx.api.deleteKey(k.id);
            await refresh();
          } catch (e) {
            problem(m, describe(ctx.fail(e)));
          }
        });
        detail.append(
          h("p", { className: "warning" }, `Delete “${k.label}”? Messages encrypted with it can no longer be read here.`),
          h("div", { className: "row" }, sure, cancel),
          m,
        );
      },
      "secondary",
    );
    del.classList.add("danger-action");

    return h(
      "div",
      { className: "key" },
      h("div", { className: "head" }, h("strong", {}, k.label), h("code", {}, k.fingerprint)),
      actions,
      detail,
    );
  }

  // ---- add a key ----
  const label = h("input", { type: "text", id: "add-label", maxlength: "64", placeholder: "Optional, e.g. “Alex”", "aria-label": "Label" });
  const source = h(
    "select",
    { id: "add-source", "aria-label": "How to add" },
    h("option", { value: "generate" }, "Generate a new random key"),
    h("option", { value: "passphrase" }, "From a shared passphrase + salt"),
    h("option", { value: "import" }, "Import an exported key (ck1-…)"),
  );
  const pass = h("input", { type: "password", id: "add-pass", autocomplete: "off", placeholder: "Shared passphrase", "aria-label": "Shared passphrase" });
  const salt = h("input", { type: "text", id: "add-salt", autocomplete: "off", placeholder: "Salt from your contact (leave empty to create one)", "aria-label": "Salt" });
  const imp = h("input", { type: "text", id: "add-import", autocomplete: "off", placeholder: "ck1-…", "aria-label": "Exported key" });
  const addMsg = h("div", { className: "status", role: "status" });
  const addBtn = h("button", { type: "button" }, "Add key");
  const groups: Record<SourceKind, HTMLElement[]> = {
    generate: [],
    passphrase: [pass, salt],
    import: [imp],
  };
  const sync = () => {
    for (const [kind, els] of Object.entries(groups)) for (const e of els) e.hidden = kind !== source.value;
  };
  source.addEventListener("change", sync);
  sync();

  function outcomeText(o: AddOutcome, kind: SourceKind): HTMLElement {
    const box = h("div", { className: "outcome" });
    box.append(h("p", {}, o.alreadyExists ? `This key is already stored as “${o.key.label}” (${o.key.fingerprint}). Nothing was changed.` : `Added “${o.key.label}” (${o.key.fingerprint}).`));
    if (o.saltHex) {
      const saltNote = statusLine();
      const salt = o.saltHex;
      box.append(
        h("p", { className: "hint" }, "Next: give your contact the salt and the passphrase, out of band. Both are needed to get the same key."),
        h("code", { className: "salt" }, salt),
        h("div", { className: "row" }, copyButton(ctx, "key", () => salt, saltNote, "Copy salt")),
        saltNote,
      );
    } else if (kind === "generate" && !o.alreadyExists) {
      const exportDetail = h("div", { className: "detail" });
      const exportBtn = h("button", { type: "button" }, "Export this key to share");
      exportBtn.addEventListener("click", () => void showExport(o.key.id, exportDetail));
      box.append(
        h("p", { className: "hint" }, "Next: give this key to your contact out of band (in person or by phone), never through the chat."),
        exportBtn,
        exportDetail,
      );
    }
    if (o.weakPassphrase) {
      box.append(h("p", { className: "warning" }, "This passphrase is short. Anyone who captures your messages could guess it offline. Prefer a generated key."));
    }
    return box;
  }

  addBtn.addEventListener("click", async () => {
    addMsg.replaceChildren();
    addMsg.className = "status";
    const kind = source.value as SourceKind;
    const src: KeySource =
      kind === "generate"
        ? { kind }
        : kind === "passphrase"
          ? { kind, passphrase: pass.value, saltHex: salt.value.trim() || undefined }
          : { kind, exported: imp.value };
    try {
      const out = await ctx.api.addKey(label.value, src);
      addMsg.className = "status";
      addMsg.append(outcomeText(out, kind));
      label.value = pass.value = salt.value = imp.value = "";
      await refresh();
    } catch (e) {
      problem(addMsg, describe(ctx.fail(e)));
    }
  });

  const el = h(
    "section",
    { className: "panel" },
    h("h2", {}, "Keys"),
    h("p", { className: "lead" }, "Everyone in a conversation needs the same key. Share it out of band, never through the chat."),
    list,
    listMsg,
    h("h3", {}, "Add a key"),
    h("label", { for: "add-label" }, "Label"),
    label,
    h("label", { for: "add-source" }, "How"),
    source,
    pass,
    salt,
    imp,
    addBtn,
    addMsg,
  );
  return { el, refresh };
}
