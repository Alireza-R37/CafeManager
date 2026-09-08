import { supabase } from "./supabaseClient.js";

let currentProfile = null;

export async function getTeamDirectory() {
  const { data, error } = await supabase.from("team_directory").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  currentProfile = null;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function loadProfile() {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) { currentProfile = null; return null; }

  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", session.user.id).single();
  if (error) throw error;
  currentProfile = data;
  return data;
}

export function getCurrentProfile() {
  return currentProfile;
}

export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session));
}
