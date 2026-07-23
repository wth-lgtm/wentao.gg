import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

// Unique-visitor counter. Runs server-side with the service_role key (never exposed to the
// browser) so it bypasses RLS on the locked-down `site_stats` table. Dedup is a first-party
// cookie: a visitor is counted once, then repeat visits only read back the current total.
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env and the SQL in
// supabase/visitors.sql applied. If the env is missing or anything fails, it degrades to
// { count: null } so the UI simply renders no counter (nothing breaks).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "wt_seen";
const ONE_YEAR = 60 * 60 * 24 * 365;

function toCount(v: unknown): number | null {
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ count: null });

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const jar = await cookies();
    const returning = jar.has(COOKIE);

    let count: number | null = null;
    if (returning) {
      const { data } = await supabase
        .from("site_stats")
        .select("value")
        .eq("key", "unique_visitors")
        .single();
      count = toCount(data?.value);
    } else {
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
