"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import LocatorMap from "./LocatorMap";
import ScrambleText from "./ScrambleText";
import { getVisitorData, type VisitorData } from "./visitorData";

// A browser-side geo lookup used as a FALLBACK when Vercel's edge geo headers come back
// thin (common for VPNs / mobile carriers / IPv6 — you get an IP but no city). The visitor
// resolves their OWN IP; nothing is stored.
interface ApiGeo {
  ip: string;
  location: string;
  city: string;
  lat: number | null;
  lon: number | null;
}

function flagFromCode(cc: unknown): string {
  if (typeof cc !== "string" || cc.length !== 2) return "";
  return String.fromCodePoint(
    ...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

function normalizeGeo(d: Record<string, unknown>): ApiGeo {
  const city = typeof d.city === "string" ? d.city.trim() : "";
  const parts = [city, d.region, d.country].filter(
    (p): p is string => typeof p === "string" && !!p.trim()
  );
  const flag = flagFromCode(d.country_code);
  const location = parts.length ? `${parts.join(", ")}${flag ? ` ${flag}` : ""}` : "";
  const lat = num(d.latitude);
  const lon = num(d.longitude);
  const fix = lat !== null && lon !== null && !(lat === 0 && lon === 0);
  return {
    ip: typeof d.ip === "string" ? d.ip : "",
    location,
    city,
    lat: fix ? lat : null,
    lon: fix ? lon : null,
  };
}

// Ordered geo providers (HTTPS + CORS + no key). ipwho.is resolves city best; geojs backs
// it up. Return the first city-level hit; otherwise the first result that at least has
// coordinates (so the map can still frame the country).
const GEO_PROVIDERS = ["https://ipwho.is/", "https://get.geojs.io/v1/ip/geo.json"];

async function fetchGeo(signal: AbortSignal): Promise<ApiGeo | null> {
  let coordsOnly: ApiGeo | null = null;
  for (const url of GEO_PROVIDERS) {
    if (signal.aborted) return null;
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && d.success === false) continue; // ipwho.is failure flag
      const g = normalizeGeo(d as Record<string, unknown>);
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

  // Read the visitor cookie; if it lacks a real city or coordinates, resolve them
  // client-side (a bare country doesn't count — we want city-level or a fallback try).
  useEffect(() => {
    const d = getVisitorData();
    setData(d);
    if (d.city && d.lat !== null && d.lon !== null) return;
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

  // Merge cookie (fast path) with the client lookup (fallback), preferring real values.
  // Prefer a public IP: on localhost the cookie holds ::1, so fall back to the geo IP.
  const cookieIp = data?.ip ?? "";
  const ip = !isPrivateIp(cookieIp) ? cookieIp : api?.ip || cookieIp || "";
  const lat = data?.lat ?? api?.lat ?? null;
  const lon = data?.lon ?? api?.lon ?? null;
  // Prefer whichever location is more specific (e.g. "City, Region, Country" over a bare
  // "Country"), counting comma-parts; ties fall back to the cookie value.
  const cookieLoc = data?.location ?? "";
  const apiLoc = api?.location ?? "";
  const parts = (s: string) => s.split(",").filter((p) => p.trim()).length;
  const location = parts(apiLoc) > parts(cookieLoc) ? apiLoc : cookieLoc || apiLoc;
  const hasFix = lat !== null && lon !== null;
  // A city-LEVEL result (not just a country) is what counts as "detected". A bare country
  // reads as "classified" — the visitor's precise location is hidden.
  const city = (data?.city || api?.city || "").trim();
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

      {/* Dotted world map → zoom to pin (drag / scroll / ⌖ to explore) */}
      <div className="mb-4 overflow-hidden rounded-xl bg-background/40 ring-1 ring-border/60">
        <LocatorMap lat={lat} lon={lon} />
      </div>

      {/* Readout */}
      <dl className="space-y-2 text-xs">
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
        <div className="flex items-baseline gap-3">
          <dt className="w-9 shrink-0 text-muted/60">NEAR</dt>
          <dd className="min-w-0 break-words text-foreground/85">{cityDisplay}</dd>
        </div>
      </dl>

      {/* Divider */}
      <div className="my-3 h-px bg-border/70" />

      {/* Live counter — the fun fact */}
      {count !== null && (
        <p className="text-xs leading-relaxed text-foreground/80">
          <span className="text-accent">{"✦"}</span>{" "}
          <span className="font-semibold tabular-nums text-accent">
            {count.toLocaleString()}
          </span>{" "}
          of you couldn&apos;t resist a peek {"\u{1F440}"}
        </p>
      )}

      {/* Disarming caption */}
      <p className="mt-2 text-[11px] text-muted/60">{caption}</p>
    </div>
  );
}
