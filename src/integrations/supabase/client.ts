import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config";


// Browser client. The session is kept in cookies (not localStorage) so the
// Next.js proxy and server components can see who is signed in and redirect
// before any page JavaScript loads.
//
// import { supabase } from "@/integrations/supabase/client";
export const supabase = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
