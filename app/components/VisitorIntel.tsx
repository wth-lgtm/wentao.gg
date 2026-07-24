"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import LocatorMap from "./LocatorMap";
import ScrambleText from "./ScrambleText";
import { getVisitorData, type VisitorData } from "./visitorData";
import { HOME, formatDistance, greatCircleKm } from "../lib/telemetry";

// A browser-side geo lookup used as a FALLBACK when Vercel's edge geo headers come back
// thin (common for VPNs / mobile carriers / IPv6 — you get an IP but no city). The visitor
// resolves their OWN IP; nothing is stored.
interface ApiGeo {
  ip: string;
  location: string;
  city: string;
  isp: string; // carrier / ASN (e.g. "Zayo Bandwidth")
  org: string; // end-customer org (e.g. "Mercor.io Corporation")
  cc: string; // ISO country code — picks miles vs kilometres for the DIST row
  lat: number | null;
  lon: number | null;
}

function flagFromCode(cc: unknown): string {
  if (typeof cc !== "string" || cc.length !== 2) return "";
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Loopback / private-range IPs (e.g. ::1 on localhost) — don't display these; prefer the
// public IP the geo provider sees.
function isPrivateIp(ip: string): boolean {
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

interface RawGeo {
  ip: string;
  city: string;
  region: string;
  cc: string; // ISO country code
  isp: string; // carrier / ASN
  org: string; // end-customer org
  lat: number;
  lon: number;
}

// Ordered geo providers, best-first. Accuracy varies a LOT on data-center IPs: our /api/geo
// (ip-api.com, server-side) matches whatismyipaddress → San Francisco + "Mercor.io
// Corporation"; ipinfo lands in the right metro (→ San Jose); ipwho.is (MaxMind) can be far
// off (→ Atlanta); geojs is country-only. Take the first city-level hit, else the first
// result that at least has coordinates.
const GEO_PROVIDERS: {
  url: string;
  adapt: (d: Record<string, unknown>) => RawGeo | null;
}[] = [
  {
    // Our own server route → ip-api.com. Returns {} (→ null here) on failure.
    url: "/api/geo",
    adapt: (d) =>
      d.city || d.latitude != null
        ? { ip: str(d.ip), city: str(d.city), region: str(d.region), cc: str(d.country_code), isp: str(d.isp), org: str(d.org), lat: Number(d.latitude), lon: Number(d.longitude) }
        : null,
  },
  {
    url: "https://ipinfo.io/json",
    adapt: (d) => {
      const loc = str(d.loc);
      const [lat, lon] = loc ? loc.split(",").map(Number) : [NaN, NaN];
      return { ip: str(d.ip), city: str(d.city), region: str(d.region), cc: str(d.country), isp: "", org: "", lat, lon };
    },
  },
  {
    url: "https://ipwho.is/",
    adapt: (d) =>
      d.success === false
        ? null
        : { ip: str(d.ip), city: str(d.city), region: str(d.region), cc: str(d.country_code), isp: "", org: "", lat: Number(d.latitude), lon: Number(d.longitude) },
  },
  {
    url: "https://get.geojs.io/v1/ip/geo.json",
    adapt: (d) => ({ ip: str(d.ip), city: str(d.city), region: str(d.region), cc: str(d.country_code), isp: "", org: "", lat: Number(d.latitude), lon: Number(d.longitude) }),
  },
];

function toApiGeo(r: RawGeo): ApiGeo {
  const city = r.city.trim();
  // City + region only; the flag conveys the country, so we skip the (long) country name
  // to keep the line short on mobile.
  const parts = [city, r.region].filter((p) => p && p.trim());
  const flag = flagFromCode(r.cc);
  const location = parts.length ? `${parts.join(", ")}${flag ? ` ${flag}` : ""}` : "";
  const fix =
    Number.isFinite(r.lat) && Number.isFinite(r.lon) && !(r.lat === 0 && r.lon === 0);
  return { ip: r.ip, location, city, isp: r.isp, org: r.org, cc: r.cc, lat: fix ? r.lat : null, lon: fix ? r.lon : null };
}

async function fetchGeo(signal: AbortSignal): Promise<ApiGeo | null> {
  let coordsOnly: ApiGeo | null = null;
  for (const p of GEO_PROVIDERS) {
    if (signal.aborted) return null;
    try {
      const r = await fetch(p.url, { signal });
      if (!r.ok) continue;
      const raw = p.adapt((await r.json()) as Record<string, unknown>);
      if (!raw) continue;
      const g = toApiGeo(raw);
      if (g.city) return g;
      if (g.lat !== null && !coordsOnly) coordsOnly = g;
    } catch {
      if (signal.aborted) return null;
    }
  }
  return coordsOnly;
}

export default function VisitorIntel() {
  const reduce = useReducedMotion() ?? false;
  const [data, setData] = useState<VisitorData | null>(null);
  const [api, setApi] = useState<ApiGeo | null>(null);
  const [probing, setProbing] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [located, setLocated] = useState(false);

  // Read the visitor cookie for an instant first-paint hint, then always resolve via the
  // geo chain — /api/geo (ip-api) is more accurate than Vercel's edge geo and is the only
  // source of the ISP/org, so we prefer it even when the cookie already has a city.
  useEffect(() => {
    setData(getVisitorData());
    setProbing(true);
    const ctrl = new AbortController();
    fetchGeo(ctrl.signal)
      .then((g) => setApi(g))
      .finally(() => setProbing(false));
    return () => ctrl.abort();
  }, []);

  // Count this device once; every load returns the live total (deduped server-side).
  useEffect(() => {
    let alive = true;
    fetch("/api/visit", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && typeof d?.count === "number") setCount(d.count);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Prefer the resolved lookup (ip-api-grade) over the cookie hint; the cookie is just the
  // instant placeholder until /api/geo answers.
  const hasApiCity = !!api?.city;
  const location = hasApiCity ? api!.location : data?.location || api?.location || "";
  const city = (hasApiCity ? api!.city : data?.city || "").trim();
  const lat = api?.lat ?? data?.lat ?? null;
  const lon = api?.lon ?? data?.lon ?? null;
  const isp = api?.isp ?? "";
  const org = api?.org ?? "";
  // Prefer a public IP: on localhost the cookie holds ::1, so fall back to the geo IP.
  const cookieIp = data?.ip ?? "";
  const ip = !isPrivateIp(cookieIp) ? cookieIp : api?.ip || cookieIp || "";
  const hasFix = lat !== null && lon !== null;
  const cc = api?.cc ?? "";
  const distance = hasFix
    ? formatDistance(greatCircleKm(HOME, { lat: lat as number, lon: lon as number }), cc)
    : null;
  // A city-LEVEL result (not just a country) counts as "detected"; a bare country reads as
  // "classified".
  const hasCity = !!city;
  const stillLooking = data === null || probing;

  // Flip the header once the zoom has settled.
  useEffect(() => {
    if (!hasFix) return;
    if (reduce) {
      setLocated(true);
      return;
    }
    const t = setTimeout(() => setLocated(true), 1500);
    return () => clearTimeout(t);
  }, [hasFix, reduce]);

  const header = hasFix
    ? located
      ? "WHERE YOU'RE AT"
      : "LOCATING YOU…"
    : stillLooking
      ? "LOCATING YOU…"
      : "OFF THE GRID";

  const cityDisplay = hasCity
    ? location
    : stillLooking
      ? "triangulating…"
      : "classified \u{1F575}\u{FE0F}";

  const caption = hasCity
    ? "no logs, just vibes \u{1F91D}"
    : stillLooking
      ? "reading the tea leaves…"
      : "your city's playing hard to get — nice privacy \u{1F576}\u{FE0F}";

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 font-mono">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden>{"\u{1F4CD}"}</span>
          <span className="text-legible">{header}</span>
        </span>
        <span aria-hidden className="text-muted/40">
          {"◎"}
        </span>
      </div>

      {/* Dotted world map → zoom to pin (drag / scroll / ⌖ to explore). Height scales with
          the viewport so the card stays compact on short screens. */}
      <div className="mb-3 h-[clamp(92px,13vh,140px)] overflow-hidden rounded-xl bg-background/40 ring-1 ring-border/60">
        <LocatorMap lat={lat} lon={lon} />
      </div>

      {/* Readout */}
      <dl className="space-y-1.5 text-xs">
        <div className="flex items-baseline gap-3">
          <dt className="w-9 shrink-0 text-muted/60">IP</dt>
          <dd className="min-w-0 break-all font-semibold text-accent">
            {ip ? (
              <ScrambleText text={ip} scrambleSpeed={18} revealSpeed={14} />
            ) : (
              <span className="font-normal text-muted/70">hidden {"\u{1F575}\u{FE0F}"}</span>
            )}
          </dd>
        </div>
        {isp && (
          <div className="flex items-baseline gap-3">
            <dt className="w-9 shrink-0 text-muted/60">ISP</dt>
            <dd className="min-w-0 break-words text-foreground/85">{isp}</dd>
          </div>
        )}
        {org && org !== isp && (
          <div className="flex items-baseline gap-3">
            <dt className="w-9 shrink-0 text-muted/60">ORG</dt>
            <dd className="min-w-0 break-words text-foreground/85">{org}</dd>
          </div>
        )}
        <div className="flex items-baseline gap-3">
          <dt className="w-9 shrink-0 text-muted/60">NEAR</dt>
          <dd className="min-w-0 break-words text-foreground/85">{cityDisplay}</dd>
        </div>
        {/* How far Wentao is from you — derived from the fix already in hand, so no extra
            network and nothing new collected. Phrased from his side ("… AWAY") so it reads
            as him telling you where he stands rather than the site pointing at you.
            Always rendered: an em dash holds the row's height from first paint, so a late
            geo answer lands IN it instead of shoving the card around. It also stays an
            em dash once the probe is finished and empty — a gauge that reads "resolving"
            forever is a broken gauge. */}
        <div className="flex items-baseline gap-3">
          <dt className="w-9 shrink-0 text-muted/60">DIST</dt>
          <dd className="min-w-0 text-foreground/85">
            {distance ?? (
              <span className={stillLooking ? "text-muted/50" : "text-muted/40"}>—</span>
            )}
          </dd>
        </div>
      </dl>

      {/* Divider */}
      <div className="my-2.5 h-px bg-border/70" />

      {/* Live counter — the fun fact. Counts VISITS, not people, so the copy says "peeks"
          rather than "of you": a repeat visitor moves this number, and claiming otherwise
          would be a small lie on a card whose whole appeal is that it tells you the truth. */}
      {count !== null && (
        <p className="text-xs leading-relaxed text-foreground/80">
          <span className="text-accent">{"✦"}</span>{" "}
          <span className="font-semibold tabular-nums text-accent">
            {count.toLocaleString()}
          </span>{" "}
          peeks and counting {"\u{1F440}"}
        </p>
      )}

      {/* Disarming caption */}
      <p className="mt-2 text-[11px] text-muted/60">{caption}</p>
    </div>
  );
}
