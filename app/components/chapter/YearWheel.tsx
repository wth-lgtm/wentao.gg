import { yearRange } from "../../lib/yearWheel";

// The readout (DESIGN §4.2.5): a one-cell window over a strip of years, rolled by the section's --active-item
// on the beat — no React, no rAF. Each digit is GENERATED content (`data-y` + `::before { content: attr(data-y) }`,
// app/chapter.css), so find-in-page cannot hit a year the list does not print; the wheel is aria-hidden and
// inert as well (O9, E11). The static still shows the full range instead ("2026–2020").

export default function YearWheel({ years, className = "" }: { years: readonly number[]; className?: string }) {
  return (
    <span className={`yw ${className}`.trim()} aria-hidden="true" inert>
      <span className="yw-window">
        <span className="yw-strip">
          {years.map((y, i) => (
            <span key={i} className="yw-cell" data-y={String(y)} />
          ))}
        </span>
      </span>
      <span className="yw-range" data-y={yearRange(years)} />
    </span>
  );
}
