import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client with service role key.
 * Use only in API routes and server actions that require elevated privileges.
 * Never expose this client to the browser.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
