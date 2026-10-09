import type { Ghost } from "./core.ts";

/** Owner reports are labels, not verified measurements or model instructions. */
export function ideaDialog(options: {
  ghosts: () => Ghost[];
  describe: (id: string) => string;
  focus: (id: string) => void;
  canControl: () => boolean;
  control: (command: "save" | "review" | "dismiss", id: string, data?: { outcome: string; note: string }) => Promise<void>;
}) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Scryer hypotheses and evidence");
  dialog.style.cssText = "background:#101a25;color:#eefaff;border:1px solid #9384be;border-radius:14px;padding:22px;width:min(650px,calc(100vw - 48px));max-height:80vh;overflow:auto;font:15px/1.5 system-ui;box-sizing:border-box";
  document.body.append(dialog);
  dialog.addEventListener("keydown", e => e.stopPropagation());
  dialog.addEventListener("keyup", e => e.stopPropagation());
  let selected = "";
  const text = (tag: string, value: string) => { const el = document.createElement(tag); el.textContent = value; dialog.append(el); return el; };
  const button = (label: string, action: () => void) => { const b = document.createElement("button"); b.textContent = label; b.style.cssText = "margin:4px;padding:8px;background:#152e3a;color:#eefaff;border:1px solid #7ca5b4;border-radius:5px"; b.onclick = action; dialog.append(b); return b; };
  function render() {
    dialog.replaceChildren();
    button("Close", () => dialog.close());
    text("h2", "What if… · Scryer’s ideas");
    text("p", "Hypotheses are suggestions, not infrastructure. Your reported results remain separate from the original evidence.");
    const ghosts = options.ghosts();
    if (!ghosts.length) text("p", "No grounded ideas yet. Silence is useful too.");
    for (const g of ghosts) button(`${g.review?.saved ? "★ " : ""}${g.node} · ${g.pattern || "shared-host"} · ${g.status}`, () => { selected = g.id; render(); });
    const g = ghosts.find(g => g.id === selected);
    if (!g) return;
    const detail = text("p", options.describe(`scryer:ghost:${g.id}`));
    detail.style.whiteSpace = "pre-wrap";
    text("h3", "Evidence in the world");
    for (const id of g.links) button(id, () => { dialog.close(); options.focus(id); });
    text("h3", "Owner-reported investigation");
    text("p", g.review?.at ? `Recorded ${new Date(g.review.at).toLocaleString()} · ${g.review.outcome}` : "Not investigated. Scryer has not performed the suggested experiment.");
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Investigation outcome");
    for (const [value, label] of [["untested", "Not investigated"], ["supported", "Evidence supports the idea"], ["not-supported", "Evidence does not support the idea"], ["inconclusive", "Investigated, inconclusive"]]) { const o = document.createElement("option"); o.value = value; o.textContent = label; select.append(o); }
    select.value = g.review?.outcome || "untested";
    dialog.append(select);
    const note = document.createElement("textarea");
    note.setAttribute("aria-label", "Investigation notes"); note.maxLength = 600;
    note.placeholder = "What was checked and what happened? Do not include secrets or private content.";
    note.value = g.review?.note || "";
    note.style.cssText = "display:block;box-sizing:border-box;width:100%;min-height:100px;margin:10px 0;background:#08131c;color:#eefaff";
    dialog.append(note);
    const status = text("p", ""); status.setAttribute("role", "status");
    const controls: HTMLButtonElement[] = [];
    const perform = async (command: "save" | "review" | "dismiss") => {
      controls.forEach(b => b.disabled = true);
      try { await options.control(command, g.id, command === "review" ? {outcome: select.value, note: note.value} : undefined); render(); }
      catch { status.textContent = "The change was not confirmed. Your entered notes are still here."; controls.forEach(b => b.disabled = !options.canControl()); }
    };
    controls.push(button(g.review?.saved ? "Unsave idea" : "Save idea", () => void perform("save")), button("Record investigation", () => void perform("review")), button("Dismiss idea", () => void perform("dismiss")));
    controls.forEach(b => b.disabled = !options.canControl());
    select.disabled = note.disabled = !options.canControl();
  }
  return {
    open(id?: string) { selected = id?.replace(/^scryer:ghost:/, "") || ""; render(); if (!dialog.open) dialog.showModal(); },
    remove() { dialog.close(); dialog.remove(); },
  };
}
