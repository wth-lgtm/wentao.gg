"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import dynamic from "next/dynamic";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion";
import { GitCommit, Code, Github, Flame, Zap } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { buildDayWindow, currentStreak, type CommitDay } from "../lib/githubStats";

// Interactive floating-sphere background — client-only, lazy (three.js off the initial bundle).
const FloatingBackground = dynamic(() => import("./FloatingBackground"), { ssr: false });

interface RepoStats {
  commits: number;
  linesOfCode: number;
  languages: { name: string; percentage: number }[];
  /** The route reached its page cap or lost a page: older days are unknown, not zero. */
  truncated: boolean;
}

function getIntensity(count: number): string {
  if (count === 0) return "bg-border/50";
  if (count <= 2) return "bg-accent/40";
  if (count <= 5) return "bg-accent/60";
  if (count <= 10) return "bg-accent/80";
  return "bg-accent";
}

function levelFor(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

function formatNumber(num: number): string {
  if (num >= 1000) return (num / 1000).toFixed(1) + "k";
  return num.toString();
}

// 3D bar levels: extrusion height (px) + token-driven face colours.
//
// There is ONE key light on this site and it sits up and to the RIGHT (the same
// direction as the hero's caustic rim and the floating scene's key light). So the
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
const BASE_ROT_Y = -26; // horizontal turn — staggers columns so fewer bars hide

export default function SiteStats() {
  const [commitData, setCommitData] = useState<Map<string, number>>(new Map());
  const [stats, setStats] = useState<RepoStats>({
    commits: 0,
    linesOfCode: 0,
    languages: [],
    truncated: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [finePointer, setFinePointer] = useState(false);
  const [bgArmed, setBgArmed] = useState(false);
  const [bgVisible, setBgVisible] = useState(false);
  const [accentHex, setAccentHex] = useState("#3b82f6");
  const reduceMotion = useReducedMotion() ?? false;
  const { resolvedTheme } = useTheme();

  // Background canvas, three stages on one region. WARM (two viewport heights out): import the
  // module — the pile's chunk group is ~1.07 MB gzip because rapier inlines its 1.44 MB WASM
  // as base64, and at a 300 px lead a reading-pace scroll reached the card before the download
  // did. Same specifier as the dynamic() loader, so Turbopack dedupes it into the same chunks.
  // ARM (300 px): mount once and never unmount — unmounting rebuilt the WebGL context, the
  // world and ~110 convex hulls and rained the pile in again on every return. VISIBLE (live,
  // both directions): only gates the frameloop inside. Callback ref → fires when the node attaches.
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
        import("./FloatingBackground");
        warm.disconnect();
      }, { rootMargin: "200% 0px" });
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

  // Cursor-parallax tilt for the 3D bar chart (drives the board only).
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const springCfg = { stiffness: 120, damping: 18, mass: 0.4 };
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [BASE_TILT_X + 5, BASE_TILT_X - 6]), springCfg);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [BASE_ROT_Y - 8, BASE_ROT_Y + 8]), springCfg);

  useEffect(() => {
    setMounted(true);
    setIsMobile(window.innerWidth < 640);
    setFinePointer(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);

  // Re-read the themed accent whenever the theme flips (light/dark accents differ).
  useEffect(() => {
    const readAccent = () => {
      const a = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      if (a) setAccentHex(a);
    };
    readAccent();
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

  const weeksToShow = isMobile ? 8 : 12;
  const days = buildDayWindow(new Date(), weeksToShow, commitData);
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
  const onBoardMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width - 0.5);
    py.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const resetTilt = () => {
    px.set(0);
    py.set(0);
  };
  const dayTitle = (day: CommitDay) =>
    `${day.date} (UTC): ${day.count} commit${day.count !== 1 ? "s" : ""}`;
  // Counted over the window, not all time: "12 weeks — 194 commits" read as a claim about
  // the window while the board could only ever show the days of the newest 100 commits.
  // When the route says `truncated` the older cells are dark because they are UNKNOWN, so
  // the label may not claim the full window (and "Best day" below it is then a floor over
  // the newest days, which is what "older days not shown" tells the reader).
  const plural = windowCommits !== 1 ? "s" : "";
  const boardLabel = !windowKnown
    ? "Commit activity unavailable"
    : stats.truncated
      ? `Commit activity (UTC days) — most recent ${windowCommits} commit${plural}; older days not shown`
      : `Commit activity for the last ${weeksToShow} weeks (UTC days) — ${windowCommits} commit${plural}`;

  return (
    <section aria-label="GitHub activity" className="py-20 md:py-24 px-6 relative z-20 pointer-events-none">
      {/* The card's visible header is the repo name, so the document outline jumped from
          "Projects" straight to "Let's Connect" over a whole landmark. */}
      <h2 className="sr-only">GitHub activity</h2>
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="glass p-6 sm:p-8 pointer-events-auto"
        >
          {/* Interactive floating-object background — confined to the empty lower-right
              region so it never sits behind the stats, languages, or bar chart. */}
          {use3D && (
            <div
              ref={attachBg}
              aria-hidden
              className="absolute z-0 overflow-hidden rounded-br-2xl"
              style={{ top: "30%", left: "36%", right: 0, bottom: 0 }}
            >
              {bgArmed && <FloatingBackground active={bgVisible} accent={accentHex} light={resolvedTheme === "light"} />}
            </div>
          )}

          {/* Content — pointer-events pass THROUGH to the background except on interactive bits */}
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
                      transition={{ delay: 0.05 * i }}
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

                {/* Activity — 3D bar chart (or flat fallback) */}
                <div className="space-y-3">
                  <div className="text-xs text-muted">Activity</div>

                  {use3D ? (
                    <div className="flex justify-center sm:justify-start" style={{ perspective: 900 }}>
                      <div
                        className="relative pointer-events-auto"
                        style={{ paddingTop: 64, paddingBottom: 14 }}
                        onPointerMove={onBoardMove}
                        onPointerLeave={resetTilt}
                        role="img"
                        aria-label={boardLabel}
                      >
                        <motion.div
                          style={{ width: boardW, height: boardH, position: "relative", transformStyle: "preserve-3d", rotateX, rotateY }}
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
                                  style={{ left: weekIndex * STEP, top: dayIndex * STEP, width: CELL, height: CELL, transformStyle: "preserve-3d", opacity: 0.82 }}
                                  initial={{ z: -26 }}
                                  whileInView={{ z: 0 }}
                                  viewport={{ once: true }}
                                  transition={{ delay: 0.15 + (weekIndex * 7 + dayIndex) * 0.004, type: "spring", stiffness: 260, damping: 22 }}
                                  whileHover={{ z: 18, scale: 1.08 }}
                                >
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
                  <div className="flex items-center justify-center sm:justify-start gap-2 text-[10px] text-muted pt-1">
                    <span>Less</span>
                    {[0, 1, 3, 6, 11].map((count) => (
                      <div key={count} className={`w-3 h-3 rounded-[3px] ${getIntensity(count)}`} />
                    ))}
                    <span>More</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
