// Supabase Edge Function: notify-telegram
// payload ها: { action: "swap_created", assignment_id, requested_by } | { action: "swap_accepted", request_id }
//             { action: "week_published", week_id } | { chat_id, message }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// بدون این هدرها مرورگر اجازه‌ی صدا زدن فانکشن از سایت رو نمی‌ده (CORS)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAY_NAMES = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const PERIOD_FA: Record<string, string> = { morning: "صبح", middle: "میدل", night: "شب" };

// نشانه‌ی RLM اول هر خط، تا تلگرام متن فارسی رو راست‌چین نگه داره
const rtl = (line: string) => "\u200F" + line;
const rtlBlock = (text: string) => text.split("\n").map(rtl).join("\n");

function formatDayMonthFa(dateStr: string) {
  return new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long" }).format(new Date(dateStr));
}

async function sendTelegram(chatId: string, text: string) {
  if (!BOT_TOKEN) { console.error("TELEGRAM_BOT_TOKEN خالیه یا ست نشده"); return; }
  if (!chatId) { console.error("chat_id خالیه — این گیرنده رد شد"); return; }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  const body = await res.text();
  if (!res.ok) console.error("telegram sendMessage failed:", chatId, body);
  else console.log("telegram sendMessage OK:", chatId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const payload = await req.json();
    console.log("payload received:", JSON.stringify(payload));
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (payload.chat_id && payload.message) {
      await sendTelegram(payload.chat_id, payload.message);
      return new Response("ok", { headers: corsHeaders });
    }

    if (payload.action === "swap_created") {
      const { data: a } = await supabase.from("shift_assignments").select("date, period").eq("id", payload.assignment_id).single();
      const { data: requester } = await supabase.from("profiles").select("name").eq("id", payload.requested_by).single();
      const { data: others } = await supabase.from("profiles").select("telegram_chat_id").neq("id", payload.requested_by);
      const text = rtlBlock(`🔄 <b>درخواست جایگزینی شیفت</b>\n${requester?.name} شیفت ${PERIOD_FA[a?.period]} تاریخ ${formatDayMonthFa(a?.date)} رو گذاشته برای جایگزینی.\nهر کی می‌تونه، تو اپ قبول کنه.`);
      for (const p of others ?? []) if (p.telegram_chat_id) await sendTelegram(p.telegram_chat_id, text);
    }

    if (payload.action === "swap_accepted") {
      const { data: swap } = await supabase.from("swap_requests").select("requested_by, accepted_by").eq("id", payload.request_id).single();
      if (swap) {
        const { data: requester } = await supabase.from("profiles").select("name, telegram_chat_id").eq("id", swap.requested_by).single();
        const { data: acceptor } = await supabase.from("profiles").select("name").eq("id", swap.accepted_by).single();
        if (requester?.telegram_chat_id) await sendTelegram(requester.telegram_chat_id, rtl(`✅ ${acceptor?.name} شیفتت رو قبول کرد و جایگزینت شد.`));
      }
    }

    if (payload.action === "week_published") {
      const { data: assignments } = await supabase.from("shift_assignments").select("date, period, profiles(name)").eq("week_id", payload.week_id).order("date");
      const byDate: Record<string, Record<string, string>> = {};
      for (const a of assignments ?? []) {
        byDate[a.date] ??= {};
        byDate[a.date][a.period] = (a as any).profiles?.name || "—";
      }
      const dates = Object.keys(byDate).sort();
      if (dates.length) {
        const lines = [`📅 <b>برنامه‌ی هفته‌ی ${formatDayMonthFa(dates[0])} تا ${formatDayMonthFa(dates[dates.length - 1])}</b>`, ""];
        for (const date of dates) {
          lines.push(`<b>${DAY_NAMES[(new Date(date).getDay() - 6 + 7) % 7]}</b> (${formatDayMonthFa(date)})`);
          for (const p of ["morning", "middle", "night"]) lines.push(`  ${PERIOD_FA[p]}: ${byDate[date][p] || "—"}`);
          lines.push("");
        }
        const text = lines.map((l) => (l ? rtl(l) : l)).join("\n").trim();
        const { data: everyone } = await supabase.from("profiles").select("telegram_chat_id");
        for (const p of everyone ?? []) if (p.telegram_chat_id) await sendTelegram(p.telegram_chat_id, text);
      }
    }

    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500, headers: corsHeaders });
  }
});
