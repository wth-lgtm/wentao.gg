// One clock per subtraction.
//
// Every age this app prints is "how old is the body on screen", and the two clocks that
// could answer it — the server's and the visitor's — are not the same clock. A visitor
// whose system time ran three minutes behind saw a five-minute-old snapshot clamped to
// 00:00 while the age was `Date.now() - body.updatedAt`. So the server reports how old
// the body already was when it LEFT (a duration, on its own clock), the client stamps the
// instant it ARRIVED (on its own clock), and the reading is that duration plus a
// same-clock elapsed time. Nothing here subtracts one clock from the other.
//
// Two sources say how old a body was on departure, and neither alone is enough:
//
//   - the CDN's `age` header, which is absent on a MISS — and a MISS can be answered
//     out of Next's Data Cache with a body up to TTL_S old (app/api/hl-leaderboard
//     stamps `updatedAt` INSIDE the cached callback for exactly this reason), so the
//     header alone read AGE 00:00 over a five-minute-old snapshot;
//   - the body's own `servedAgeMs`, which the handler stamps as (now - updatedAt) on the
//     server clock, and which is therefore 0 at the instant the entry is written and
//     knows nothing about how long the edge then held the response.
//
// Each undercounts what the other measures, so the honest reading is the larger.
// Pure, so tests/servedAge.test.ts can pin all four combinations.

export interface ReceiptAge {
  /** Our clock when the body landed. A delta base, never printed. */
  receivedAt: number;
  /** How old the body already was at that instant, in ms. 0 when nothing said. */
  ageAtReceipt: number;
}

/**
 * The age a body already had when it landed, from the two departure-side readings.
 *
 * `Number(null ?? 0)` is 0 and a non-numeric header is NaN — either way an absent or
 * unparseable age means "as fresh as that source can tell", and only a positive finite
 * body figure counts: a string, a negative or a NaN is a shape problem, not a reading.
 */
export function ageAtReceiptMs(ageHeader: string | null, servedAgeMs: unknown): number {
  const header = Number(ageHeader ?? 0);
  const fromHeader = Number.isFinite(header) && header > 0 ? header * 1000 : 0;
  const fromBody =
    typeof servedAgeMs === "number" && Number.isFinite(servedAgeMs) && servedAgeMs > 0
      ? servedAgeMs
      : 0;
  return Math.max(fromHeader, fromBody);
}

/** The reading: departure age plus our own elapsed time since, never negative. */
export function elapsedMs(receipt: ReceiptAge, now: number): number {
  return Math.max(0, receipt.ageAtReceipt + (now - receipt.receivedAt));
}
