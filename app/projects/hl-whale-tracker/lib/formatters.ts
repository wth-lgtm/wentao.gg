// Format address for display (truncated)
export function formatAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

type Unit = readonly [threshold: number, suffix: string];

// Unit tables for the compact forms, largest first: the first threshold a magnitude
// clears wins. B is load-bearing, not future-proofing — live /api/hl-leaderboard has
// 20 of 50 all-time rows at or above $1B (ceiling 5.9e11) and three 30-day account
// values above $1B (ceiling 1.48e10), all of which used to print as "$590000.0M" and
// "$14793.3M". T is headroom. Odometer.tsx renders any non-digit as a static glyph,
// so a new suffix letter needs no change there.
const CURRENCY_UNITS: readonly Unit[] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];
// Percent scales only from 100,000% up (see formatPercent), so it never needs a K.
const PERCENT_UNITS: readonly Unit[] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];
const BARE_UNIT: Unit = [1, ""];

/**
 * Scale a magnitude into the largest unit it clears and round it there.
 *
 * The step-up rule is the part worth reading: rounding can push the mantissa to a
 * full 1000 (999.95M at one decimal), and "1000.0M" is by definition the wrong unit,
 * so the scale climbs one rung and prints "1.0B". The bare tier climbs into K the
 * same way, which is why 999.99 reads "$1.0K".
 */
function scaleCompact(
  absValue: number,
  units: readonly Unit[],
  decimalsFor: (scaled: number) => number
): string {
  let index = units.findIndex(([threshold]) => absValue >= threshold);
  if (index === -1) index = units.length;
  for (;;) {
    const [threshold, suffix] = index < units.length ? units[index] : BARE_UNIT;
    const scaled = absValue / threshold;
    const mantissa = scaled.toFixed(decimalsFor(scaled));
    if (index === 0 || Number(mantissa) < 1000) return `${mantissa}${suffix}`;
    index -= 1;
  }
}

// Format currency values
export function formatCurrency(
  value: number,
  options: {
    showSign?: boolean;
    compact?: boolean;
    decimals?: number;
  } = {}
): string {
  const { showSign = false, compact = false, decimals = 2 } = options;

  const absValue = Math.abs(value);
  let formatted: string;

  if (compact) {
    formatted = `$${scaleCompact(absValue, CURRENCY_UNITS, () => decimals)}`;
  } else {
    formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(absValue);
  }

  if (showSign) {
    // `formatted` is built from the ABSOLUTE value, so it carries the $ and no sign — the
    // old negative branch stripped the $ (yielding "-1.50M" against "+$1.50M") and its
    // trailing .replace("--","-$") could never fire because there was no "--" to find.
    if (value > 0) return `+${formatted}`;
    if (value < 0) return `-${formatted}`;
  }

  return value < 0 ? `-${formatted}` : formatted;
}

// Format percentage
//
// `compact` exists because ROI is not a small-range percent here: the all-time window
// runs to 2,641,203.9% (12 of 50 rows above 1000%), and the leaderboard's ROI column is
// locked to 96px — 64px of content, where seven tabular characters is the measured
// maximum, and the full string rendered 94px and spilled into the Volume cell. The
// three tiers below all fit in seven characters including a sign; `decimals` does not
// apply to them, because each tier sets the precision its width can afford. Call sites
// that compact a value put the uncompacted one in a `title` so nothing is lost.
export function formatPercent(
  value: number,
  options: {
    showSign?: boolean;
    decimals?: number;
    compact?: boolean;
  } = {}
): string {
  const { showSign = false, decimals = 1, compact = false } = options;
  const sign = showSign && value > 0 ? "+" : "";
  if (!compact) return `${sign}${value.toFixed(decimals)}%`;

  const absValue = Math.abs(value);
  const rounded = Math.round(absValue);
  let body: string;
  if (Number(absValue.toFixed(1)) < 1000) {
    body = absValue.toFixed(1);
  } else if (rounded < 100_000) {
    // No grouping separator: one unit, one glyph budget, and a comma buys nothing at
    // five digits in a tabular column.
    body = String(rounded);
  } else {
    // Three significant digits, which is the convention crypto trackers use for
    // runaway percentage moves: 114k%, 2.64M%. The bands are stated on the rounded
    // value — 99.9996 rounds to 100 at one decimal, which is a four-glyph mantissa,
    // so it belongs in the zero-decimal band and prints "100k%", not "100.0k%".
    body = scaleCompact(absValue, PERCENT_UNITS, (scaled) =>
      scaled >= 99.95 ? 0 : scaled >= 9.995 ? 1 : 2
    );
  }
  return `${value < 0 ? "-" : sign}${body}%`;
}

/**
 * Tone for a signed quantity.
 *
 * Replaces getPnLColorClass, which hardcoded text-green-500 / text-red-500 —
 * measured at 2.07:1 and 3.42:1 on the light card, i.e. both fail WCAG AA, and
 * both carried the sign by HUE ALONE, so gain vs loss was invisible to a
 * colour-blind reader. These tokens are theme-aware and measured (see --gain /
 * --loss in globals.css).
 *
 * Worth knowing why this is understated: across the live top 50, every row is
 * PnL-positive AND ROI-positive in all four windows. A red/green heat language
 * would therefore paint 200 identical cells and carry exactly zero information.
 * So tone is correctness hygiene, never the visual engine — and `signGlyph`
 * below means the sign never depends on colour at all.
 */
export function toneClass(value: number): string {
  if (value > 0) return "text-[var(--gain)]";
  if (value < 0) return "text-[var(--loss)]";
  return "text-muted";
}

/** A non-chromatic carrier for direction, so hue is never the only cue. */
export function signGlyph(value: number): string {
  if (value > 0) return "▲";
  if (value < 0) return "▼";
  return "·";
}
