"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import dynamic from "next/dynamic";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { GitCommit, Code, Github, Flame, Zap } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { useSiteMotion } from "./SiteMotion";
import { buildDayWindow, currentStreak, utcDayKey, type CommitDay } from "../lib/githubStats";
import { levelFor } from "../lib/commitLevel";
import { SEED, jacksForWeeks } from "../lib/connectorJacks";
import { COLUMN_MIN_PX, PANEL, PANEL_LEGEND } from "../lib/connectorScene";
import { createPointerRig } from "../lib/pointerRig";

// The floating connector jacks — client-only, lazy (three.js off the initial bundle).
const ConnectorField = dynamic(() => import("./ConnectorField"), { ssr: false });

interface RepoStats {
  commits: number;
  linesOfCode: number;
  languages: { name: string; percentage: number }[];
  /** The route reached its page cap or lost a page: older days are unknown, not zero. */
  truncated: boolean;
  /** The UTC day the route generated this payload; null when it did not say. */
  snapshotDay: string | null;
}

function getIntensity(count: number): string {
  if (count === 0) return "bg-border/50";
  if (count <= 2) return "bg-accent/40";
  if (count <= 5) return "bg-accent/60";
  if (count <= 10) return "bg-accent/80";
  return "bg-accent";
}

function formatNumber(num: number): string {
  if (num >= 1000) return (num / 1000).toFixed(1) + "k";
  return num.toString();
}

// 3D bar levels: extrusion height (px) + token-driven face colours.
//
// There is ONE key light on this site and it sits up and to the RIGHT (the same
// direction as the hero's caustic rim and the connector scene's key light). So the
// three visible faces of a bar can never share a value: the TOP catches most of it,
// the RIGHT face sits a stop under, and the FRONT face is in shadow. Painting both
// side faces the same colour — as this did — is a literal lighting lie, and it
// flattens every extrusion into a silhouette.
//
// Both side values are derived from the top so the ramp can't drift, and each mix
// sums to 100% so no unintended alpha-multiplication creeps in.
const FACE_LIT = 0.78; // right face keeps this much of the top face's value
const FACE_SHADE = 0.46; // front face keeps this much
const face = (top: string, keep: number) =>
  `color-mix(in srgb, ${top} ${Math.round(keep * 100)}%, #000)`;

const LEVELS = [
  { h: 3, top: "color-mix(in srgb, var(--accent) 18%, var(--card))" },
  { h: 13, top: "color-mix(in srgb, var(--accent) 45%, var(--card))" },
  { h: 24, top: "color-mix(in srgb, var(--accent) 64%, var(--card))" },
  { h: 36, top: "color-mix(in srgb, var(--accent) 82%, var(--card))" },
  { h: 50, top: "var(--accent)" },
].map(({ h, top }) => ({
  h,
  top,
  lit: face(top, FACE_LIT),
  shade: face(top, FACE_SHADE),
}));

const CELL = 15;
const GAP = 5;
const STEP = CELL + GAP;
const BASE_TILT_X = 52; // 3/4 skyline tilt
// The scene's column: `gap-x-8` between the board column and the canvas.
const COLUMN_GAP = 32;
const BASE_ROT_Y = -26; // horizontal turn — staggers columns so fewer bars hide

export default function SiteStats() {
  const [commitData, setCommitData] = useState<Map<string, number>>(new Map());
  const [stats, setStats] = useState<RepoStats>({
    commits: 0,
    linesOfCode: 0,
    languages: [],
    truncated: false,
    snapshotDay: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [finePointer, setFinePointer] = useState(false);
  const [bgArmed, setBgArmed] = useState(false);
  const [bgVisible, setBgVisible] = useState(false);
  const [bgBorn, setBgBorn] = useState(false);
  const [sceneInView, setSceneInView] = useState(false);
  const [blockW, setBlockW] = useState<number | null>(null);
  const [sceneShown, setSceneShown] = useState(false);
  const [accentHex, setAccentHex] = useState("#3b82f6");
  // The LIVE policy, not framer's mount-latched useReducedMotion(): Reduce Motion turned on with the page open
  // takes use3D false below, which unmounts the card's scene (its WebGL context goes with it) and swaps the
  // CSS-3D board for the flat grid; the tilt below is gated at its binding site for the same reason (E16).
  const { reduced: reduceMotion } = useSiteMotion();
  const { resolvedTheme } = useTheme();

  // Background canvas, three stages observed on the card (the column itself only exists once
  // the data has landed, and the warm stage must fire long before that would matter). WARM
  // (one viewport height out): import the module — the scene's chunk group is three + fiber
  // + the scene, ~230 KB gzip, and a 300 px lead at reading pace is 0.3–0.5 s, which a cold
  // fetch on a slow desktop link can miss; the pile needed two viewport heights for a 1.07 MB
  // group. Same specifier as the dynamic() loader, so Turbopack dedupes it into the same
  // chunks. ARM (300 px): mount once and never unmount — unmounting rebuilt the WebGL context
  // and the environment and replayed the entrance on every return. The mount also waits for
  // the fetch: the world is born with the camera fit of the canvas it mounts in, and a scene
  // born in the 226 px loading card would have spawned for a view the 491 px loaded one does
  // not have. VISIBLE (live, both directions): only gates the frameloop inside. Callback ref
  // → fires when the node attaches.
  const bgObserver = useRef<IntersectionObserver | null>(null);
  const warmObserver = useRef<IntersectionObserver | null>(null);
  const attachBg = useCallback((node: HTMLDivElement | null) => {
    bgObserver.current?.disconnect();
    bgObserver.current = null;
    warmObserver.current?.disconnect();
    warmObserver.current = null;
    if (node) {
      const warm = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        warm.disconnect();
        // Only where a canvas can mount at all (the use3D gates, read directly — this ref
        // callback is created once): a phone or a reduced-motion visitor was downloading the
        // chunk for a column that never exists.
        if (window.innerWidth < 640 || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        // A failed warm is only a lost head start: dynamic() fetches again at mount and reports.
        import("./ConnectorField").catch(() => {});
      }, { rootMargin: "100% 0px" });
      warm.observe(node);
      warmObserver.current = warm;
      const io = new IntersectionObserver(([e]) => {
        setBgVisible(e.isIntersecting);
        if (e.isIntersecting) setBgArmed(true);
      }, { rootMargin: "300px" });
      io.observe(node);
      bgObserver.current = io;
    }
  }, []);
  // The entrance waits for the column, not the card: with a 300 px mount lead the fly-in
  // would have played before a reading-pace scroll reached it. 30% of the column on screen is
  // enough of it for the jacks to be seen converging.
  const sceneObserver = useRef<IntersectionObserver | null>(null);
  const attachScene = useCallback((node: HTMLDivElement | null) => {
    sceneObserver.current?.disconnect();
    sceneObserver.current = null;
    if (!node) {
      // The column is taken away and given back — the ResizeObserver below drops it when
      // the block narrows past COLUMN_MIN_PX and restores it when it widens — and this
      // state outlived the node that produced it. The next mount was handed the OLD
      // answer for the frame or two before the fresh observer's first callback, so a column
      // reappearing off-screen could be told to start where nobody could see it.
      setSceneInView(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setSceneInView(e.isIntersecting), { threshold: 0.3 });
    io.observe(node);
    sceneObserver.current = io;
  }, []);
  // The activity block's width, in both of its shapes (one column or board + scene), decides
  // whether the second column exists: the block is what the grid divides.
  const blockObserver = useRef<ResizeObserver | null>(null);
  const attachBlock = useCallback((node: HTMLDivElement | null) => {
    blockObserver.current?.disconnect();
    blockObserver.current = null;
    if (node) {
      const ro = new ResizeObserver(([e]) => setBlockW(e.contentRect.width));
      ro.observe(node);
      blockObserver.current = ro;
    }
  }, []);

  // Cursor-parallax tilt for the 3D bar chart (drives the board only — the scene's camera is
  // fixed, Lusion's own has no pointer parallax). It listens on the CARD, through the one
  // pointer rig the scene reads too: a move anywhere over the card wakes the scene's demand
  // loop, so the jacks are alive before the cursor reaches their column.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const springCfg = { stiffness: 120, damping: 18, mass: 0.4 };
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [BASE_TILT_X + 5, BASE_TILT_X - 6]), springCfg);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [BASE_ROT_Y - 8, BASE_ROT_Y + 8]), springCfg);
  // Mutated in place, read by the scene's frame loop — no re-render per pointer move.
  const rig = useMemo(() => createPointerRig(), []);

  useEffect(() => {
    setMounted(true);
    setIsMobile(window.innerWidth < 640);
    setFinePointer(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);

  // Re-read the themed accent whenever the theme flips (it differs per theme; the glossy
  // accent jack is the token and the matte ones 85% of it). Deferred a microtask: React runs
  // a child's passive effects before its parent's, so at this point the ThemeProvider has
  // not yet flipped the <html> class for the theme this effect reacts to, and a synchronous
  // read returned the OUTGOING theme's tokens — the scene lagged one flip behind. #3b82f6
  // and #2563eb are a shade apart, so the lag hid. A microtask runs after the whole flush,
  // class included.
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      const a = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      if (a) setAccentHex(a);
    });
    return () => { live = false; };
  }, [resolvedTheme]);

  useEffect(() => {
    async function fetchData() {
      try {
        // Server-cached route → the browser never hits GitHub's anonymous rate limit,
        // and `commits` is the true total (Link-header count, uncapped past 100).
        const res = await fetch("/api/github-stats");
        const data = await res.json();
        if (!res.ok || data?.error) {
          setError(true);
          return;
        }
        const countMap = new Map<string, number>();
        for (const [date, n] of Object.entries((data.days as Record<string, number>) || {})) {
          countMap.set(date, n);
        }
        setCommitData(countMap);
        setStats({
          commits: data.commits ?? 0,
          linesOfCode: data.linesOfCode ?? 0,
          languages: data.languages ?? [],
          truncated: data.truncated === true,
          snapshotDay: typeof data.snapshotDay === "string" ? data.snapshotDay : null,
        });
      } catch (err) {
        console.error("Error fetching data:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const unavailable = !loading && error;
  const use3D = mounted && !isMobile && finePointer && !reduceMotion;
  // Latched: once the card has been within its margin with the data landed, the canvas stays
  // mounted whatever `loading` does later — a re-mount is a re-entrance. (setState during
  // render is React's pattern for state that follows other state; an effect would cascade.)
  if (bgArmed && !loading && !bgBorn) setBgBorn(true);

  // The grid ends on the day the SNAPSHOT was taken, not the viewer's today. The payload is
  // one cached entry served for up to 15 minutes past a 5-minute regeneration, so across a
  // UTC midnight a viewer can hold yesterday's snapshot: anchored on the client's clock, the
  // newest column would draw as a zero for a day the data never saw. The route says which
  // day it generated on; when that is behind the client's today the window slides back to it
  // and the labels say so. A payload without the field anchors on today as before.
  const todayKey = utcDayKey(new Date());
  const snapKey = stats.snapshotDay;
  const stale = !unavailable && snapKey !== null && snapKey < todayKey;
  const anchorKey = stale ? snapKey : todayKey;

  const weeksToShow = isMobile ? 8 : 12;
  // Memoised on the day key, not the Date: `days` feeds the jacks, and a new array identity
  // per render would be a new world — a new entrance — on every parallax tick.
  const days = useMemo(
    () => buildDayWindow(new Date(`${anchorKey}T12:00:00Z`), weeksToShow, commitData),
    [anchorKey, weeksToShow, commitData],
  );
  // One jack per week of the same window the board draws, sized by its commits; weeks the
  // route's paging cut off before are UNKNOWN, and the legend says so.
  const jacks = useMemo(() => jacksForWeeks(days, weeksToShow, stats.truncated, SEED), [days, weeksToShow, stats.truncated]);
  const weeks: CommitDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Streak (GitHub's convention: the run ending today, or yesterday before today's first
  // push), best day and the board's own total all come from the window the board draws, so
  // the label can never claim more than the cells behind it.
  const streak = currentStreak(days);
  const bestDay = days.reduce((m, d) => Math.max(m, d.count), 0);
  const windowCommits = days.reduce((n, d) => n + d.count, 0);
  // Dark cells mean UNKNOWN when the fetch failed or the route returned a cut-off window
  // with nothing in it; a streak and a best day derived from that are not zeros.
  const windowKnown = !unavailable && !(stats.truncated && windowCommits === 0);

  // The route already drops sub-1% shares, but the CDN serves this payload for up to ~15
  // minutes (s-maxage=300, stale-while-revalidate=600), so a stale "JavaScript 0%" chip
  // can still arrive after a deploy.
  const languages = unavailable ? [] : stats.languages.filter((l) => l.percentage >= 1);
  const statTiles = [
    { icon: GitCommit, value: unavailable ? "—" : `${stats.commits}`, label: "Commits" },
    { icon: Code, value: unavailable ? "—" : `~${formatNumber(stats.linesOfCode)}`, label: "Lines of code" },
    { icon: Flame, value: windowKnown ? `${streak}` : "—", label: "Day streak" },
    { icon: Zap, value: windowKnown ? `${bestDay}` : "—", label: "Best day" },
  ];

  const boardW = weeksToShow * STEP - GAP;
  const boardH = 7 * STEP - GAP;
  const onCardMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    px.set(x);
    py.set(y);
    rig.move(x, y, e.clientX, e.clientY);
  };
  const resetTilt = () => {
    px.set(0);
    py.set(0);
    rig.leave();
  };
  const dayTitle = (day: CommitDay) =>
    `${day.date} (UTC): ${day.count} commit${day.count !== 1 ? "s" : ""}`;
  // Counted over the window, not all time: "12 weeks — 194 commits" read as a claim about
  // the window while the board could only ever show the days of the newest 100 commits.
  // When the route says `truncated` the older cells are dark because they are UNKNOWN, so
  // the label may not claim the full window (and "Best day" below it is then a floor over
  // the newest days, which is what "older days not shown" tells the reader).
  const plural = windowCommits !== 1 ? "s" : "";
  const span = stale ? `the ${weeksToShow} weeks to ${snapKey}` : `the last ${weeksToShow} weeks`;
  const snapshotNote = stale ? ` · snapshot from ${snapKey}` : "";
  const boardLabel = !windowKnown
    ? "Commit activity unavailable"
    : stats.truncated
      ? `Commit activity (UTC days) — most recent ${windowCommits} commit${plural}; older days not shown${snapshotNote}`
      : `Commit activity for ${span} (UTC days) — ${windowCommits} commit${plural}${snapshotNote}`;
  // Does a second column fit? The column is the block minus the board column and the gap;
  // under COLUMN_MIN_PX the camera fit (connectorScene.cameraFor) would put twelve 2 u
  // jacks into ~150 px at a 700 px viewport, so the block is one column instead. A
  // half-pixel band of hysteresis so a drag across the edge does not mount and unmount a
  // WebGL context on every pixel. (setState during render is React's pattern for state
  // that follows other state; an effect would cascade.)
  const columnW = blockW !== null ? blockW - boardW - COLUMN_GAP : 0;
  const wantScene = columnW >= COLUMN_MIN_PX - (sceneShown ? 0.5 : 0);
  if (wantScene !== sceneShown) setSceneShown(wantScene);
  // The scene is a second reading of the same window, so it exists only when the window is
  // known and the column fits; without it the activity block is one column, as it is for
  // every non-3D visitor. A KNOWN window with no commit is a real state — twelve quiet weeks,
  // twelve floor-sized jacks — and the legend still holds.
  const showScene = use3D && windowKnown && sceneShown;
  // The legend states the encoding, and the cut when there is one.
  const unknownWeeks = jacks.filter((j) => !j.known).length;
  const sceneLegend = `one connector per week, sized by its commits · nudge them${unknownWeeks > 0 ? " · older weeks unknown" : ""}`;

  return (
    <section className="py-20 md:py-24 px-6 relative z-20 pointer-events-none">
      {/* The card's visible header is the repo name, so the document outline jumped from
          "Projects" straight to "Let's Connect" over a whole landmark. The heading is the
          landmark's one name — a matching aria-label read it twice. */}
      <h2 className="sr-only">GitHub activity</h2>
      <div ref={attachBg} className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="glass p-6 sm:p-8 pointer-events-auto"
          // the one pointer rig (board tilt + scene wake) listens on the card, not its halves
          onPointerMove={onCardMove}
          onPointerLeave={resetTilt}
        >
          {/* Content — pointer-events pass THROUGH except on interactive bits */}
          <div className="relative z-10 pointer-events-none">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Github size={18} className="text-muted" />
                <span className="text-sm font-medium">wentao.gg</span>
              </div>
              <a
                href="https://github.com/wth-lgtm/wentao.gg"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline pointer-events-auto"
              >
                View source →
              </a>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Stats Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  {statTiles.map((tile, i) => (
                    <motion.div
                      key={tile.label}
                      initial={{ opacity: 0, scale: 0.9 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.1 * i, duration: 0.2 }}
                      className="flex items-center gap-3"
                    >
                      <div className="p-2 bg-accent/10 rounded-lg">
                        <tile.icon size={18} className="text-accent" />
                      </div>
                      <div>
                        <div className="text-xl font-bold tabular-nums">{tile.value}</div>
                        <div className="text-xs text-muted">{tile.label}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Languages */}
                <div className="flex items-center gap-2 flex-wrap mb-6">
                  {languages.map((lang) => (
                    <span key={lang.name} className="text-xs px-2 py-1 bg-background/70 rounded-full text-muted">
                      {lang.name} {lang.percentage}%
                    </span>
                  ))}
                </div>

                {/* Activity — 3D bar chart (or flat fallback). On the 3D path the board and the
                    scene are two columns of one grid: the old overlay was percent-anchored (top
                    30%, left 36%) and its left edge crossed the board's projected right column
                    below ~760 px viewports while its top edge landed inside the language-chip
                    row. Laid out as a sibling they share one frame and cannot collide at any
                    width; when there is no scene the grid is one column, so no visitor gets an
                    empty lower-right. */}
                <div
                  ref={attachBlock}
                  className={showScene ? "grid gap-x-8 gap-y-3 items-stretch" : "space-y-3"}
                  // column 1 is exactly the board's width: a long label ("snapshot from …") wraps
                  // inside it instead of widening the column and shrinking the scene unmeasured
                  style={showScene ? { gridTemplateColumns: `${boardW}px 1fr` } : undefined}
                >
                  <div className="col-start-1 row-start-1 text-xs text-muted">
                    Activity (UTC days){stale && <span className="text-[var(--legend)]"> · snapshot from {snapKey}</span>}
                  </div>

                  {use3D ? (
                    <div className="col-start-1 row-start-2 flex justify-start">
                      {/* perspective lives on the board's own box: on the full content width the
                          projection's origin drifted with the viewport, so the board's oblique
                          look changed with the window. */}
                      <div
                        className="relative pointer-events-auto"
                        style={{ width: boardW, paddingTop: 64, paddingBottom: 14, perspective: 900, perspectiveOrigin: "50% 50%" }}
                        role="img"
                        aria-label={boardLabel}
                      >
                        <motion.div
                          style={{ width: boardW, height: boardH, position: "relative", transformStyle: "preserve-3d", rotateX: reduceMotion ? BASE_TILT_X : rotateX, rotateY: reduceMotion ? BASE_ROT_Y : rotateY }}
                        >
                          {weeks.map((week, weekIndex) =>
                            week.map((day, dayIndex) => {
                              const lvl = LEVELS[levelFor(day.count)];
                              return (
                                <motion.div
                                  key={day.date}
                                  aria-hidden
                                  title={dayTitle(day)}
                                  className="absolute cursor-default"
                                  // opaque: a translucent bar beside a lit, solid scene was the
                                  // single loudest "vector chart" cue on the card
                                  style={{ left: weekIndex * STEP, top: dayIndex * STEP, width: CELL, height: CELL, transformStyle: "preserve-3d" }}
                                  initial={{ z: -26 }}
                                  whileInView={{ z: 0 }}
                                  viewport={{ once: true }}
                                  // one 100 ms beat per week column, oldest first — the same left → right
                                  // order the jacks' pull targets keep beside it
                                  transition={{ delay: 0.1 * weekIndex, type: "spring", stiffness: 260, damping: 22 }}
                                  whileHover={{ z: 18, scale: 1.08 }}
                                >
                                  {/* the bar's shadow on the board, thrown down-left away from the
                                      upper-right key — the same direction the jacks' creases fall */}
                                  <div className="absolute inset-0 rounded-[2px]" style={{ boxShadow: `-3px 4px 6px rgba(0,0,0,${resolvedTheme === "light" ? 0.18 : 0.35})` }} />
                                  <div className="absolute inset-0 rounded-[2px]" style={{ background: lvl.top, transform: `translateZ(${lvl.h}px)` }} />
                                  {/* front face — turned away from the key light */}
                                  <div className="absolute left-0 bottom-0" style={{ width: CELL, height: lvl.h, background: lvl.shade, transformOrigin: "bottom", transform: "rotateX(-90deg)" }} />
                                  {/* right face — turned toward it */}
                                  <div className="absolute top-0 right-0" style={{ width: lvl.h, height: CELL, background: lvl.lit, transformOrigin: "right", transform: "rotateY(90deg)" }} />
                                </motion.div>
                              );
                            })
                          )}
                        </motion.div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-center sm:justify-start">
                      <div className="flex gap-[3px]" role="img" aria-label={boardLabel}>
                        {weeks.map((week, weekIndex) => (
                          <div key={weekIndex} className="flex flex-col gap-[3px]">
                            {week.map((day) => (
                              <div key={day.date} aria-hidden className={`w-3 h-3 sm:w-[14px] sm:h-[14px] rounded-[3px] ${getIntensity(day.count)}`} title={dayTitle(day)} />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Legend */}
                  <div className="col-start-1 row-start-3 flex items-center justify-center sm:justify-start gap-2 text-[10px] text-muted pt-1">
                    <span>Less</span>
                    {[0, 1, 3, 6, 11].map((count) => (
                      <div key={count} className={`w-3 h-3 rounded-[3px] ${getIntensity(count)}`} />
                    ))}
                    <span>More</span>
                  </div>

                  {/* The scene: one connector jack per week, floating in the panel. The panel colour
                      is painted here before the canvas mounts so the column never flashes the card;
                      the rounded clip is what crops the overflowing pack. pointer-events-auto
                      because it sits inside the pointer-events-none content div — without it the
                      cursor is dead. Decorative to a reader: the board's label already states the
                      count, so the column is aria-hidden and gets no second role="img". */}
                  {showScene && (
                    <div
                      ref={attachScene}
                      aria-hidden
                      className="relative col-start-2 row-start-1 row-span-3 overflow-hidden rounded-xl pointer-events-auto"
                      style={{ background: PANEL }}
                    >
                      {bgBorn && (
                        <ConnectorField
                          jacks={jacks}
                          accent={accentHex}
                          active={bgVisible}
                          inView={sceneInView}
                          rig={rig}
                        />
                      )}
                      {/* The legend's ground. The pack overflows the frame and passes under the
                          legend, and #a1a1aa on a white jack is 1.3:1 — the encoding statement
                          lost its words wherever one crossed. A 36 px fade from the panel colour
                          keeps it on the surface PANEL_LEGEND was chosen for: opaque to 60% (21.6
                          px) because the 10 px glyphs sit at y ≈ 11–20, and a 30% stop measured
                          2.3:1 at the baseline row over a white jack (7.1:1 on the panel).
                          pointer-events-none so the ray beneath stays live; PR B's ribbon
                          composites under it. */}
                      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: 36, background: `linear-gradient(to bottom, ${PANEL} 0%, ${PANEL} 60%, transparent 100%)` }} />
                      <span className="absolute left-3 right-3 top-2 font-mono text-[10px] uppercase tracking-[0.16em] pointer-events-none select-none" style={{ color: PANEL_LEGEND }}>
                        {sceneLegend}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
