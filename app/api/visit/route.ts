import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

// Unique-visitor counter. Runs server-side with the service_role key (never exposed to the
// browser) so it bypasses RLS on the locked-down `site_stats` table. A first-party cookie
// stores the visitor's assigned ORDINAL: new visitors get the next number (atomic RPC
// increment) and it's saved to their cookie; returning visitors get their number straight
// from the cookie — no DB hit, and they keep the same "you're the Nth visitor" forever.
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + supabase/visitors.sql.
// Degrades to { ordinal: null } (UI renders no prompt) if anything is missing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "wt_vid";
const ONE_YEAR = 60 * 60 * 24 * 365;

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export async function POST() {
  const jar = await cookies();
  const existing = toInt(jar.get(COOKIE)?.value);
  if (existing) return NextResponse.json({ ordinal: existing });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ordinal: null });

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await supabase.rpc("increment_visitors");
    const ordinal = toInt(data);
    const res = NextResponse.json({ ordinal });
    if (ordinal) {
      res.cookies.set(COOKIE, String(ordinal), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: ONE_YEAR,
        path: "/",
      });
    }
    return res;
  } catch {
    return NextResponse.json({ ordinal: null });
  }
}
