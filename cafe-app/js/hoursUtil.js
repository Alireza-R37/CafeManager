import { addDays, getWeekStart } from "./utils.js";
export { addDays };

const FA_CAL = "fa-IR-u-nu-latn-ca-persian";
const faNum = new Intl.NumberFormat("fa-IR");

function persianDay(date) {
  const parts = new Intl.DateTimeFormat(FA_CAL, { month: "numeric", day: "numeric" }).formatToParts(date);
  return Number(parts.find((p) => p.type === "day").value);
}
// بازه‌ی ماه شمسیِ شامل این تاریخ: [start, end)
export function monthRange(ref = new Date()) {
  const d0 = new Date(ref); d0.setHours(0, 0, 0, 0);
  const start = addDays(d0, -(persianDay(d0) - 1));
  let end = addDays(start, 28);
  while (persianDay(end) !== 1) end = addDays(end, 1);
  return { start, end };
}
export function weekRange(ref = new Date()) {
  const start = getWeekStart(ref);
  return { start, end: addDays(start, 7) };
}
export function monthLabel(d) {
  return new Intl.DateTimeFormat("fa-IR", { month: "long", year: "numeric" }).format(d);
}
export function formatDuration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${faNum.format(m)} دقیقه`;
  return m ? `${faNum.format(h)} ساعت و ${faNum.format(m)} دقیقه` : `${faNum.format(h)} ساعت`;
}
export function formatClock(d) {
  return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
}
export function formatDayFull(d) {
  return new Intl.DateTimeFormat("fa-IR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(d));
}
export function toLocalInput(iso) {
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// ثبتِ باز تا همین لحظه (زمان سرور) حساب می‌شه
export function sumMs(entries, now) {
  return entries.reduce((s, e) =>
    s + Math.max(0, (e.clock_out ? new Date(e.clock_out) : now) - new Date(e.clock_in)), 0);
}
