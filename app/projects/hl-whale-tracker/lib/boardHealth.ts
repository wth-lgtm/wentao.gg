// Is the leaderboard payload one the board can render honestly?
//
// app/api/hl-leaderboard/route.ts answers 502 only when NOTHING could be read — no
// complete row and no row understood well enough to be called incomplete. That
// relaxation is right for the case it was written for: upstream renaming ONE field
// drops every row as `partial`, and a board that could say "45,092 rows arrived, all of
// them incomplete" should not go dark instead. But it produces a payload shape nothing
// downstream handled — `periods` empty in every window, `rowsPartial` in the tens of
// thousands, HTTP 200 — and LeaderboardTable reads `noRows && error === null` as EMPTY
// and prints "No traders found with activity in this period". That is a fabricated fact
// about the market: the upstream publishes a top-N per window and had 45,092 rows on
// 2026-09-16, and LeaderboardTable's own comment says the sentence is reachable only
// through the error path.
//
// So the classification happens here, on the body, and useLeaderboard turns it into the
// hook's `error` — which is what puts the existing BOARD UNAVAILABLE state on screen and
// the honest sentence in the banner, with the rail's DROPPED field saying how many.
// The route keeps its 200 and its `rowsPartial`: the payload is not wrong, it is just
// not a board.
//
// Pure, and in its own module rather than in lib/hyperliquid.ts, because that module is
// server-only by its own contract (it holds the 37MB upstream fetch) and this is read by
// a client hook. See tests/boardHealth.test.ts.

/**
 * True only for the case above: rows arrived, at least one window dropped some, and NO
 * window has a single row left to show.
 *
 * Deliberately false for every shape it cannot judge. The caller's own `!body?.periods`
 * guard owns a malformed body, and two sentences over one failure is worse than one.
 */
export function isUnreadableBoard(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") return false;
  const body = payload as { periods?: unknown; rowsPartial?: unknown };

  const periods = body.periods;
  if (periods === null || typeof periods !== "object") return false;
  const windows = Object.values(periods as Record<string, unknown>);
  // An empty `periods` object is a shape problem, not an unreadable board.
  if (windows.length === 0) return false;
  if (!windows.every((rows) => Array.isArray(rows) && rows.length === 0)) return false;

  const partial = body.rowsPartial;
  if (partial === null || typeof partial !== "object") return false;
  // At least one window that says rows arrived and could not be read. With every count
  // at 0 the board is empty because upstream held nothing — a real empty, which the
  // fabrication guard must not claim.
  return Object.values(partial as Record<string, unknown>).some(
    (count) => typeof count === "number" && count > 0
  );
}

/**
 * What the banner says, given the count for the window ON SCREEN.
 *
 * The window's own count rather than a total, so this sentence and the rail's DROPPED
 * field can never print two different numbers for one failure. Without a count the
 * parenthetical goes: "(0 dropped)" over an empty board would be a claim about a window
 * whose rows failed some other way.
 */
export function unreadableBoardMessage(dropped: number | null): string {
  const head =
    "Leaderboard unreadable: upstream rows arrived but none carried complete figures";
  if (dropped === null || dropped <= 0) return head;
  return `${head} (${dropped.toLocaleString("en-US")} dropped in this window)`;
}
