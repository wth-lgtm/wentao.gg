import { NextResponse } from "next/server";

// Server-side IP geolocation via ip-api.com (free, no key). Empirically it matches the
// IP2Location data that whatismyipaddress shows for our data-center IPs — City = San
// Francisco, org = "Mercor.io Corporation" — and unlike MaxMind-based APIs (which place
// this IP in Atlanta) it's accurate. Called server-side so ip-api's HTTP-only free tier is
// fine. Resolves the VISITOR's own IP: their forwarded IP in prod; on localhost that's ::1,
// so we omit it and ip-api geolocates the dev server's own public IP (your machine) —
// matching prod. Degrades to {} (client falls back to public providers) on any failure.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function firstPublicIp(fwd: string): string {
  for (const part of fwd.split(",")) {
    const ip = part.trim().replace(/^::ffff:/, "");
    if (ip && !isPrivate(ip)) return ip;
  }
  return "";
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  try {
    const fwd = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
    const ip = firstPublicIp(fwd);
    const fields = "status,query,city,regionName,countryCode,lat,lon,org,isp";
    // With no IP, ip-api geolocates the caller (the dev server on localhost → your machine).
    const url = `http://ip-api.com/json/${ip ? encodeURIComponent(ip) : ""}?fields=${fields}`;

    // ip-api's free tier allows 45 req/min PER CALLING IP, and on Vercel that is a shared
    // egress address — so an unthrottled 1:1 fan-out lets one loop get the whole site
    // banned, after which this returns {} and the client starts shipping visitor IPs to
    // three public providers instead. The Data Cache key is the full URL, which already
    // contains the visitor's own IP, so each IP caches independently and no visitor's
    // location is ever served to a different visitor — repeat hits just stop going
    // upstream. The timeout keeps a hung provider from pinning the function.
    const r = await fetch(url, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return NextResponse.json({});
    const d = await r.json();
    if (!d || d.status !== "success") return NextResponse.json({});

    // isp = carrier / ASN (e.g. Zayo Bandwidth); org = end-customer org (e.g. Mercor.io
    // Corporation — what whatismyipaddress labels "ISP"). Return both.
    return NextResponse.json({
      ip: typeof d.query === "string" ? d.query : ip,
      city: typeof d.city === "string" ? d.city : "",
      region: typeof d.regionName === "string" ? d.regionName : "",
      country_code: typeof d.countryCode === "string" ? d.countryCode : "",
      latitude: toNum(d.lat),
      longitude: toNum(d.lon),
      isp: typeof d.isp === "string" ? d.isp : "",
      org: typeof d.org === "string" ? d.org : "",
    });
  } catch {
    return NextResponse.json({});
  }
}
