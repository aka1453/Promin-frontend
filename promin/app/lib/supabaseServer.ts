// app/lib/supabaseServer.ts
// Server-side Supabase client using @supabase/ssr + Next.js cookies().
// Call createSupabaseServer() inside Server Actions / Route Handlers.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll can throw when called from a Server Component (read-only context).
          // That is fine — cookies only need to be writable in Server Actions / Route Handlers.
        }
      },
    },
  });
}
