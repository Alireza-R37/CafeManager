import { getCurrentProfile } from "../auth.js";
import { listStaff, subscribe } from "../data.js";
import {
  getServerNow, clockIn, clockOut, getOpenEntry, listTimeEntries,
  adminSaveEntry, adminDeleteEntry,
} from "../hoursApi.js";
import {
  weekRange, monthRange, monthLabel, addDays, sumMs,
  formatDuration, formatClock, formatDayFull, toLocalInput,
} from "../hoursUtil.js";
import { avatarHTML, toast, confirmAction } from "../ui.js";

if (!document.getElementById("hours-style")) {
  const st = document.createElement("style");
  st.id = "hours-style";
  st.textContent = `
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); margin-bottom: var(--sp-3); }
    .stat { margin: 0; }
    .stat strong { display: block; font-family: var(--font-display); font-size: var(--fs-md); font-weight: 800; margin-top: 4px; }
    .timer { font-family: var(--font-display); font-size: var(--fs-xl); font-weight: 800; margin: var(--sp-2) 0 var(--sp-4); }
    .entry-row { padding: var(--sp-3) 0; border-bottom: 1px solid var(--border); }
    .entry-row:last-child { border-bottom: none; }
    .entry-edit { background: var(--surface-2); border-radius: var(--r-md); padding: var(--sp-3); margin: var(--sp-2) 0; }
  `;
  document.head.appendChild(st);
}

let unsub = null;
let tick = null;
let adminMonthRef = new Date();
let openBarista = null; // کدوم باریستا تو پنل مدیر بازه
let editing = null;     // id ردیفِ در حال ویرایش، یا "new"

const within = (e, r) => { const t = new Date(e.clock_in); return t >= r.start && t < r.end; };
const span = (a, b) => ({
  fromISO: new Date(Math.min(a.start, b.start)).toISOString(),
  toISO: new Date(Math.max(a.end, b.end)).toISOString(),
});

const entryRow = (e, now, extra = "") => `
  <div class="entry-row">
    <div class="between">
      <div>
        <div style="font-weight:700">${formatDayFull(e.clock_in)}</div>
        <div class="hint">${formatClock(e.clock_in)} تا ${e.clock_out ? formatClock(e.clock_out) : "در حال کار"}${e.edited_by ? " · ویرایش مدیر" : ""}</div>
      </div>
      <strong>${formatDuration((e.clock_out ? new Date(e.clock_out) : now) - new Date(e.clock_in))}</strong>
    </div>${extra}
  </div>`;

export function renderHours(container) {
  const me = getCurrentProfile();
  if (unsub) { unsub(); unsub = null; }
  clearInterval(tick);
  return me.role === "admin" ? adminView(container, me) : baristaView(container, me);
}

/* ---------------- باریستا ---------------- */
async function baristaView(container, me) {
  const draw = async () => {
    // زمان از سرور گرفته می‌شه، نه از ساعت گوشی
    const now = await getServerNow();
    const offset = now - new Date();
    const wk = weekRange(now), mo = monthRange(now);
    const [entries, open] = await Promise.all([
      listTimeEntries({ baristaId: me.id, ...span(wk, mo) }),
      getOpenEntry(me.id),
    ]);
    const monthEntries = entries.filter((e) => within(e, mo));
    const tooLong = open && now - new Date(open.clock_in) > 16 * 3600e3;

    container.innerHTML = `
      <div class="card">
        ${open ? `
          <div class="hint">از ساعت ${formatClock(open.clock_in)} مشغولی</div>
          <div class="timer" id="timer"></div>
          ${tooLong ? `<p class="hint" style="margin-bottom:12px">این ثبت خیلی طولانی شده؛ اگه یادت رفته بود پایان بزنی، الان بزن و به مدیر بگو اصلاحش کنه.</p>` : ""}
          <button class="btn btn-alert btn-block" id="outBtn">پایان ساعت کاری</button>
        ` : `
          <div class="hint">الان ساعت کاری فعالی نداری</div>
          <div class="timer" style="color:var(--text-faint)">—</div>
          <button class="btn btn-accept btn-block" id="inBtn">شروع ساعت کاری</button>
        `}
      </div>
      <div class="stat-grid">
        <div class="card stat"><span class="hint">این هفته</span><strong>${formatDuration(sumMs(entries.filter((e) => within(e, wk)), now))}</strong></div>
        <div class="card stat"><span class="hint">${monthLabel(now)}</span><strong>${formatDuration(sumMs(monthEntries, now))}</strong></div>
      </div>
      <div class="section-title">ثبت‌های این ماه</div>
      ${monthEntries.length
        ? `<div class="card">${monthEntries.map((e) => entryRow(e, now)).join("")}</div>`
        : `<p class="hint">هنوز چیزی ثبت نشده.</p>`}
    `;

    if (open) {
      const timerEl = container.querySelector("#timer");
      const upd = () => {
        if (!timerEl.isConnected) return clearInterval(tick);
        timerEl.textContent = formatDuration(Date.now() + offset - new Date(open.clock_in));
      };
      clearInterval(tick);
      upd();
      tick = setInterval(upd, 15000);
    }

    const inBtn = container.querySelector("#inBtn");
    if (inBtn) inBtn.onclick = async () => {
      inBtn.disabled = true;
      try { await clockIn(); toast("ساعت کاری شروع شد ☕"); } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
      draw();
    };
    const outBtn = container.querySelector("#outBtn");
    if (outBtn) outBtn.onclick = async () => {
      if (!(await confirmAction("ساعت کاری تموم بشه؟"))) return;
      outBtn.disabled = true;
      try { await clockOut(); toast("خسته نباشی 👋"); } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
      draw();
    };
  };

  await draw();
  unsub = subscribe("time_entries", { filter: `barista_id=eq.${me.id}` }, draw);
}

/* ---------------- مدیر ---------------- */
const editForm = (e) => `
  <div class="entry-edit" data-form="${e ? e.id : "new"}">
    <label>ورود</label>
    <input type="datetime-local" data-in value="${e ? toLocalInput(e.clock_in) : ""}" />
    <label>خروج (خالی = هنوز سر کاره)</label>
    <input type="datetime-local" data-out value="${e?.clock_out ? toLocalInput(e.clock_out) : ""}" />
    <div class="row">
      <button class="btn btn-accept btn-sm" data-save>ذخیره</button>
      <button class="btn btn-ghost btn-sm" data-cancel>انصراف</button>
    </div>
  </div>`;

async function adminView(container, me) {
  const draw = async () => {
    const now = await getServerNow();
    const wk = weekRange(now), mo = monthRange(adminMonthRef);
    const [staff, entries] = await Promise.all([listStaff(), listTimeEntries(span(wk, mo))]);

    container.innerHTML = `
      <div class="week-nav">
        <button id="prevM">›</button>
        <div class="label">${monthLabel(mo.start)}</div>
        <button id="nextM">‹</button>
      </div>
      ${staff.map((s) => {
        const list = entries.filter((e) => e.barista_id === s.id);
        const monthList = list.filter((e) => within(e, mo));
        const isOpen = openBarista === s.id;
        return `
          <div class="card" data-barista="${s.id}">
            <div class="between" data-toggle style="cursor:pointer">
              <div class="row">${avatarHTML(s)}<strong>${s.name}</strong>
                ${list.some((e) => !e.clock_out) ? `<span class="chip chip-middle">در حال کار</span>` : ""}
              </div>
              <span class="hint">${isOpen ? "▲" : "▼"}</span>
            </div>
            <div class="stat-grid" style="margin:12px 0 0">
              <div><span class="hint">این هفته</span><strong style="display:block">${formatDuration(sumMs(list.filter((e) => within(e, wk)), now))}</strong></div>
              <div><span class="hint">جمع ماه</span><strong style="display:block">${formatDuration(sumMs(monthList, now))}</strong></div>
            </div>
            ${isOpen ? `
              <div class="mt-4">
                ${monthList.map((e) => editing === e.id ? editForm(e) : entryRow(e, now, `
                  <div class="row mt-2">
                    <button class="btn btn-ghost btn-sm" data-edit="${e.id}">ویرایش</button>
                    <button class="btn btn-ghost btn-sm" data-del="${e.id}">حذف</button>
                  </div>`)).join("") || `<p class="hint">در این ماه ثبتی نیست.</p>`}
                ${editing === "new" ? editForm(null) : `<button class="btn btn-primary btn-sm mt-4" data-add>+ افزودن دستی</button>`}
              </div>` : ""}
          </div>`;
      }).join("")}
    `;

    container.querySelector("#prevM").onclick = () => { adminMonthRef = addDays(mo.start, -1); editing = null; draw(); };
    container.querySelector("#nextM").onclick = () => { adminMonthRef = mo.end; editing = null; draw(); };
    container.querySelectorAll("[data-toggle]").forEach((el) => el.onclick = () => {
      const id = el.closest("[data-barista]").dataset.barista;
      openBarista = openBarista === id ? null : id;
      editing = null;
      draw();
    });
    container.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { editing = b.dataset.edit; draw(); });
    container.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => { editing = "new"; draw(); });
    container.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = () => { editing = null; draw(); });
    container.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!(await confirmAction("این ثبت حذف بشه؟"))) return;
      try { await adminDeleteEntry(b.dataset.del); toast("حذف شد"); } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
      draw();
    });
    container.querySelectorAll("[data-save]").forEach((b) => b.onclick = async () => {
      const form = b.closest("[data-form]");
      const inV = form.querySelector("[data-in]").value;
      const outV = form.querySelector("[data-out]").value;
      if (!inV) return toast("ساعت ورود رو وارد کن");
      const cin = new Date(inV), cout = outV ? new Date(outV) : null;
      if (cout && cout <= cin) return toast("خروج باید بعد از ورود باشه");
      const id = form.dataset.form;
      try {
        await adminSaveEntry({
          id: id === "new" ? null : id,
          baristaId: form.closest("[data-barista]").dataset.barista,
          clockIn: cin.toISOString(),
          clockOut: cout ? cout.toISOString() : null,
          editedBy: me.id,
        });
        toast("ذخیره شد");
        editing = null;
      } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
      draw();
    });
  };

  await draw();
  // وسط ویرایش، تغییر بقیه صفحه رو نپرونه
  unsub = subscribe("time_entries", {}, () => { if (editing === null) draw(); });
}
