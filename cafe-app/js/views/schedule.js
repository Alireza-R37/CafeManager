import { getCurrentProfile } from "../auth.js";
import { getWeekByStart, getPicksForWeek, addPick, removePick, getAssignmentsForWeek, createSwapRequest, subscribe } from "../data.js";
import { toISODate, getWeekStart, addDays, weekDays, formatDayMonth, PERIODS } from "../utils.js";
import { avatarHTML, periodChipHTML, toast, confirmAction } from "../ui.js";

let weekOffset = 0;
let unsub = null;

function weekNav(title) {
  return `<div class="week-nav"><button id="prevWeek">›</button><div class="label">${title}</div><button id="nextWeek">‹</button></div>`;
}
function bindNav(container) {
  container.querySelector("#prevWeek").onclick = () => { weekOffset--; renderSchedule(container); };
  container.querySelector("#nextWeek").onclick = () => { weekOffset++; renderSchedule(container); };
}

export async function renderSchedule(container) {
  const me = getCurrentProfile();
  const baseStart = toISODate(addDays(getWeekStart(new Date()), weekOffset * 7));
  container.innerHTML = `<div class="empty-state"><div class="big">☕</div><p>در حال بارگذاری برنامه…</p></div>`;

  const week = await getWeekByStart(baseStart);
  if (!week) {
    container.innerHTML = weekNav(`هفته‌ی ${formatDayMonth(baseStart)}`) + `<div class="empty-state"><p>هنوز برنامه‌ای برای این هفته تنظیم نشده.</p></div>`;
    return bindNav(container);
  }
  if (week.status === "draft") {
    container.innerHTML = weekNav(`هفته‌ی ${formatDayMonth(baseStart)}`) + `<div class="empty-state"><div class="big">🛠️</div><p>مدیر داره برنامه‌ی این هفته رو نهایی می‌کنه.</p><p class="hint mt-2">به‌محض تأیید، همین‌جا نشونت می‌دیم.</p></div>`;
    return bindNav(container);
  }

  const days = weekDays(baseStart);
  const isBidding = week.status === "bidding";

  const draw = async () => {
    const [assignments, picks] = await Promise.all([getAssignmentsForWeek(week.id), isBidding ? getPicksForWeek(week.id) : Promise.resolve([])]);
    const myPicks = picks.filter((p) => p.barista_id === me.id);
    const myShiftPicks = myPicks.filter((p) => p.kind === "shift");
    const myOffPicks = myPicks.filter((p) => p.kind === "day_off");
    const myShiftDates = new Set(myShiftPicks.map((p) => p.date));
    const myOffDates = new Set(myOffPicks.map((p) => p.date));

    const assignmentMap = {};
    for (const a of assignments) assignmentMap[`${a.date}_${a.period}`] = a;
    const pickMap = {};
    for (const p of picks.filter((p) => p.kind === "shift")) (pickMap[`${p.date}_${p.period}`] ||= []).push(p);
    const offByDate = {};
    for (const p of picks.filter((p) => p.kind === "day_off")) (offByDate[p.date] ||= []).push(p);

    const deadline = week.bidding_deadline
      ? ` · مهلت: ${new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(week.bidding_deadline))}` : "";

    container.innerHTML = `
      ${weekNav(`هفته‌ی ${formatDayMonth(days[0].date)} تا ${formatDayMonth(days[6].date)}`)}
      ${isBidding ? `
        <div class="card">
          <div class="between"><strong>انتخاب شیفت این هفته</strong><span class="hint">${myShiftPicks.length}/۲ شیفت · ${myOffPicks.length}/۲ آف</span></div>
          <p class="hint mt-2">۲ شیفت که می‌خوای رو بزن، و ۱ یا ۲ روز آف. بقیه رو سیستم خودش منصفانه تقسیم می‌کنه${deadline}.</p>
        </div>` : `
        <div class="card"><strong>${week.status === "published" ? "برنامه نهایی هفته" : "برنامه قفل‌شده"}</strong><p class="hint mt-2">برای درخواست جایگزینی، روی شیفت خودت بزن.</p></div>`}

      ${days.map((d) => `
        <div class="day-block">
          <div class="day-label">${d.dayName} — ${formatDayMonth(d.date)}
            ${offByDate[d.date]?.some((p) => p.barista_id === me.id) ? '<span class="chip" style="margin-inline-start:6px">آفِ من</span>' : ""}</div>
          ${PERIODS.map((per) => {
            const key = `${d.date}_${per.key}`;
            const a = assignmentMap[key];
            const assignee = a?.profiles;
            const isMine = a?.barista_id === me.id;
            const picksHere = pickMap[key] || [];
            const iPicked = picksHere.some((p) => p.barista_id === me.id);
            if (isBidding) {
              const disable = !iPicked && (myShiftPicks.length >= 2 || myOffDates.has(d.date));
              return `
                <div class="shift-row ${iPicked ? "mine" : ""}" data-date="${d.date}" data-period="${per.key}">
                  <div class="meta">${periodChipHTML(per.key)}<span class="hint">${per.time}</span>
                    ${picksHere.length ? `<span class="hint">علاقه‌مند: ${picksHere.map((p) => p.profiles?.name).join("، ")}</span>` : ""}</div>
                  <button class="btn btn-sm ${iPicked ? "btn-accept" : "btn-ghost"}" data-action="toggle-shift" ${disable ? "disabled" : ""}>${iPicked ? "انتخاب شد ✓" : "می‌خوام"}</button>
                </div>`;
            }
            return `
              <div class="shift-row ${isMine ? "mine" : ""}" data-assignment="${a?.id || ""}">
                <div class="row">${assignee ? avatarHTML(assignee) : ""}
                  <div class="meta">${periodChipHTML(per.key)}<span class="assignee ${assignee ? "" : "empty"}">${assignee?.name || "خالی"}</span></div></div>
                ${isMine ? `<button class="btn btn-sm btn-alert" data-action="request-swap">جایگزین</button>` : ""}
              </div>`;
          }).join("")}
        </div>`).join("")}

      ${isBidding ? `
        <div class="section-title">روز آف</div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          ${days.map((d) => {
            const sel = (offByDate[d.date] || []).some((p) => p.barista_id === me.id);
            const disable = !sel && (myOffPicks.length >= 2 || myShiftDates.has(d.date));
            return `<button class="btn btn-sm ${sel ? "btn-accept" : "btn-ghost"}" data-off="${d.date}" ${disable ? "disabled" : ""}>${d.dayName}</button>`;
          }).join("")}
        </div>` : ""}
    `;
    bindNav(container);

    if (isBidding) {
      container.querySelectorAll('[data-action="toggle-shift"]').forEach((btn) => btn.addEventListener("click", async () => {
        const { date, period } = btn.closest("[data-date]").dataset;
        const existing = (pickMap[`${date}_${period}`] || []).find((p) => p.barista_id === me.id);
        try {
          if (existing) await removePick(existing.id);
          else await addPick({ weekId: week.id, baristaId: me.id, date, period, kind: "shift" });
        } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
        draw();
      }));
      container.querySelectorAll("[data-off]").forEach((btn) => btn.addEventListener("click", async () => {
        const date = btn.dataset.off;
        const existing = (offByDate[date] || []).find((p) => p.barista_id === me.id);
        try {
          if (existing) await removePick(existing.id);
          else await addPick({ weekId: week.id, baristaId: me.id, date, period: null, kind: "day_off" });
        } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
        draw();
      }));
    } else {
      container.querySelectorAll('[data-action="request-swap"]').forEach((btn) => btn.addEventListener("click", async () => {
        const id = btn.closest("[data-assignment]").dataset.assignment;
        if (!(await confirmAction("این شیفت رو برای جایگزینی بذارم تا بقیه ببینن؟"))) return;
        try { await createSwapRequest(id, me.id); toast("درخواست جایگزینی ثبت شد"); draw(); }
        catch (e) { toast("قبلاً برای این شیفت درخواست باز داری"); }
      }));
    }
  };

  await draw();
  if (unsub) unsub();
  unsub = subscribe("shift_assignments", { filter: `week_id=eq.${week.id}` }, draw);
}
