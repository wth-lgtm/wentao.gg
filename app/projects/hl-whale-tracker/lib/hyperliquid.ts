import {
  LeaderboardApiResponse,
  LeaderboardRow,
  LeaderboardWindowPerformance,
  TimePeriod,
  TIME_WINDOW_INDEX,
  TraderMetrics,
  WINDOW_NAME,
} from "./types";

const LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

// The upstream body is ~33MB ungzipped, so this module runs SERVER-side only
// (app/api/hl-leaderboard/route.ts). The browser gets the reduced top-50-per-period
// response instead — see that route.

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

export const ALL_PERIODS: TimePeriod[] = ["1d", "7d", "30d", "allTime"];

export async function fetchLeaderboard(
  signal?: AbortSignal
): Promise<ApiResponse<LeaderboardApiResponse>> {
  try {
    const response = await fetch(LEADERBOARD_URL, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    return { data: await response.json(), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// A number, or null — never a silent 0. The previous `parseFloat(x) || 0` is exactly how
// a shape mismatch turned into 40,801 rows of confident $0.00: NaN became zero and nothing
// upstream of the UI could tell "no data" apart from "genuinely flat".
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function isPerf(v: unknown): v is LeaderboardWindowPerformance {
  return typeof v === "object" && v !== null && ("pnl" in v || "roi" in v || "vlm" in v);
}

/**
 * Read one window off a row without assuming which shape the API uses.
 *
 * Hyperliquid is documented/observed to return NAMED TUPLES — ["day", {pnl,roi,vlm}] —
 * but the previous code assumed bare positional objects. Rather than bet on either (the
 * live endpoint is not reachable from every environment), accept both: prefer a name
 * match, fall back to the positional object.
 */
function readWindow(
  row: LeaderboardRow,
  period: TimePeriod
): LeaderboardWindowPerformance | null {
  const windows = row?.windowPerformances;
  if (!Array.isArray(windows)) return null;

  // Named-tuple form.
  const wanted = WINDOW_NAME[period];
  for (const entry of windows) {
    if (Array.isArray(entry) && entry[0] === wanted && isPerf(entry[1])) {
      return entry[1];
    }
  }

  // Positional bare-object form.
  const at = windows[TIME_WINDOW_INDEX[period]];
  return !Array.isArray(at) && isPerf(at) ? at : null;
}

function rowToMetrics(row: LeaderboardRow, period: TimePeriod): TraderMetrics | null {
  const perf = readWindow(row, period);
  if (!perf) return null;

  const pnl = num(perf.pnl);
  const roi = num(perf.roi);
  const volume = num(perf.vlm);
  // If not one of the three numbers parsed, this is a shape we don't understand — drop the
  // row so the caller can notice, rather than publishing zeros.
  if (pnl === null && roi === null && volume === null) return null;

  const address = typeof row.ethAddress === "string" ? row.ethAddress : "";
  if (!address) return null;

  return {
    address,
    pnl: pnl ?? 0,
    winRate: (roi ?? 0) * 100, // ROI arrives as a decimal (0.1 = 10%)
    volume: volume ?? 0,
    accountValue: num(row.accountValue) ?? 0,
    lastUpdated: Date.now(),
  };
}

export interface MappedLeaderboard {
  periods: Record<TimePeriod, TraderMetrics[]>;
  rowsSeen: number;
  rowsParsed: number;
}

/**
 * Reduce the full payload to the top `limit` per period, once. Also reports how many rows
 * actually parsed so the route can fail loudly on a shape change instead of serving a
 * table of zeros — the failure mode this whole file exists to prevent.
 */
export function mapAllPeriods(
  json: LeaderboardApiResponse | null,
  limit = 50
): MappedLeaderboard | null {
  const rows = json?.leaderboardRows;
  if (!Array.isArray(rows)) return null;

  const periods = {} as Record<TimePeriod, TraderMetrics[]>;
  let rowsParsed = 0;

  for (const period of ALL_PERIODS) {
    const traders: TraderMetrics[] = [];
    for (const row of rows) {
      const m = rowToMetrics(row, period);
      if (m) traders.push(m);
    }
    if (period === "allTime") rowsParsed = traders.length;
    traders.sort((a, b) => b.pnl - a.pnl);
    periods[period] = traders.slice(0, limit);
  }

  return { periods, rowsSeen: rows.length, rowsParsed };
}

// Kept for callers that want a single period (server-side only).
export async function getTopTraders(
  timePeriod: TimePeriod,
  limit: number = 50
): Promise<ApiResponse<TraderMetrics[]>> {
  const result = await fetchLeaderboard();
  if (result.error || !result.data) return { data: null, error: result.error };

  const mapped = mapAllPeriods(result.data, limit);
  if (!mapped) return { data: null, error: "Unexpected leaderboard response shape" };
  if (mapped.rowsSeen > 0 && mapped.rowsParsed === 0) {
    return { data: null, error: "Unexpected leaderboard response shape" };
  }
  return { data: mapped.periods[timePeriod], error: null };
}
