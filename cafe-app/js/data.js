import { supabase } from "./supabaseClient.js";
import { toISODate, getWeekStart, addDays } from "./utils.js";

// پیام تلگرام: مستقیم از اپ فانکشن notify-telegram صدا زده می‌شه؛ خطاش کار اصلی رو خراب نمی‌کنه
async function notify(action, extra = {}) {
  try { await supabase.functions.invoke("notify-telegram", { body: { action, ...extra } }); }
  catch (e) { console.warn("notify-telegram failed:", e); }
}

// ---------- Weeks ----------
export async function getOrCreateWeek(offsetWeeks = 0) {
  const startISO = toISODate(addDays(getWeekStart(new Date()), offsetWeeks * 7));
  const { data, error } = await supabase.from("weeks").select("*").eq("start_date", startISO).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const ins = await supabase.from("weeks").insert({ start_date: startISO, status: "bidding" }).select().single();
  if (ins.error) throw ins.error;
  return ins.data;
}
export async function getWeekByStart(startISO) {
  const { data, error } = await supabase.from("weeks").select("*").eq("start_date", startISO).maybeSingle();
  if (error) throw error;
  return data;
}
export async function setWeekStatus(weekId, status) {
  const { error } = await supabase.from("weeks").update({ status }).eq("id", weekId);
  if (error) throw error;
  if (status === "published") notify("week_published", { week_id: weekId });
}
export async function setWeekDeadline(weekId, iso) {
  const { error } = await supabase.from("weeks").update({ bidding_deadline: iso }).eq("id", weekId);
  if (error) throw error;
}
export async function finalizeBidding(weekId) {
  const { error } = await supabase.rpc("finalize_bidding", { p_week_id: weekId });
  if (error) throw error;
}
export async function regenerateSchedule(weekId) {
  const { error } = await supabase.rpc("generate_schedule", { p_week_id: weekId });
  if (error) throw error;
}
export async function clearAutoAssignments(weekId) {
  const { error } = await supabase.rpc("clear_auto_assignments", { p_week_id: weekId });
  if (error) throw error;
}

// ---------- Team ----------
export async function listBaristas() {
  const { data, error } = await supabase.from("profiles").select("*").order("name");
  if (error) throw error;
  return data;
}
// فقط باریستاها (ادمین قابل‌انتخاب برای شیفت نیست)
export async function listStaff() {
  const { data, error } = await supabase.from("profiles").select("*").eq("role", "barista").order("name");
  if (error) throw error;
  return data;
}

// ---------- Picks ----------
export async function getPicksForWeek(weekId) {
  const { data, error } = await supabase.from("shift_picks").select("*, profiles(name,color)").eq("week_id", weekId);
  if (error) throw error;
  return data;
}
export async function addPick({ weekId, baristaId, date, period, kind }) {
  const { error } = await supabase.from("shift_picks").insert({ week_id: weekId, barista_id: baristaId, date, period, kind });
  if (error) throw error;
}
export async function removePick(pickId) {
  const { error } = await supabase.from("shift_picks").delete().eq("id", pickId);
  if (error) throw error;
}

// ---------- Assignments ----------
export async function getAssignmentsForWeek(weekId) {
  const { data, error } = await supabase.from("shift_assignments").select("*, profiles(name,color)").eq("week_id", weekId).order("date");
  if (error) throw error;
  return data;
}
export async function ensureAssignmentSlots(weekId, days) {
  const rows = [];
  for (const d of days) for (const period of ["morning", "middle", "night"]) rows.push({ week_id: weekId, date: d.date, period });
  const { error } = await supabase.from("shift_assignments").upsert(rows, { onConflict: "week_id,date,period", ignoreDuplicates: true });
  if (error) throw error;
}
export async function setAssignment(assignmentId, baristaId) {
  const { error } = await supabase.from("shift_assignments").update({ barista_id: baristaId, source: "admin" }).eq("id", assignmentId);
  if (error) throw error;
}

// ---------- Swaps ----------
export async function createSwapRequest(assignmentId, requestedBy, note = null) {
  const { error } = await supabase.from("swap_requests").insert({ assignment_id: assignmentId, requested_by: requestedBy, note });
  if (error) throw error;
  notify("swap_created", { assignment_id: assignmentId, requested_by: requestedBy });
}
export async function cancelSwapRequest(requestId) {
  const { error } = await supabase.from("swap_requests").update({ status: "cancelled" }).eq("id", requestId);
  if (error) throw error;
}
export async function listOpenSwaps() {
  const { data, error } = await supabase.from("swap_requests")
    .select("*, shift_assignments(date,period,week_id), profiles!swap_requests_requested_by_fkey(name,color)")
    .eq("status", "open").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
export async function acceptSwap(requestId) {
  const { error } = await supabase.rpc("accept_swap", { p_request_id: requestId });
  if (error) throw error;
  notify("swap_accepted", { request_id: requestId });
}

// ---------- Checklists ----------
export async function getTemplate(type) {
  const { data, error } = await supabase.from("checklist_templates").select("*, checklist_template_items(*)").eq("type", type).single();
  if (error) throw error;
  data.checklist_template_items.sort((a, b) => a.order_index - b.order_index);
  return data;
}
export async function getOrCreateRun(templateId, dateISO, startedBy) {
  const sel = "*, checklist_run_items(*, profiles(name))";
  const { data } = await supabase.from("checklist_runs").select(sel).eq("template_id", templateId).eq("run_date", dateISO).maybeSingle();
  if (data) return data;
  const run = await supabase.from("checklist_runs").insert({ template_id: templateId, run_date: dateISO, started_by: startedBy }).select().single();
  if (run.error) throw run.error;
  const { data: items } = await supabase.from("checklist_template_items").select("id").eq("template_id", templateId);
  await supabase.from("checklist_run_items").insert(items.map((it) => ({ run_id: run.data.id, item_id: it.id })));
  const again = await supabase.from("checklist_runs").select(sel).eq("id", run.data.id).single();
  return again.data;
}
export async function toggleChecklistItem(runItemId) {
  const { error } = await supabase.rpc("toggle_checklist_item", { p_run_item_id: runItemId });
  if (error) throw error;
}

// ---------- Realtime ----------
export function subscribe(table, filter, onChange) {
  const channel = supabase.channel(`rt-${table}-${Math.random()}`)
    .on("postgres_changes", { event: "*", schema: "public", table, ...filter }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
