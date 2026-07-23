import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

// Page visit counter. Runs server-side with the service_role key (never exposed to the
// browser) so it bypasses RLS on the locked-down `site_stats` table. Deduped per device via
// a first-party cookie: a device is counted once (atomic RPC increment), and every load —
// new or returning — returns the LIVE total, so the number grows over time and differs from
// device to device. Clearing cookies / a new device counts again (cookie-granularity).
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + supabase/visitors.sql.
// Degrades to { count: null } (UI renders no prompt) if anything is missing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "wt_seen";
const ONE_YEAR = 60 * 60 * 24 * 365;

function toCount(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ count: null });

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const jar = await cookies();
    const returning = jar.has(COOKIE);

    let count: number | null;
    if (returning) {
      // Seen before → don't double-count; just read the live total.
      const { data } = await supabase
        .from("site_stats")
        .select("value")
        .eq("key", "unique_visitors")
        .single();
      count = toCount(data?.value);
    } else {
      // New device → count it and return the new total.
      const { data } = await supabase.rpc("increment_visitors");
      count = toCount(data);
    }

    const res = NextResponse.json({ count });
    if (!returning) {
      res.cookies.set(COOKIE, "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: ONE_YEAR,
        path: "/",
      });
    }
    return res;
  } catch {
    return NextResponse.json({ count: null });
  }
}
