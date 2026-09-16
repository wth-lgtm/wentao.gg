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
 * the commit fetch.
 *
 * Truncating to 00:00:00Z is still right, but NOT for the reason this comment used to
 * give. It said a to-the-second `since` would defeat Next's per-URL fetch cache and spend
 * the 60-req/hr anonymous budget on duplicate keys; that cache no longer exists — the
 * route reads every upstream with `cache: "no-store"` inside one unstable_cache entry, so
 * the URL is not a cache key and the budget is spent per REGENERATION (at most ~12/hr)
 * whatever this bound says.
 *
 * What the truncation buys now is a STABLE WINDOW: every regeneration inside one UTC day
 * asks for the same range, so two snapshots taken ten minutes apart cover the same set of
 * days and the grid's oldest column cannot slide by seconds between renders. One day of
 * slack covers a viewer whose clock has already rolled past the server's UTC day.
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

/** The subset of `Response` the commit pager needs, so a test can inject a fake. */
export interface PagedResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers: { get: (name: string) => string | null };
}

export interface CommitWindow {
  /** Author dates of every commit on every page that came back. */
  authored: string[];
  /** True when the window is CUT OFF: a page failed or the page cap was reached. */
  truncated: boolean;
}

/** Whether a URL the Link header offered is on the origin we are willing to send
 * credentials to. A URL that will not parse is not on it. */
function onOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Walks `/commits?since=…` from `firstUrl` along the Link `rel="next"` chain, at most
 * `pageCap` pages, and never off `allowedOrigin`.
 *
 * Nothing here throws: a failed page, an exhausted cap or a refused origin returns the
 * pages already in hand with `truncated: true`, because the commit total and the language
 * list are fetched separately and discarding them over a 403 on page one would blank a
 * card whose other halves arrived intact.
 *
 * `allowedOrigin` is required, not optional, because it guards a CREDENTIAL. The caller's
 * fetch attaches `Authorization: Bearer $GITHUB_TOKEN` to every request it makes, and the
 * URL of every request after the first comes out of an upstream RESPONSE HEADER — so
 * without this, a Link header naming another host is enough to have the token sent there.
 * An optional parameter defaulting to "allow anything" would leave the one call site that
 * forgets it in exactly the state this fixes.
 */
export async function fetchCommitWindow(
  fetchImpl: (url: string) => Promise<PagedResponse>,
  firstUrl: string,
  pageCap: number,
  allowedOrigin: string,
): Promise<CommitWindow> {
  const authored: string[] = [];
  let next: string | null = firstUrl;
  for (let page = 0; next !== null; page++) {
    if (page >= pageCap) return { authored, truncated: true };
    if (!onOrigin(next, allowedOrigin)) return { authored, truncated: true };
    const res = await fetchImpl(next);
    if (!res.ok) return { authored, truncated: true };
    const batch = await res.json();
    // A non-list body is GitHub telling us something (a rate-limit message, say), not a
    // page of commits — the window is cut off, not empty.
    if (!Array.isArray(batch)) return { authored, truncated: true };
    for (const c of batch as Array<{ commit?: { author?: { date?: string } } }>) {
      // Skipped, not pushed as "". A blank is a sentinel, and it made this array's type
      // a lie and put the decision to drop it in bucketByUtcDay — two places agreeing
      // about a value neither of them wants.
      const date = c?.commit?.author?.date;
      if (typeof date === "string" && date !== "") authored.push(date);
    }
    next = parseNextLink(res.headers.get("link"));
  }
  return { authored, truncated: false };
}

/**
 * The `rel="next"` URL of a Link header, or null once the last page is in hand.
 *
 * `rel` is a whitespace-separated TOKEN LIST (RFC 8288) and its values are
 * case-insensitive, so it is parsed as one rather than matched as a substring: the old
 * `/\brel\s*=\s*"?next"?/` said yes to `rel="nextpage"` and to a parameter named
 * `data-rel`, and no to `rel="next last"` or `rel="NEXT"`. It matters more than a
 * tidiness fix because the URL this returns is the next request the pager makes.
 *
 * Still deliberately narrow in one respect: it splits entries on "," and so would
 * mis-split a Link header whose URL contains a bare comma. GitHub percent-encodes those,
 * and the alternative is a full RFC 8288 tokeniser for one upstream.
 */
export function parseNextLink(link: string | null | undefined): string | null {
  if (!link) return null;
  for (const entry of link.split(",")) {
    const m = entry.match(/^\s*<([^>]+)>\s*;\s*(.+)$/);
    if (!m) continue;
    const rel = m[2].match(/(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;,\s]*))/);
    const tokens = (rel?.[1] ?? rel?.[2] ?? "").trim().toLowerCase().split(/\s+/);
    if (tokens.includes("next")) return m[1];
  }
  return null;
}

/**
 * The repo's total commit count, read from the head page (`?per_page=1`).
 *
 * The Link header's `rel="last"` page number is the count, and it works past 100 where
 * counting a single page does not. Falling back to the body's length is correct only when
 * the body IS a page of commits: `.length` on a non-array — GitHub's rate-limit message
 * object is the one that actually happens — is `undefined`, which JSON.stringify DROPS
 * from the payload, so the card was handed a snapshot with no `commits` key at all rather
 * than an error it could render. null says "no count", and the caller decides.
 */
export function totalCommits(link: string | null | undefined, body: unknown): number | null {
  const last = link?.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (last) {
    const n = parseInt(last[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  return Array.isArray(body) ? body.length : null;
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
