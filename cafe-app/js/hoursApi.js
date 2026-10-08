import { supabase } from "./supabaseClient.js";

export async function getServerNow() {
  const { data, error } = await supabase.rpc("server_now");
  if (error) throw error;
  return new Date(data);
}
export async function clockIn() {
  const { error } = await supabase.rpc("clock_in");
  if (error) throw error;
}
export async function clockOut() {
  const { error } = await supabase.rpc("clock_out");
  if (error) throw error;
}
export async function getOpenEntry(baristaId) {
  const { data, error } = await supabase.from("time_entries").select("*")
    .eq("barista_id", baristaId).is("clock_out", null).maybeSingle();
  if (error) throw error;
  return data;
}
export async function listTimeEntries({ baristaId = null, fromISO, toISO }) {
  let q = supabase.from("time_entries").select("*")
    .gte("clock_in", fromISO).lt("clock_in", toISO).order("clock_in", { ascending: false });
  if (baristaId) q = q.eq("barista_id", baristaId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
export async function adminSaveEntry({ id, baristaId, clockIn, clockOut, editedBy }) {
  const row = { barista_id: baristaId, clock_in: clockIn, clock_out: clockOut, edited_by: editedBy };
  const { error } = id
    ? await supabase.from("time_entries").update(row).eq("id", id)
    : await supabase.from("time_entries").insert(row);
  if (error) throw error;
}
export async function adminDeleteEntry(id) {
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) throw error;
}
