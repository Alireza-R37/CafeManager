import {
  getWeekByStart, getOrCreateWeek, getPicksForWeek, getAssignmentsForWeek, ensureAssignmentSlots,
  setWeekStatus, setWeekDeadline, listStaff, finalizeBidding, regenerateSchedule, clearAutoAssignments, setAssignment,
} from "../data.js";
import { supabase } from "../supabaseClient.js";
import { toISODate, getWeekStart, addDays, weekDays, formatDayMonth, PERIODS, buildScheduleText } from "../utils.js";
import { avatarHTML, periodChipHTML, toast, confirmAction } from "../ui.js";

let weekOffset = 0;
const STATUS_LABEL = { bidding: "در حال رأی‌گیری", draft: "پیش‌نویس — منتظر تأیید", published: "منتشرشده", locked: "قفل" };

function toLocalInputValue(iso) {
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function renderAdmin(container) {
  const baseStart = toISODate(addDays(getWeekStart(new Date()), weekOffset * 7));
  container.innerHTML = `<div class="empty-state"><div class="big">☕</div><p>در حال بارگذاری…</p></div>`;

  let week = await getWeekByStart(baseStart);
  if (!week) week = await getOrCreateWeek(weekOffset);
  const days = weekDays(baseStart);
  await ensureAssignmentSlots(week.id, days);
  const [assignments, picks, team] = await Promise.all([getAssignmentsForWeek(week.id), getPicksForWeek(week.id), listStaff()]);

  const assignmentMap = {};
  for (const a of assignments) assignmentMap[`${a.date}_${a.period}`] = a;
  const pickMap = {};
  for (const p of picks.filter((p) => p.kind === "shift")) (pickMap[`${p.date}_${p.period}`] ||= []).push(p);
  const sourceBadge = { pick: "🙋 خودش انتخاب کرد", auto: "🤖 خودکار", admin: "✋ دستی", swap: "🔄 جایگزینی" };

  container.innerHTML = `
    <div class="week-nav"><button id="prevWeek">›</button><div class="label">هفته‌ی ${formatDayMonth(days[0].date)}</div><button id="nextWeek">‹</button></div>
    <div class="card">
      <strong>وضعیت: ${STATUS_LABEL[week.status]}</strong>
      ${week.status === "bidding" ? `
        <p class="hint mt-2">تا این مهلت، باریستاها شیفت/آف‌شون رو انتخاب می‌کنن. بعدش می‌تونی برنامه رو خودکار بسازی.</p>
        <label class="mt-4">مهلت انتخاب (اختیاری)</label>
        <input type="datetime-local" id="deadlineInput" value="${week.bidding_deadline ? toLocalInputValue(week.bidding_deadline) : ""}" />
        <button class="btn btn-ghost btn-sm" id="saveDeadline">ذخیره مهلت</button>
        <button class="btn btn-primary btn-block mt-4" id="finalizeBtn">🤖 بستن رأی‌گیری و تولید خودکار برنامه</button>` : ""}
      ${week.status === "draft" ? `
        <p class="hint mt-2">این برنامه رو مرور کن، هر جا خواستی با کشوی کنارش دستی عوضش کن، بعد تأیید نهایی بزن.</p>
        <div class="row mt-4" style="flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="regenBtn">↺ پاک کردن پیشنهادهای خودکار و تولید دوباره</button>
          <button class="btn btn-primary btn-sm" id="publishBtn">✅ تأیید و انتشار (نوتیف برای همه)</button>
        </div>` : ""}
      ${week.status === "published" ? `
        <div class="row mt-2" style="flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="textExportBtn">📋 خروجی متنی جدول</button>
          <button class="btn btn-ghost btn-sm" id="lockBtn">قفل کردن هفته</button>
        </div>` : ""}
    </div>

    ${days.map((d) => `
      <div class="day-block">
        <div class="day-label">${d.dayName} — ${formatDayMonth(d.date)}</div>
        ${PERIODS.map((per) => {
          const key = `${d.date}_${per.key}`, a = assignmentMap[key], interested = pickMap[key] || [];
          return `
            <div class="shift-row">
              <div class="meta">${periodChipHTML(per.key)}
                ${interested.length ? `<span class="hint">علاقه‌مند: ${interested.map((p) => p.profiles?.name).join("، ")}</span>` : ""}
                ${a?.barista_id && a.source ? `<span class="hint">${sourceBadge[a.source] || ""}</span>` : ""}</div>
              <select data-assignment="${a?.id}"><option value="">— خالی —</option>
                ${team.map((t) => `<option value="${t.id}" ${a?.barista_id === t.id ? "selected" : ""}>${t.name}</option>`).join("")}</select>
            </div>`;
        }).join("")}
      </div>`).join("")}

    <div class="section-title">تنظیمات تیم (چت‌آیدی تلگرام)</div>
    <div class="card">
      ${team.map((t) => `<div class="row" style="margin-bottom:10px">${avatarHTML(t)}<span style="width:70px">${t.name}</span>
        <input data-tg="${t.id}" placeholder="chat id تلگرام" value="${t.telegram_chat_id || ""}" style="margin:0" /></div>`).join("")}
      <button class="btn btn-ghost btn-block" id="saveTg">ذخیره چت‌آیدی‌ها</button>
      <p class="hint mt-2">هر باریستا باید با بات کافه چت رو Start کرده باشه و عدد Id خودش (از @userinfobot) رو بده.</p>
    </div>`;

  const $ = (s) => container.querySelector(s);
  $("#prevWeek").onclick = () => { weekOffset--; renderAdmin(container); };
  $("#nextWeek").onclick = () => { weekOffset++; renderAdmin(container); };

  container.querySelectorAll("select[data-assignment]").forEach((sel) => sel.addEventListener("change", async () => {
    try { await setAssignment(sel.dataset.assignment, sel.value || null); toast("ذخیره شد"); }
    catch (e) { toast(e.message || "مشکلی پیش اومد"); }
  }));

  $("#saveDeadline")?.addEventListener("click", async () => {
    const val = $("#deadlineInput").value;
    if (!val) return toast("یه تاریخ/ساعت انتخاب کن");
    try { await setWeekDeadline(week.id, new Date(val).toISOString()); toast("مهلت ذخیره شد"); } catch (e) { toast("مشکلی پیش اومد"); }
  });

  const fin = $("#finalizeBtn");
  fin?.addEventListener("click", async () => {
    if (!(await confirmAction("رأی‌گیری بسته بشه و برنامه‌ی خودکار ساخته بشه؟ بعداً می‌تونی دستی ویرایشش کنی."))) return;
    fin.disabled = true; fin.textContent = "در حال ساخت برنامه…";
    try { await finalizeBidding(week.id); toast("برنامه ساخته شد — مرورش کن"); renderAdmin(container); }
    catch (e) { toast(e.message || "مشکلی پیش اومد"); fin.disabled = false; fin.textContent = "🤖 بستن رأی‌گیری و تولید خودکار برنامه"; }
  });

  $("#regenBtn")?.addEventListener("click", async () => {
    if (!(await confirmAction("پیشنهادهای خودکار (نه ویرایش‌های دستی‌ات) پاک و دوباره ساخته بشن؟"))) return;
    try { await clearAutoAssignments(week.id); await regenerateSchedule(week.id); toast("دوباره ساخته شد"); renderAdmin(container); }
    catch (e) { toast(e.message || "مشکلی پیش اومد"); }
  });

  $("#publishBtn")?.addEventListener("click", async () => {
    const empty = assignments.filter((a) => !a.barista_id).length;
    if (empty > 0 && !(await confirmAction(`${empty} شیفت هنوز خالیه. مطمئنی می‌خوای منتشر کنی؟`))) return;
    try { await setWeekStatus(week.id, "published"); toast("برنامه منتشر شد و نوتیف رفت"); renderAdmin(container); }
    catch (e) { toast(e.message || "مشکلی پیش اومد"); }
  });

  $("#lockBtn")?.addEventListener("click", async () => { await setWeekStatus(week.id, "locked"); toast("هفته قفل شد"); renderAdmin(container); });

  $("#textExportBtn")?.addEventListener("click", async () => {
    const text = buildScheduleText(days, assignments, `برنامه هفته ${formatDayMonth(days[0].date)}`);
    try { await navigator.clipboard.writeText(text); toast("خروجی متنی کپی شد"); } catch { window.prompt("این متن رو کپی کن:", text); }
  });

  $("#saveTg").addEventListener("click", async () => {
    try {
      for (const inp of container.querySelectorAll("[data-tg]"))
        await supabase.from("profiles").update({ telegram_chat_id: inp.value.trim() || null }).eq("id", inp.dataset.tg);
      toast("ذخیره شد");
    } catch (e) { toast("مشکلی پیش اومد"); }
  });
}
