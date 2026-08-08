// Supabase client — anon/publishable key is safe to ship to the browser by
// design; all data access is enforced server-side by RLS (user_profiles roles).
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://nlymvuwafgiudbqsyfem.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5seW12dXdhZmdpdWRicXN5ZmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNDQ1ODgsImV4cCI6MjEwMTcyMDU4OH0._OiCurl8MSzMRGc3FSs9UlhcrNBzQH0ZKkHejePhrwE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** app login 用 username（例如 pbadmin）→ 對應 auth email */
export function usernameToEmail(username: string): string {
  const u = username.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@pbhk.info`;
}
