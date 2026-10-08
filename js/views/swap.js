import { getCurrentProfile } from "../auth.js";
import { listOpenSwaps, acceptSwap, cancelSwapRequest, subscribe } from "../data.js";
import { avatarHTML, periodChipHTML, toast, confirmAction } from "../ui.js";
import { formatDayMonth } from "../utils.js";

let unsub = null;

export async function renderSwap(container) {
  const me = getCurrentProfile();
  container.innerHTML = `<div class="empty-state"><div class="big">☕</div><p>در حال بارگذاری…</p></div>`;
  const draw = async () => {
    let swaps = [];
    try { swaps = await listOpenSwaps(); }
    catch (e) { container.innerHTML = `<div class="empty-state"><p>خطا در دریافت لیست.</p></div>`; return; }
    if (!swaps.length) {
      container.innerHTML = `<div class="empty-state"><div class="big">🪄</div><p>الان هیچ شیفتی برای جایگزینی باز نیست.</p><p class="hint mt-2">وقتی کسی نتونه سر شیفتش بیاد، اینجا نشون داده می‌شه.</p></div>`;
      return;
    }
    container.innerHTML = `
      <div class="section-title">شیفت‌های در انتظار جایگزین</div>
      ${swaps.map((s) => {
        const mine = s.requested_by === me.id, a = s.shift_assignments;
        return `
          <div class="card" data-id="${s.id}">
            <div class="row" style="margin-bottom:10px">${avatarHTML(s.profiles)}<div><div style="font-weight:700">${s.profiles?.name}</div><div class="hint">${formatDayMonth(a.date)}</div></div></div>
            <div class="between">${periodChipHTML(a.period)}
              ${mine ? `<button class="btn btn-sm btn-ghost" data-action="cancel">لغو درخواست</button>` : `<button class="btn btn-sm btn-accept" data-action="accept">قبول می‌کنم</button>`}</div>
            ${s.note ? `<p class="hint mt-2">«${s.note}»</p>` : ""}
          </div>`;
      }).join("")}`;
    container.querySelectorAll('[data-action="accept"]').forEach((btn) => btn.addEventListener("click", async () => {
      if (!(await confirmAction("قبول می‌کنی این شیفت رو بگیری؟"))) return;
      btn.disabled = true;
      try { await acceptSwap(btn.closest("[data-id]").dataset.id); toast("شیفت به تو منتقل شد ✓"); }
      catch (e) { toast(e.message || "این درخواست دیگه معتبر نیست"); }
      draw();
    }));
    container.querySelectorAll('[data-action="cancel"]').forEach((btn) => btn.addEventListener("click", async () => {
      try { await cancelSwapRequest(btn.closest("[data-id]").dataset.id); toast("درخواست لغو شد"); }
      catch (e) { toast("مشکلی پیش اومد"); }
      draw();
    }));
  };
  await draw();
  if (unsub) unsub();
  unsub = subscribe("swap_requests", {}, draw);
}
