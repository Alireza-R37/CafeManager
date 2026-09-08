export const DAY_NAMES = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
export const PERIODS = [
  { key: "morning", label: "صبح", time: "۷:۰۰ – ۱۴:۰۰" },
  { key: "middle", label: "میدل", time: "۱۲:۰۰ – ۱۹:۰۰" },
  { key: "night", label: "شب", time: "۱۸:۰۰ – ۲۳:۳۰" },
];

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// شروع هفته = نزدیک‌ترین شنبه‌ی قبل یا برابر با تاریخ
export function getWeekStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const jsDay = d.getDay(); // 0=Sun...6=Sat
  const diff = (jsDay - 6 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function weekDays(weekStartISO) {
  const start = new Date(weekStartISO);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    return { date: toISODate(d), dayName: DAY_NAMES[i], jsDate: d };
  });
}

export function formatDayMonth(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long" }).format(d);
}

export function periodLabel(key) {
  return PERIODS.find((p) => p.key === key)?.label ?? key;
}

export function initials(name) {
  return (name || "?").trim().slice(0, 1);
}

// رنگ ثابت برای آواتار وقتی پروفایل رنگ نداره
export function colorFromString(str) {
  const palette = ["#C9A227", "#6B8F71", "#B4432E", "#7C86C9", "#E3B341"];
  let hash = 0;
  for (const ch of str || "x") hash = (hash * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[Math.abs(hash) % palette.length];
}

// خروجی متنی جدول‌مانند برنامه‌ی هفته — برای کپی یا ارسال تلگرام
export function buildScheduleText(days, assignments, weekTitle = "") {
  const map = {};
  for (const a of assignments) map[`${a.date}_${a.period}`] = a.profiles?.name || "—";

  const lines = [];
  if (weekTitle) lines.push(`📅 ${weekTitle}`, "");
  for (const d of days) {
    lines.push(`${d.dayName}:`);
    for (const per of PERIODS) {
      lines.push(`  ${per.label}: ${map[`${d.date}_${per.key}`] || "—"}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
