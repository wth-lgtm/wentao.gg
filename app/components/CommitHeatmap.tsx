"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import dynamic from "next/dynamic";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion";
import { GitCommit, Code, Github, Flame, Zap } from "lucide-react";

// Interactive floating-sphere background — client-only, lazy (three.js off the initial bundle).
const FloatingBackground = dynamic(() => import("./FloatingBackground"), { ssr: false });

interface CommitDay {
  date: string;
  count: number;
}

interface RepoStats {
  commits: number;
  linesOfCode: number;
  languages: { name: string; percentage: number }[];
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

// 3D bar levels: extrusion height (px) + token-driven top/side face colors.
const LEVELS = [
  { h: 3, top: "color-mix(in srgb, var(--accent) 18%, var(--card))", side: "color-mix(in srgb, var(--accent) 18%, #000 60%)" },
  { h: 13, top: "color-mix(in srgb, var(--accent) 45%, var(--card))", side: "color-mix(in srgb, var(--accent) 45%, #000 55%)" },
  { h: 24, top: "color-mix(in srgb, var(--accent) 64%, var(--card))", side: "color-mix(in srgb, var(--accent) 64%, #000 50%)" },
  { h: 36, top: "color-mix(in srgb, var(--accent) 82%, var(--card))", side: "color-mix(in srgb, var(--accent) 82%, #000 48%)" },
  { h: 50, top: "var(--accent)", side: "color-mix(in srgb, var(--accent), #000 45%)" },
];

const CELL = 15;
const GAP = 5;
const STEP = CELL + GAP;
const BASE_TILT_X = 52; // 3/4 skyline tilt
const BASE_ROT_Y = -26; // horizontal turn — staggers columns so fewer bars hide

export default function SiteStats() {
  const [commitData, setCommitData] = useState<Map<string, number>>(new Map());
  const [stats, setStats] = useState<RepoStats>({ commits: 0, linesOfCode: 0, languages: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [finePointer, setFinePointer] = useState(false);
  const [bgVisible, setBgVisible] = useState(false);
  const [accentHex, setAccentHex] = useState("#3b82f6");
  const reduceMotion = useReducedMotion() ?? false;

  // Background canvas: mount/unmount as the card enters/leaves the viewport (frees the
  // 2nd WebGL context offscreen). Callback ref → fires exactly when the node attaches.
  const bgObserver = useRef<IntersectionObserver | null>(null);
  const attachBg = useCallback((node: HTMLDivElement | null) => {
    bgObserver.current?.disconnect();
    bgObserver.current = null;
    if (node) {
      const io = new IntersectionObserver(([e]) => setBgVisible(e.isIntersecting), { rootMargin: "300px" });
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
    const a = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    if (a) setAccentHex(a);
  }, []);

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
  const today = new Date();
  const daysToShow = weeksToShow * 7;
  const days: CommitDay[] = [];
  for (let i = daysToShow - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    days.push({ date: dateStr, count: commitData.get(dateStr) || 0 });
  }
  const weeks: CommitDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  let streak = 0;
  for (let k = days.length - 1; k >= 0; k--) {
    if (days[k].count > 0) streak++;
    else break;
  }
  const bestDay = days.reduce((m, d) => Math.max(m, d.count), 0);

  const view = {
    commits: unavailable ? 0 : stats.commits,
    languages: unavailable ? [] : stats.languages,
  };
  const statTiles = [
    { icon: GitCommit, value: unavailable ? "—" : `${stats.commits}`, label: "Commits" },
    { icon: Code, value: unavailable ? "—" : `~${formatNumber(stats.linesOfCode)}`, label: "Lines of code" },
    { icon: Flame, value: unavailable ? "—" : `${streak}`, label: "Day streak" },
    { icon: Zap, value: unavailable ? "—" : `${bestDay}`, label: "Best day" },
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
    `${day.date}: ${day.count} commit${day.count !== 1 ? "s" : ""}`;

  return (
    <section className="py-16 px-6 relative z-20 pointer-events-none">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="relative bg-card/60 backdrop-blur-lg rounded-2xl border border-border p-6 sm:p-8 pointer-events-auto"
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
              {bgVisible && <FloatingBackground accent={accentHex} />}
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
                  {view.languages.map((lang) => (
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
                        aria-label={`Commit activity for the last ${weeksToShow} weeks — ${view.commits} commits`}
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
                                  className="absolute cursor-pointer"
                                  style={{ left: weekIndex * STEP, top: dayIndex * STEP, width: CELL, height: CELL, transformStyle: "preserve-3d" }}
                                  initial={{ z: -26 }}
                                  whileInView={{ z: 0 }}
                                  viewport={{ once: true }}
                                  transition={{ delay: 0.15 + (weekIndex * 7 + dayIndex) * 0.004, type: "spring", stiffness: 260, damping: 22 }}
                                  whileHover={{ z: 18, scale: 1.08 }}
                                >
                                  <div className="absolute inset-0 rounded-[2px]" style={{ background: lvl.top, transform: `translateZ(${lvl.h}px)` }} />
                                  <div className="absolute left-0 bottom-0" style={{ width: CELL, height: lvl.h, background: lvl.side, transformOrigin: "bottom", transform: "rotateX(-90deg)" }} />
                                  <div className="absolute top-0 right-0" style={{ width: lvl.h, height: CELL, background: lvl.side, transformOrigin: "right", transform: "rotateY(90deg)" }} />
                                </motion.div>
                              );
                            })
                          )}
                        </motion.div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-center sm:justify-start">
                      <div className="flex gap-[3px]">
                        {weeks.map((week, weekIndex) => (
                          <div key={weekIndex} className="flex flex-col gap-[3px]">
                            {week.map((day) => (
                              <div key={day.date} className={`w-3 h-3 sm:w-[14px] sm:h-[14px] rounded-[3px] ${getIntensity(day.count)}`} title={dayTitle(day)} />
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
