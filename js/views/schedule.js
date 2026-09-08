import { getCurrentProfile } from "../auth.js";
import {
  getWeekByStart, getPicksForWeek, addPick, removePick,
  getAssignmentsForWeek, createSwapRequest, subscribe,
} from "../data.js";
import { toISODate, getWeekStart, addDays, weekDays, formatDayMonth, PERIODS } from "../utils.js";
import { avatarHTML, periodChipHTML, toast, confirmAction } from "../ui.js";

let weekOffset = 0;
let unsub = null;

export async function renderSchedule(container) {
  const me = getCurrentProfile();
  const baseStart = toISODate(addDays(getWeekStart(new Date()), weekOffset * 7));
  container.innerHTML = `<div class="empty-state"><div class="big">☕</div><p>در حال بارگذاری برنامه…</p></div>`;

  const week = await getWeekByStart(baseStart);
  if (!week) {
    container.innerHTML = `
      <div class="week-nav">
        <button id="prevWeek">›</button>
        <div class="label">هفته‌ی ${formatDayMonth(baseStart)}</div>
        <button id="nextWeek">‹</button>
      </div>
      <div class="empty-state"><p>هنوز برنامه‌ای برای این هفته تنظیم نشده.</p></div>`;
    container.querySelector("#prevWeek").onclick = () => { weekOffset--; renderSchedule(container); };
    container.querySelector("#nextWeek").onclick = () => { weekOffset++; renderSchedule(container); };
    return;
  }

  if (week.status === "draft") {
    container.innerHTML = `
      <div class="week-nav">
        <button id="prevWeek">›</button>
        <div class="label">هفته‌ی ${formatDayMonth(baseStart)}</div>
        <button id="nextWeek">‹</button>
      </div>
      <div class="empty-state">
        <div class="big">🛠️</div>
        <p>مدیر داره برنامه‌ی این هفته رو نهایی می‌کنه.</p>
        <p class="hint mt-2">به‌محض تأیید، همین‌جا نشونت می‌دیم.</p>
      </div>`;
    container.querySelector("#prevWeek").onclick = () => { weekOffset--; renderSchedule(container); };
    container.querySelector("#nextWeek").onclick = () => { weekOffset++; renderSchedule(container); };
    return;
  }

  const days = weekDays(baseStart);
  const isBidding = week.status === "bidding";

  const draw = async () => {
    const [assignments, picks] = await Promise.all([
      getAssignmentsForWeek(week.id),
      isBidding ? getPicksForWeek(week.id) : Promise.resolve([]),
    ]);

    const myPicks = picks.filter((p) => p.barista_id === me.id);
    const myShiftPicks = myPicks.filter((p) => p.kind === "shift");
    const myOffPicks = myPicks.filter((p) => p.kind === "day_off");

    const assignmentMap = {};
    for (const a of assignments) assignmentMap[`${a.date}_${a.period}`] = a;
    const pickMap = {}; // date_period -> array of picks (kind shift)
    for (const p of picks.filter((p) => p.kind === "shift")) {
      const k = `${p.date}_${p.period}`;
      (pickMap[k] ||= []).push(p);
    }
    const offByDate = {}; // date -> array of picks (day_off)
    for (const p of picks.filter((p) => p.kind === "day_off")) {
      (offByDate[p.date] ||= []).push(p);
    }

    container.innerHTML = `
      <div class="week-nav">
        <button id="prevWeek">›</button>
        <div class="label">هفته‌ی ${formatDayMonth(days[0].date)} تا ${formatDayMonth(days[6].date)}</div>
        <button id="nextWeek">‹</button>
      </div>

      ${isBidding ? `
        <div class="card">
          <div class="between">
            <strong>انتخاب شیفت این هفته</strong>
            <span class="hint">${myShiftPicks.length}/۲ شیفت · ${myOffPicks.length}/۲ آف</span>
          </div>
          <p class="hint mt-2">۲ شیفت که می‌خوای رو بزن، و ۱ یا ۲ روز آف. بقیه رو مدیر تکمیل می‌کنه.</p>
        </div>
      ` : `
        <div class="card">
          <strong>${week.status === "published" ? "برنامه نهایی هفته" : "برنامه قفل‌شده"}</strong>
          <p class="hint mt-2">برای درخواست جایگزینی، روی شیفت خودت بزن.</p>
        </div>
      `}

      ${days.map((d) => `
        <div class="day-block">
          <div class="day-label">${d.dayName} — ${formatDayMonth(d.date)}
            ${offByDate[d.date]?.some(p => p.barista_id === me.id) ? '<span class="chip" style="margin-inline-start:6px">آفِ من</span>' : ""}
          </div>
          ${PERIODS.map((per) => {
            const key = `${d.date}_${per.key}`;
            const assignment = assignmentMap[key];
            const assignee = assignment?.profiles;
            const isMine = assignment?.barista_id === me.id;
            const picksHere = pickMap[key] || [];
            const iPickedThis = picksHere.some((p) => p.barista_id === me.id);

            if (isBidding) {
              const iAmOffThisDay = (offByDate[d.date] || []).some((p) => p.barista_id === me.id);
              const disable = (!iPickedThis && myShiftPicks.length >= 2) || (!iPickedThis && iAmOffThisDay);
              return `
                <div class="shift-row ${iPickedThis ? "mine" : ""}" data-pick="${key}" data-date="${d.date}" data-period="${per.key}">
                  <div class="meta">
                    ${periodChipHTML(per.key)}
                    <span class="hint">${per.time}</span>
                    ${picksHere.length ? `<span class="hint">علاقه‌مند: ${picksHere.map(p => p.profiles?.name).join("، ")}</span>` : ""}
                  </div>
                  <button class="btn btn-sm ${iPickedThis ? "btn-accept" : "btn-ghost"}" data-action="toggle-shift" ${disable ? "disabled" : ""} title="${iAmOffThisDay && !iPickedThis ? "این روز رو آف زدی" : ""}">
                    ${iPickedThis ? "انتخاب شد ✓" : "می‌خوام"}
                  </button>
                </div>`;
            }

            return `
              <div class="shift-row ${isMine ? "mine" : ""} ${assignment?.hasOpenSwap ? "swap-open" : ""}" data-assignment="${assignment?.id || ""}">
                <div class="row">
                  ${assignee ? avatarHTML(assignee) : ""}
                  <div class="meta">
                    ${periodChipHTML(per.key)}
                    <span class="assignee ${assignee ? "" : "empty"}">${assignee?.name || "خالی"}</span>
                  </div>
                </div>
                ${isMine ? `<button class="btn btn-sm btn-alert" data-action="request-swap">جایگزین</button>` : ""}
              </div>`;
          }).join("")}
        </div>
      `).join("")}

      ${isBidding ? `
        <div class="section-title">روز آف</div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          ${days.map((d) => {
            const selected = (offByDate[d.date] || []).some((p) => p.barista_id === me.id);
            const disable = !selected && myOffPicks.length >= 2;
            return `<button class="btn btn-sm ${selected ? "btn-accept" : "btn-ghost"}" data-off="${d.date}" ${disable ? "disabled" : ""}>${d.dayName}</button>`;
          }).join("")}
        </div>
      ` : ""}
    `;

    container.querySelector("#prevWeek").onclick = () => { weekOffset--; renderSchedule(container); };
    container.querySelector("#nextWeek").onclick = () => { weekOffset++; renderSchedule(container); };

    if (isBidding) {
      container.querySelectorAll('[data-action="toggle-shift"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const row = btn.closest("[data-pick]");
          const { date, period } = row.dataset;
          const existing = (pickMap[`${date}_${period}`] || []).find((p) => p.barista_id === me.id);
          try {
            if (existing) await removePick(existing.id);
            else await addPick({ weekId: week.id, baristaId: me.id, date, period, kind: "shift" });
          } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
          draw();
        });
      });
      container.querySelectorAll("[data-off]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const date = btn.dataset.off;
          const existing = (offByDate[date] || []).find((p) => p.barista_id === me.id);
          try {
            if (existing) await removePick(existing.id);
            else await addPick({ weekId: week.id, baristaId: me.id, date, period: null, kind: "day_off" });
          } catch (e) { toast(e.message || "مشکلی پیش اومد"); }
          draw();
        });
      });
    } else {
      container.querySelectorAll('[data-action="request-swap"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const assignmentId = btn.closest("[data-assignment]").dataset.assignment;
          const ok = await confirmAction("این شیفت رو برای جایگزینی بذارم تا بقیه ببینن؟");
          if (!ok) return;
          try {
            await createSwapRequest(assignmentId, me.id);
            toast("درخواست جایگزینی ثبت شد");
            draw();
          } catch (e) { toast("قبلاً برای این شیفت درخواست باز داری"); }
        });
      });
    }
  };

  await draw();

  if (unsub) unsub();
  unsub = subscribe("shift_assignments", { filter: `week_id=eq.${week.id}` }, draw);
}
