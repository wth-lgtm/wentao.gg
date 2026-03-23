"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { GitCommit, Code, Github } from "lucide-react";

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

function formatNumber(num: number): string {
  if (num >= 1000) return (num / 1000).toFixed(1) + "k";
  return num.toString();
}

// Cache for GitHub API responses (persists across re-renders)
const apiCache: { data: any; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export default function SiteStats() {
  const [commitData, setCommitData] = useState<Map<string, number>>(new Map());
  const [stats, setStats] = useState<RepoStats>({ commits: 0, linesOfCode: 0, languages: [] });
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile on mount
  useEffect(() => {
    setIsMobile(window.innerWidth < 640);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch both endpoints in parallel for faster loading
        const [commitsRes, langRes] = await Promise.all([
          fetch("https://api.github.com/repos/wth-lgtm/wentao.gg/commits?per_page=100", {
            next: { revalidate: 300 }, // Cache for 5 minutes
          }),
          fetch("https://api.github.com/repos/wth-lgtm/wentao.gg/languages", {
            next: { revalidate: 300 },
          }),
        ]);

        const commits = commitsRes.ok ? await commitsRes.json() : [];
        const languages = langRes.ok ? await langRes.json() : {};

        const countMap = new Map<string, number>();
        commits.forEach((commit: { commit: { author: { date: string } } }) => {
          const date = commit.commit.author.date.split("T")[0];
          countMap.set(date, (countMap.get(date) || 0) + 1);
        });
        setCommitData(countMap);

        const totalBytes = Object.values(languages as Record<string, number>).reduce((a, b) => a + b, 0);
        const estimatedLines = Math.round(totalBytes / 40);

        const langArray = Object.entries(languages as Record<string, number>)
          .map(([name, bytes]) => ({
            name,
            percentage: Math.round((bytes / totalBytes) * 100),
          }))
          .sort((a, b) => b.percentage - a.percentage)
          .slice(0, 3);

        setStats({
          commits: commits.length,
          linesOfCode: estimatedLines,
          languages: langArray,
        });
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Responsive weeks: fewer on mobile
  const weeksToShow = isMobile ? 8 : 12;

  // Generate array of dates for the grid
  const today = new Date();
  const daysToShow = weeksToShow * 7;
  const days: CommitDay[] = [];

  for (let i = daysToShow - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    days.push({
      date: dateStr,
      count: commitData.get(dateStr) || 0,
    });
  }

  // Group by weeks (columns)
  const weeks: CommitDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <section className="py-16 px-6 relative z-20 pointer-events-none">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="bg-white/5 backdrop-blur-lg rounded-2xl border border-white/10 p-6 sm:p-8 pointer-events-auto"
        >
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
              className="text-xs text-accent hover:underline"
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 }}
                  className="flex items-center gap-3"
                >
                  <div className="p-2 bg-accent/10 rounded-lg">
                    <GitCommit size={18} className="text-accent" />
                  </div>
                  <div>
                    <div className="text-xl font-bold">{stats.commits}+</div>
                    <div className="text-xs text-muted">Commits</div>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 }}
                  className="flex items-center gap-3"
                >
                  <div className="p-2 bg-accent/10 rounded-lg">
                    <Code size={18} className="text-accent" />
                  </div>
                  <div>
                    <div className="text-xl font-bold">{formatNumber(stats.linesOfCode)}</div>
                    <div className="text-xs text-muted">Lines of code</div>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 }}
                  className="col-span-2 sm:col-span-1 flex items-center gap-2 flex-wrap"
                >
                  {stats.languages.map((lang, i) => (
                    <span
                      key={lang.name}
                      className="text-xs px-2 py-1 bg-background rounded-full text-muted"
                    >
                      {lang.name} {lang.percentage}%
                    </span>
                  ))}
                </motion.div>
              </div>

              {/* Heatmap */}
              <div className="space-y-3">
                <div className="text-xs text-muted">Activity</div>

                <div className="flex justify-center sm:justify-start">
                  <div className="flex gap-[3px]">
                    {weeks.map((week, weekIndex) => (
                      <div key={weekIndex} className="flex flex-col gap-[3px]">
                        {week.map((day, dayIndex) => (
                          <motion.div
                            key={day.date}
                            initial={{ opacity: 0, scale: 0 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            viewport={{ once: true }}
                            transition={{
                              delay: 0.3 + (weekIndex * 7 + dayIndex) * 0.003,
                              type: "spring",
                              stiffness: 300,
                              damping: 20,
                            }}
                            whileHover={{ scale: 1.3 }}
                            className={`w-3 h-3 sm:w-[14px] sm:h-[14px] rounded-[3px] ${getIntensity(day.count)} cursor-pointer`}
                            title={`${day.date}: ${day.count} commit${day.count !== 1 ? "s" : ""}`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Legend */}
                <div className="flex items-center justify-center sm:justify-start gap-2 text-[10px] text-muted pt-1">
                  <span>Less</span>
                  {[0, 1, 3, 6, 11].map((count) => (
                    <div
                      key={count}
                      className={`w-3 h-3 rounded-[3px] ${getIntensity(count)}`}
                    />
                  ))}
                  <span>More</span>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </section>
  );
}
