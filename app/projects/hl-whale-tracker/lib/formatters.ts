// Format address for display (truncated)
export function formatAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
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
    if (absValue >= 1_000_000) {
      formatted = `$${(absValue / 1_000_000).toFixed(decimals)}M`;
    } else if (absValue >= 1_000) {
      formatted = `$${(absValue / 1_000).toFixed(decimals)}K`;
    } else {
      formatted = `$${absValue.toFixed(decimals)}`;
    }
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
export function formatPercent(
  value: number,
  options: {
    showSign?: boolean;
    decimals?: number;
  } = {}
): string {
  const { showSign = false, decimals = 1 } = options;
  const sign = showSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
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
