"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import LocatorMap from "./LocatorMap";
import ScrambleText from "./ScrambleText";
import { getVisitorData, type VisitorData } from "./visitorData";
import { HOME, formatDistance, greatCircleKm, isLatLon } from "../lib/telemetry";
import {
  CAPTIONS,
  CAPTION_STATES,
  displayIp,
  formatCoords,
  ipPieces,
  orgLine,
  placeLines,
  regionFromLocation,
  spokenDistanceRow,
  spokenSummary,
  visibility,
  type CaptionState,
} from "../lib/visitorCard";

// A browser-side geo lookup used as a FALLBACK when Vercel's edge geo headers come back
// thin (common for VPNs / mobile carriers / IPv6 — you get an IP but no city). The visitor
// resolves their OWN IP and nothing is stored here, but the lookup itself is third-party:
// the IP reaches ip-api via /api/geo and then ipinfo / ipwho.is / geojs directly from the
// browser, which is why the card's caption names them.
interface ApiGeo {
  ip: string;
  city: string;
  region: string;
  isp: string; // carrier / ASN (e.g. "Zayo Bandwidth")
  org: string; // end-customer org (e.g. "Mercor.io Corporation")
  cc: string; // ISO country code — picks miles vs kilometres for the DIST row
  lat: number | null;
  lon: number | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

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
  const fix =
    Number.isFinite(r.lat) && Number.isFinite(r.lon) && !(r.lat === 0 && r.lon === 0);
  return {
    ip: r.ip,
    city: r.city.trim(),
    region: r.region.trim(),
    isp: r.isp,
    org: r.org,
    cc: r.cc,
    lat: fix ? r.lat : null,
    lon: fix ? r.lon : null,
  };
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

// The card's type is one ramp of CSS variables on .vcard (globals.css "VISITOR CARD"): the
// chapters' scale row for row (DESIGN-3D §1.8) — labels are the category kicker, every data
// row and the caption are meta, the city a rung above role.
const LABEL = "font-mono uppercase tracking-[0.08em] text-legend text-[length:var(--vc-label)] leading-(--vc-lh)";
const VALUE = "min-w-0 font-mono text-[length:var(--vc-meta)] leading-(--vc-lh) [overflow-wrap:break-word]";

export default function VisitorIntel() {
  const reduce = useReducedMotion() ?? false;
  const [data, setData] = useState<VisitorData | null>(null);
  const [api, setApi] = useState<ApiGeo | null>(null);
  const [probing, setProbing] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [locatedFor, setLocatedFor] = useState("");
  const cardRef = useRef<HTMLElement>(null);
  const statusId = useId();

  // The map yields height, so the card and the CTA under it fit a short window (1366 × 657,
  // the most common laptop window, and 1280 × 633). The map's height limit is CSS
  // (globals.css "VISITOR CARD": the window, less the hero's top padding, the CTA and
  // --vc-rest); this measures --vc-rest, the card's height without the map. That number
  // doesn't depend on the map (every row is as wide as the card), so a long ISP or an IPv6
  // address shrinks the map by exactly the lines it adds, and a short readout keeps the
  // whole-width map. It changes only when the rows or the window do; nothing runs at rest.
  useEffect(() => {
    const card = cardRef.current;
    const map = card?.querySelector<HTMLElement>("[data-map]");
    if (!card || !map || typeof ResizeObserver === "undefined") return;
    let last = -1;
    const ro = new ResizeObserver(() => {
      const rest = card.offsetHeight - map.offsetHeight;
      if (rest !== last) {
        last = rest;
        card.style.setProperty("--vc-rest", `${rest}px`);
      }
    });
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

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
  const city = (hasApiCity ? api!.city : data?.city || "").trim();
  const region = hasApiCity ? api!.region : regionFromLocation(data?.location ?? "", data?.city ?? "") || api?.region || "";
  const lat = api?.lat ?? data?.lat ?? null;
  const lon = api?.lon ?? data?.lon ?? null;
  const isp = api?.isp ?? "";
  const org = orgLine(isp, api?.org ?? "");
  // Prefer a public IP: on localhost the cookie holds ::1, so fall back to the geo IP —
  // and to nothing ("hidden") rather than ever printing a private one.
  const ip = displayIp(data?.ip ?? "", api?.ip ?? "");
  const hasFix = lat !== null && lon !== null;
  // A city-LEVEL result (not just a country) counts as "detected".
  const hasCity = !!city;
  // Prefer the provider's country, but fall back to the edge cookie — otherwise a US or GB
  // visitor is shown kilometres for as long as /api/geo takes to answer.
  const cc = api?.cc || data?.cc || "";
  const place = placeLines(city, region, cc);
  // Gated on a CITY-level fix, not merely on having coordinates. When Vercel can't resolve
  // a city it still returns lat/lon — a COUNTRY CENTROID (for the US, rural Kansas) — and
  // gating on `hasFix` turned that into a confident "2,160 KM AWAY" measured to the middle
  // of a state the visitor has never been to. An approximate PIN is honest; an approximate
  // number stated to the kilometre is not. Without a city this keeps its em dash.
  const fix = { lat: lat as number, lon: lon as number };
  const km = hasCity && isLatLon(fix) ? greatCircleKm(HOME, fix) : null;
  const distance = km === null ? null : formatDistance(km, cc);
  const coords = formatCoords(lat, lon);
  const stillLooking = data === null || probing;

  // Flip the header once the map has had its moment (the pin drops at ~0.5 s, the globe
  // settles by 1.6 s). Set from the timer, never synchronously in the effect.
  const fixKey = hasFix ? `${lat},${lon}` : "";
  useEffect(() => {
    if (!fixKey || reduce) return;
    const t = setTimeout(() => setLocatedFor(fixKey), 1500);
    return () => clearTimeout(t);
  }, [fixKey, reduce]);
  const located = hasFix && (reduce || locatedFor !== "");

  const header = hasFix
    ? located
      ? "WHERE YOU'RE AT"
      : "LOCATING YOU…"
    : stillLooking
      ? "LOCATING YOU…"
      : "OFF THE GRID";

  // The old caption ("no logs, just vibes") was true about THIS site and silent about the
  // chain below it. The caption names the lookups in every state (CAPTIONS, visitorCard.ts):
  // by the time this renders, the visitor's IP is already on its way to them.
  const captionState: CaptionState = place ? "found" : stillLooking ? "looking" : "none";
  // The one sentence a screen reader hears first (the map is aria-hidden, the rows are terse).
  const summary = spokenSummary({ state: captionState, city, region, cc, km });

  return (
    // A labelled region: its name is the status line ("WHERE YOU'RE AT"), and it opens with a
    // plain sentence. No aria-live: the page keeps its single live region.
    <section ref={cardRef} aria-labelledby={statusId} className="vcard glass rounded-2xl p-(--vc-pad)">
      {/* Status, and (laptop up) the fix it's reporting. The kicker never breaks; if the
          worst-case coordinates don't fit beside it (a 1024 window), they drop to a line below. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-mono text-[length:var(--vc-label)] uppercase leading-snug tracking-[0.14em] text-legend">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden>{"\u{1F4CD}"}</span>
          {/* No .text-legible halo: the glass already separates it from the rain, and a 24 px
              text-shadow grows a text's paint rect ~5× — enough to make this line's 1.5 s
              flip a late largest-contentful-paint candidate ahead of the hero's own text. */}
          <span id={statusId} className="whitespace-nowrap">{header}</span>
        </span>
        <span className={`shrink-0 tabular-nums tracking-[0.04em] ${visibility("coords", "inline")}`}>
          {coords ?? <span aria-hidden>{"◎"}</span>}
        </span>
      </div>

      <p className="sr-only">{summary}</p>

      {/* The whole world, the pin, and a hairline home (LocatorMap). */}
      <div className="mt-(--vc-gap-map)">
        <LocatorMap lat={lat} lon={lon} reduce={reduce} />
      </div>

      {/* Readout: the place leads, the network follows. */}
      <dl className="mt-(--vc-gap-dl) grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-(--vc-gap-row)">
        <div className="contents">
          <Label short="NEAR" full="Near" />
          {/* break-word only as the last resort, for one name longer than the whole column
              ("Llanfairpwllgwyngyll" at 26 px in a 277 px tablet card): it wraps at spaces first. */}
          {/* Always two lines, from the first paint: the second holds an em dash until the
              region lands (and stays one for a country-only fix), so the answer fills the
              card's height instead of growing it. */}
          <dd className="min-w-0 [overflow-wrap:break-word]">
            {place ? (
              <span className="block text-balance text-[length:var(--vc-head)] font-semibold leading-(--vc-lh-head) tracking-[-0.01em] text-foreground">
                {place.head}
              </span>
            ) : (
              <span className="block text-[length:var(--vc-head)] leading-(--vc-lh-head) text-legend">
                {stillLooking ? "triangulating…" : "classified \u{1F575}\u{FE0F}"}
              </span>
            )}
            {place?.sub && <span className="sr-only">, </span>}
            <span className="mt-(--vc-gap-sub) block text-balance text-[length:var(--vc-meta)] leading-(--vc-lh) text-legend">
              {place?.sub ?? <span aria-hidden="true">—</span>}
            </span>
          </dd>
        </div>
        <div className="contents">
          <Label short="IP" full="IP address" />
          <dd className={`${VALUE} font-semibold text-accent`}>
            {ip ? (
              // An IPv6 address breaks only after a colon, never inside a group; the pieces
              // rejoin byte-identical, so selecting the row still copies the address.
              ipPieces(ip).map((piece, i) => (
                <Fragment key={i}>
                  <ScrambleText text={piece} scrambleSpeed={18} revealSpeed={14} />
                  <wbr />
                </Fragment>
              ))
            ) : (
              <span className="font-normal text-legend">hidden {"\u{1F575}\u{FE0F}"}</span>
            )}
          </dd>
        </div>
        {/* Always rendered, like DIST: an em dash holds the row until /api/geo names the ISP
            (and stays for a fallback provider, which has none). */}
        <div className="contents">
          <Label short="ISP" full="Internet provider" />
          <dd className={`${VALUE} text-foreground`}>{isp || <Dash spoken="not known" />}</dd>
        </div>
        {/* Always rendered too. The org is known only once /api/geo answers, and a row that
            appeared then grew the card after the name had painted (the whole of the hero's
            late layout shift on a laptop). An em dash says "nothing beyond the ISP": no org,
            or one that repeats the ISP (orgLine). */}
        <div className={visibility("org", "contents")}>
          <Label short="ORG" full="Organisation" />
          <dd className={`${VALUE} text-foreground`}>{org || <Dash spoken={stillLooking ? "not known" : "none beyond the provider"} />}</dd>
        </div>
        {/* How far Wentao is from you — derived from the fix already in hand, so no extra
            network and nothing new collected. Phrased from his side ("… AWAY") so it reads
            as him telling you where he stands rather than the site pointing at you.
            Always rendered: an em dash holds the row's height from first paint, so a late
            geo answer lands IN it instead of shoving the card around. It also stays an
            em dash once the probe is finished and empty — a gauge that reads "resolving"
            forever is a broken gauge. */}
        <div className="contents">
          <Label short="DIST" full="Distance from Wentao" />
          <dd className={`${VALUE} text-foreground`}>
            {distance && km !== null ? (
              <>
                <span aria-hidden="true">{distance}</span>
                <span className="sr-only">{spokenDistanceRow(km, cc)}</span>
              </>
            ) : (
              <Dash spoken="not known" />
            )}
          </dd>
        </div>
      </dl>

      <div className="my-(--vc-gap-rule) h-px bg-border/70" />

      {/* Live counter — the fun fact. Counts VISITS, not people, so the copy says "peeks"
          rather than "of you": a repeat visitor moves this number, and claiming otherwise
          would be a small lie on a card whose whole appeal is that it tells you the truth.
          A null count (no database, an error) shows nothing (D-0036), but the line's height
          is held from the first paint by an invisible six-digit twin in the same grid cell,
          so the count arriving ~1.4 s in fills the line instead of pushing the card. */}
      <p className="vc-peeks mb-(--vc-gap-peeks) grid text-[length:var(--vc-meta)] text-foreground">
        <span aria-hidden="true" className="invisible [grid-area:1/1]">
          {"✦"} <span className="font-mono font-semibold">000,000</span> peeks and counting {"\u{1F440}"}
        </span>
        {count !== null && (
          <span className="[grid-area:1/1]">
            <span className="text-accent">{"✦"}</span>{" "}
            <span className="font-mono font-semibold tabular-nums text-accent">{count.toLocaleString()}</span>{" "}
            peeks and counting {"\u{1F440}"}
          </span>
        )}
      </p>

      {/* The honesty contract: who is asked, and that nothing is kept. In every state. All
          three states sit in one grid cell, the two not showing invisible (and hidden from
          assistive tech), so the caption is as tall as its tallest state from the first paint. */}
      <p className="vc-caption grid text-pretty text-[length:var(--vc-caption)] text-legend">
        {CAPTION_STATES.map((k) => (
          <span key={k} aria-hidden={k === captionState ? undefined : true} className={k === captionState ? "[grid-area:1/1]" : "invisible [grid-area:1/1]"}>
            {CAPTIONS[k]}
          </span>
        ))}
      </p>
    </section>
  );
}

// A row label: the terse caps for the eye ("ISP", "DIST"), the words for a screen reader,
// which would otherwise read the abbreviations letter by letter.
function Label({ short, full }: { short: string; full: string }) {
  return (
    <dt className={LABEL}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{full}</span>
    </dt>
  );
}

// An empty value: an em dash for the eye, a few words for a screen reader.
function Dash({ spoken }: { spoken: string }) {
  return (
    <span className="text-legend">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
