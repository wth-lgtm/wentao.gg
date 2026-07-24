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

// The cookie alone is not a gate — the caller decides whether to send it. Without an
// origin check, `fetch('https://wentao.gg/api/visit', { method: 'POST' })` from ANY
// third-party page is a CORS-simple request (no preflight to block it) that increments
// the counter with the service-role key, permanently and with no reset path.
//
// Fetch Metadata is the primary signal: browsers always send sec-fetch-site on fetch(),
// and it cannot be set by script. Origin is the fallback for anything that omits it, and
// a client sending neither (curl) fails closed — the only legitimate caller is this
// site's own client-side fetch, which always sends both.
function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ count: null });

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const jar = await cookies();
    const returning = jar.has(COOKIE);
    // Only a first-time device arriving from our own pages may increment. Everyone else —
    // returning devices, cross-site callers, scripts — still gets the live total, since
    // the number is public in the UI anyway; they just cannot move it.
    const mayCount = !returning && isSameOrigin(req);

    let count: number | null;
    if (mayCount) {
      // New device → count it and return the new total.
      const { data } = await supabase.rpc("increment_visitors");
      count = toCount(data);
    } else {
      const { data } = await supabase
        .from("site_stats")
        .select("value")
        .eq("key", "unique_visitors")
        .single();
      count = toCount(data?.value);
    }

    const res = NextResponse.json({ count });
    // Set the marker only when an increment actually happened, so a blocked cross-site
    // POST can't silently burn this device's one chance to be counted for real.
    if (mayCount) {
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
