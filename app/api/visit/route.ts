import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

// PAGE VISIT counter — visits, not unique people. Coming back tomorrow counts again, and
// so does a second look ten minutes later. Runs server-side with the service_role key
// (never exposed to the browser) so it bypasses RLS on the locked-down `site_stats` table.
// Every request — counted or not — returns the LIVE total.
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + supabase/visitors.sql.
// Degrades to { count: null } (UI renders nothing) if anything is missing.
//
// ── Why counting visits needs more care than counting devices ──────────────────────────
// Three layers stand between "every visit counts" and "anyone can run the number up":
//
//   1. isSameOrigin() — blocks the drive-by case: a third-party page firing a CORS-simple
//      POST at this endpoint. Worth knowing its limit: `sec-fetch-site` cannot be set by
//      browser SCRIPT, which is what makes it good at that job, but a non-browser client
//      can send whatever headers it likes. So this stops cross-site abuse, not a script.
//   2. VISIT_GAP_MS — a per-device floor. Its real job is correctness, not defence: React
//      StrictMode invokes effects twice in dev and any remount re-fires the POST, so
//      without a floor a single page load could count two or three times.
//   3. IP_GAP_MS — a best-effort per-IP floor held in memory. NOT shared between serverless
//      instances, so it is not a guarantee — but a flood from one source keeps hitting the
//      same warm instance, which is exactly the case it blunts, for zero storage.
//
// The durable cap is a rate-limit rule at the edge (Vercel WAF: ~10 req / 10 min / IP on
// this path), because that is the only layer that rejects a flood BEFORE the function runs
// and therefore before it costs an invocation. That is dashboard config, not code.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "wt_last"; // millisecond timestamp of this device's last COUNTED visit
const ONE_YEAR = 60 * 60 * 24 * 365;

// Long enough to swallow a StrictMode double-fire or a fat-fingered double-tap, short
// enough that any visit a human would call "another visit" still counts.
const VISIT_GAP_MS = 5_000;
const IP_GAP_MS = 2_000;
const IP_MAX_KEYS = 5_000;

// Ephemeral, per-instance. An IP is used ONLY as a throttle key here: never stored in
// Supabase, never logged, never returned in the response.
const lastByIp = new Map<string, number>();

function ipThrottled(ip: string, now: number): boolean {
  if (!ip) return false; // no usable IP → fall back to the other two layers
  const prev = lastByIp.get(ip);
  if (prev !== undefined && now - prev < IP_GAP_MS) return true;
  lastByIp.set(ip, now);
  // Bound the map so a long-lived instance can't accumulate keys forever.
  if (lastByIp.size > IP_MAX_KEYS) {
    const oldest = [...lastByIp.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, Math.floor(IP_MAX_KEYS / 10));
    for (const [key] of oldest) lastByIp.delete(key);
  }
  return false;
}

function isPrivate(ip: string): boolean {
  return (
    !ip ||
    ip === "::1" ||
    ip === "0.0.0.0" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith("fe80") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  );
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  for (const part of fwd.split(",")) {
    const ip = part.trim().replace(/^::ffff:/, "");
    if (ip && !isPrivate(ip)) return ip;
  }
  return "";
}

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
    const now = Date.now();
    const last = Number(jar.get(COOKIE)?.value);
    // A visit counts once its own device has been quiet for VISIT_GAP_MS. An unparseable or
    // absent cookie reads as "never counted", which is the correct default for a new device.
    const settled = !Number.isFinite(last) || now - last >= VISIT_GAP_MS;

    const mayCount = settled && isSameOrigin(req) && !ipThrottled(clientIp(req), now);

    let count: number | null;
    if (mayCount) {
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
    // Stamp only when an increment actually happened, so a blocked request never pushes a
    // real visitor's window forward.
    if (mayCount) {
      res.cookies.set(COOKIE, String(now), {
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
