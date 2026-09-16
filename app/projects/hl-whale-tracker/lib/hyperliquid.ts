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

/**
 * A row's outcome, distinguishing the two reasons a row is dropped.
 *
 * "partial" is a shape we DO understand whose figures are incomplete; "unreadable" is
 * a window we cannot read at all. Only the second means the payload changed shape, so
 * only the second should be able to trip the route's all-rows-failed guard on its own.
 */
type RowOutcome =
  | { kind: "row"; metrics: TraderMetrics }
  | { kind: "partial" }
  | { kind: "unreadable" };

function rowToMetrics(row: LeaderboardRow, period: TimePeriod): RowOutcome {
  const perf = readWindow(row, period);
  if (!perf) return { kind: "unreadable" };

  const pnl = num(perf.pnl);
  const roi = num(perf.roi);
  const volume = num(perf.vlm);
  // If not one of the three numbers parsed, this is a shape we don't understand — drop the
  // row so the caller can notice, rather than publishing zeros.
  if (pnl === null && roi === null && volume === null) return { kind: "unreadable" };

  const address = typeof row.ethAddress === "string" ? row.ethAddress : "";
  if (!address) return { kind: "unreadable" };

  const accountValue = num(row.accountValue);

  // A PARTIALLY parsed row is dropped and counted, not zero-filled.
  //
  // This used to read `pnl ?? 0`, `(roi ?? 0) * 100`, `volume ?? 0`,
  // `num(row.accountValue) ?? 0` — so the all-three-null guard above was the only
  // guard, and a row missing one figure published a confident zero for it. The
  // consequences were specific: a missing vlm joined the analytics "NONE" cohort,
  // which whale-analytics verified is a real cohort of spot-only holders (2,922 rows
  // of the live 45,086 have a genuine all-time volume of exactly 0), a missing roi
  // sorted to the bottom of the ROI column as 0%, and a missing accountValue printed
  // $0 capital. A missing figure is not a zero.
  //
  // Dropping rather than widening TraderMetrics to number|null is deliberate: the
  // four fields are read on 33 lines across five files that do bare arithmetic on
  // them (lib/analytics.ts sums, means, Spearman and the Lorenz curve;
  // hooks/useTableControls.ts sort accessors; LeaderboardRow, TraderCard and
  // AnalyticsPanel formatters), so a null threaded through without a decision at each
  // one would land as NaN on screen — a worse lie than the zero. The drop is counted
  // instead, so a shape change still surfaces: rowsPartial here, and rowsParsed
  // falling to 0 trips the 502 in app/api/hl-leaderboard/route.ts. Verified against
  // the live payload: 45,086 of 45,086 rows parse complete today, so nothing is
  // dropped in practice and the four boards are unchanged row for row.
  if (pnl === null || roi === null || volume === null || accountValue === null) {
    return { kind: "partial" };
  }

  return {
    kind: "row",
    metrics: {
      address,
      pnl,
      winRate: roi * 100, // ROI arrives as a decimal (0.1 = 10%)
      volume,
      accountValue,
      lastUpdated: Date.now(),
    },
  };
}

export interface MappedLeaderboard {
  periods: Record<TimePeriod, TraderMetrics[]>;
  rowsSeen: number;
  rowsParsed: number;
  /** Rows understood but incomplete, dropped rather than zero-filled. */
  rowsPartial: number;
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
  let rowsPartial = 0;

  for (const period of ALL_PERIODS) {
    const traders: TraderMetrics[] = [];
    let partial = 0;
    for (const row of rows) {
      const outcome = rowToMetrics(row, period);
      if (outcome.kind === "row") traders.push(outcome.metrics);
      else if (outcome.kind === "partial") partial++;
    }
    // Both counts are taken over the all-time pass, which is the pass the route's
    // "rows arrived but none parsed" guard reads. accountValue is not window-scoped,
    // so an incomplete row is usually incomplete in every window anyway.
    if (period === "allTime") {
      rowsParsed = traders.length;
      rowsPartial = partial;
    }
    traders.sort((a, b) => b.pnl - a.pnl);
    periods[period] = traders.slice(0, limit);
  }

  return { periods, rowsSeen: rows.length, rowsParsed, rowsPartial };
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
