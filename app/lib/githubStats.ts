// Pure arithmetic behind the home page's GitHub card, kept out of both the route and the
// component so the rules that decide what the grid COVERS can be tested without a network
// or a DOM. The card previously derived its 12-week grid, "Day streak" and "Best day" from
// a single /commits?per_page=100 page: on 2026-09-16 the live payload's `days` map summed
// to exactly 100 and omitted 2026-07-22's 22 commits, a day git puts inside the window.

export interface CommitDay {
  date: string;
  count: number;
}

export interface LanguageShare {
  name: string;
  percentage: number;
}

const DAY_MS = 86_400_000;

/** The UTC calendar day of an instant, as YYYY-MM-DD — the key both sides of the card use. */
export function utcDayKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Midnight UTC, `weeks * 7 + slackDays` days before `now`'s UTC day — the `since` bound for
 * the commit fetch. Truncating to 00:00:00Z is load-bearing: Next caches upstream fetches
 * per URL, so a to-the-second `since` would hand every visitor a fresh cache key and spend
 * GitHub's anonymous 60-req/hr-per-IP budget on duplicate pages. One day of slack covers a
 * viewer whose clock has already rolled past the server's UTC day.
 */
export function commitWindowStart(now: Date, weeks: number, slackDays = 1): Date {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(startOfToday - (weeks * 7 + slackDays) * DAY_MS);
}

/**
 * Counts per UTC day. GitHub normalises `commit.author.date` to Z, but parsing rather than
 * splitting on "T" means an offset timestamp still lands on the UTC day the grid draws
 * (2026-09-15T21:23-07:00 is the 09-16 column). Unparsable entries are skipped, never
 * counted as a day.
 */
export function bucketByUtcDay(
  timestamps: Iterable<string | null | undefined>,
): Record<string, number> {
  const days: Record<string, number> = {};
  for (const ts of timestamps) {
    if (!ts) continue;
    const parsed = Date.parse(ts);
    if (Number.isNaN(parsed)) continue;
    const key = utcDayKey(new Date(parsed));
    days[key] = (days[key] ?? 0) + 1;
  }
  return days;
}

/**
 * The grid's cells: `weeks * 7` consecutive UTC days ending on `now`'s UTC day, oldest
 * first. Stepping in UTC milliseconds rather than with local setDate() keeps the columns
 * one day apart across a DST change, where local arithmetic can repeat or skip a key.
 */
export function buildDayWindow(
  now: Date,
  weeks: number,
  counts: ReadonlyMap<string, number>,
): CommitDay[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const total = weeks * 7;
  const cells: CommitDay[] = [];
  for (let i = total - 1; i >= 0; i--) {
    const date = utcDayKey(new Date(today - i * DAY_MS));
    cells.push({ date, count: counts.get(date) ?? 0 });
  }
  return cells;
}

/**
 * Consecutive commit days ending today or yesterday, GitHub's convention. A streak is not
 * broken until the UTC day after the last commit has itself ended, so counting strictly
 * from today reported 0 every morning before the day's first push.
 */
export function currentStreak(days: readonly CommitDay[]): number {
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  let streak = 0;
  for (; i >= 0 && days[i].count > 0; i--) streak++;
  return streak;
}

/** The `rel="next"` URL of a GitHub Link header, or null once the last page is in hand. */
export function parseNextLink(link: string | null | undefined): string | null {
  if (!link) return null;
  for (const entry of link.split(",")) {
    const m = entry.match(/^\s*<([^>]+)>\s*;\s*(.+)$/);
    if (m && /\brel\s*=\s*"?next"?/.test(m[2])) return m[1];
  }
  return null;
}

/**
 * Whole-percent language shares, largest first. The sub-1% filter runs BEFORE the slice so
 * a language nobody can see does not consume one of the chips: JavaScript is 559 of the
 * repo's 442,969 tracked bytes (0.13%), which Math.round rendered as a "JavaScript 0%" chip.
 */
export function topLanguages(bytes: Record<string, number>, limit = 3): LanguageShare[] {
  const total = Object.values(bytes).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return Object.entries(bytes)
    .map(([name, b]) => ({ name, percentage: Math.round((b / total) * 100) }))
    .sort((a, b) => b.percentage - a.percentage)
    .filter((l) => l.percentage >= 1)
    .slice(0, limit);
}
