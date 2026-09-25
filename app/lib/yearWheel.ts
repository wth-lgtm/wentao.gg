// The year wheel's years (DESIGN §4.2.5), derived from each entry's own data — the first four-digit year of its
// period — never typed by hand (tests/year-wheel.test.ts). The wheel paints them as generated content
// (`<span data-y="2024">` + `::before { content: attr(data-y) }`), so find-in-page never lands on a digit the
// list does not print, and the wheel is aria-hidden and inert besides.

/** the first four-digit year in a period string ("May 2024 - Mar 2026" → 2024), or null */
export function yearOf(period: string): number | null {
  const m = /\b(\d{4})\b/.exec(period);
  return m ? Number(m[1]) : null;
}

/** one year per entry, in list order; an entry without a year repeats its predecessor's (none here) */
export function yearsFor(periods: readonly string[]): number[] {
  const out: number[] = [];
  for (const p of periods) out.push(yearOf(p) ?? out[out.length - 1] ?? 0);
  return out;
}

/** the static readout's full range, first to last ("2026–2020") */
export function yearRange(years: readonly number[]): string {
  if (years.length === 0) return "";
  const a = years[0], b = years[years.length - 1];
  return a === b ? String(a) : `${a}–${b}`;
}
