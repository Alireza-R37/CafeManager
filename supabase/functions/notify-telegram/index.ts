// Supabase Edge Function: notify-telegram
// نصب: supabase functions deploy notify-telegram
// راه‌اندازی: supabase secrets set TELEGRAM_BOT_TOKEN=xxxx
//
// این فانکشن رو سه جور می‌شه صدا زد (همه از طریق Database Webhooks):
//  1) INSERT/UPDATE روی swap_requests → اطلاع‌رسانی درخواست/قبولی جایگزینی
//  2) UPDATE روی weeks (وقتی status می‌شه published) → ارسال جدول کامل هفته
//  3) صدا زدن مستقیم از اپ با { chat_id, message }
//
// بدنه‌ی درخواست وقتی از Database Webhook میاد:
// { type: "INSERT" | "UPDATE", table: "...", record: {...}, old_record: {...} }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DAY_NAMES = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const PERIOD_FA: Record<string, string> = { morning: "صبح", middle: "میدل", night: "شب" };

async function sendTelegram(chatId: string, text: string) {
  if (!BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

function formatDayMonthFa(dateStr: string) {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long" }).format(d);
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // حالت ساده: صدا زدن مستقیم با chat_id و message
    if (payload.chat_id && payload.message) {
      await sendTelegram(payload.chat_id, payload.message);
      return new Response("ok");
    }

    // ---------- swap_requests ----------
    if (payload.table === "swap_requests") {
      const record = payload.record;

      if (payload.type === "INSERT") {
        const { data: assignment } = await supabase
          .from("shift_assignments")
          .select("date, period, barista_id")
          .eq("id", record.assignment_id)
          .single();

        const { data: requester } = await supabase
          .from("profiles").select("name").eq("id", record.requested_by).single();

        const { data: others } = await supabase
          .from("profiles").select("telegram_chat_id").neq("id", record.requested_by);

        const text = `🔄 <b>درخواست جایگزینی شیفت</b>\n${requester?.name} شیفت ${PERIOD_FA[assignment?.period]} تاریخ ${assignment?.date} رو گذاشته برای جایگزینی.\nهر کی می‌تونه، تو اپ قبول کنه.`;

        for (const p of others ?? []) {
          if (p.telegram_chat_id) await sendTelegram(p.telegram_chat_id, text);
        }
      }

      if (payload.type === "UPDATE" && record.status === "accepted") {
        const { data: requester } = await supabase
          .from("profiles").select("name, telegram_chat_id").eq("id", record.requested_by).single();
        const { data: acceptor } = await supabase
          .from("profiles").select("name").eq("id", record.accepted_by).single();

        if (requester?.telegram_chat_id) {
          await sendTelegram(
            requester.telegram_chat_id,
            `✅ ${acceptor?.name} شیفتت رو قبول کرد و جایگزینت شد.`
          );
        }
      }
    }

    // ---------- weeks (انتشار برنامه‌ی هفته) ----------
    if (payload.table === "weeks" && payload.type === "UPDATE") {
      const record = payload.record;
      const wasPublished = payload.old_record?.status === "published";
      if (record.status === "published" && !wasPublished) {
        const { data: assignments } = await supabase
          .from("shift_assignments")
          .select("date, period, profiles(name)")
          .eq("week_id", record.id)
          .order("date");

        // گروه‌بندی بر اساس تاریخ
        const byDate: Record<string, Record<string, string>> = {};
        for (const a of assignments ?? []) {
          byDate[a.date] ??= {};
          byDate[a.date][a.period] = (a as any).profiles?.name || "—";
        }

        const dates = Object.keys(byDate).sort();
        const lines = [`📅 <b>برنامه‌ی هفته‌ی ${formatDayMonthFa(dates[0])} تا ${formatDayMonthFa(dates[dates.length - 1])}</b>`, ""];
        for (const date of dates) {
          const jsDay = new Date(date).getDay();
          const dayName = DAY_NAMES[(jsDay - 6 + 7) % 7]; // شنبه=0
          lines.push(`<b>${dayName}</b> (${formatDayMonthFa(date)})`);
          for (const p of ["morning", "middle", "night"]) {
            lines.push(`  ${PERIOD_FA[p]}: ${byDate[date][p] || "—"}`);
          }
          lines.push("");
        }
        const text = lines.join("\n").trim();

        const { data: everyone } = await supabase.from("profiles").select("telegram_chat_id");
        for (const p of everyone ?? []) {
          if (p.telegram_chat_id) await sendTelegram(p.telegram_chat_id, text);
        }
      }
    }

    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
});
