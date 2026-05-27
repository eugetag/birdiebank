/**
 * Public surface for the Supabase client.
 *
 * Importing this module (or `./client`) will throw at load time if the
 * NEXT_PUBLIC_SUPABASE_* env vars aren't set — so only import it from code
 * paths that need the remote database. Modules that should keep working
 * without Supabase configured (anything backed by localStorage today)
 * must NOT import from here.
 */
export { supabase } from "./client";
export type * from "./types";
