// Leaderboard API response types
export interface LeaderboardWindowPerformance {
  pnl: string;
  roi: string;
  vlm: string;
}

export interface LeaderboardRow {
  ethAddress: string;
  accountValue: string;
  // Deliberately `unknown[]`. This used to be declared as an array of objects, which is
  // a claim TypeScript cannot check against a live third-party payload — and the claim was
  // wrong, so every value silently parsed to 0 while the compiler stayed happy. Typing it
  // honestly forces the reader in hyperliquid.ts to prove the shape at runtime.
  windowPerformances: unknown[];
}

export interface LeaderboardApiResponse {
  leaderboardRows: LeaderboardRow[];
}

// The API labels each window. Matching on the NAME is order-independent, so an upstream
// reordering can't silently re-attribute a month of PnL to a day.
export const WINDOW_NAME = {
  "1d": "day",
  "7d": "week",
  "30d": "month",
  allTime: "allTime",
} as const;

// Positional fallback, used only if a payload turns out to hold bare objects with no names.
export const TIME_WINDOW_INDEX = {
  "1d": 0,
  "7d": 1,
  "30d": 2,
  allTime: 3,
} as const;

export type TimePeriod = "1d" | "7d" | "30d" | "allTime";

export type SortField = "pnl" | "winRate" | "volume";

export type SortDirection = "asc" | "desc";

export interface TraderMetrics {
  address: string;
  label?: string;
  pnl: number;
  winRate: number; // Actually ROI from API
  volume: number;
  accountValue: number;
  lastUpdated: number;
}

export interface LeaderboardState {
  traders: TraderMetrics[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}
