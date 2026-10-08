import { getCurrentProfile } from "../auth.js";
import { getTemplate, getOrCreateRun, toggleChecklistItem, subscribe } from "../data.js";
import { toISODate } from "../utils.js";
import { toast } from "../ui.js";

let activeType = "open";
let unsub = null;

export async function renderChecklist(container) {
  const me = getCurrentProfile();
  container.innerHTML = `<div class="empty-state"><div class="big">☕</div><p>در حال بارگذاری چک‌لیست…</p></div>`;
  const draw = async () => {
    const template = await getTemplate(activeType);
    const run = await getOrCreateRun(template.id, toISODate(new Date()), me.id);
    const byItem = {};
    for (const ri of run.checklist_run_items) byItem[ri.item_id] = ri;
    const ordered = template.checklist_template_items.map((t) => ({ ...t, run: byItem[t.id] }));
    const done = ordered.filter((o) => o.run?.checked_at).length;
    const firstOpen = ordered.findIndex((o) => !o.run?.checked_at);

    container.innerHTML = `
      <div class="row" style="margin-bottom:14px">
        <button class="btn btn-sm ${activeType === "open" ? "btn-primary" : "btn-ghost"}" data-type="open">باز کردن کافه</button>
        <button class="btn btn-sm ${activeType === "close" ? "btn-primary" : "btn-ghost"}" data-type="close">بستن کافه</button>
      </div>
      <div class="between"><strong>${template.title}</strong><span class="hint">${done}/${ordered.length}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${Math.round((done / ordered.length) * 100)}%"></div></div>
      ${run.completed_at ? `<div class="card" style="border-color:var(--accept)"><span style="color:var(--accept);font-weight:700">✓ چک‌لیست امروز کامل شد</span></div>` : ""}
      <div class="card">
        ${ordered.map((o, i) => {
          const isDone = !!o.run?.checked_at, locked = !isDone && i !== firstOpen;
          return `<div class="checklist-item ${isDone ? "done" : ""} ${locked ? "locked" : ""}" data-run-item="${o.run?.id}">
            <span class="index">${i + 1}</span><div class="box">${isDone ? "✓" : ""}</div>
            <div style="flex:1"><div class="text">${o.label}</div>${isDone && o.run?.profiles ? `<div class="who">${o.run.profiles.name}</div>` : ""}</div></div>`;
        }).join("")}
      </div>`;
    container.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { activeType = b.dataset.type; draw(); }));
    container.querySelectorAll(".checklist-item").forEach((row) => row.addEventListener("click", async () => {
      if (row.classList.contains("locked")) return toast("اول مرحله‌های قبلی رو تیک بزن");
      try { await toggleChecklistItem(row.dataset.runItem); draw(); } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
    }));
  };
  await draw();
  if (unsub) unsub();
  unsub = subscribe("checklist_run_items", {}, draw);
}
