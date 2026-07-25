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

// Format number with commas
export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// Format Sharpe ratio
export function formatSharpe(value: number): string {
  if (value === 0) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

// Format relative time
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;

  return new Date(timestamp).toLocaleDateString();
}

// Get PnL color class
export function getPnLColorClass(value: number): string {
  if (value > 0) return "text-green-500";
  if (value < 0) return "text-red-500";
  return "text-muted";
}

// Get Sharpe color class
export function getSharpeColorClass(value: number): string {
  if (value >= 2) return "text-green-500";
  if (value >= 1) return "text-yellow-500";
  if (value > 0) return "text-muted";
  return "text-red-500";
}
