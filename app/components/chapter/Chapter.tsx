import type { CSSProperties, ReactNode } from "react";
import { PIN_CHAPTERS, beatOf, chapterVh, type ChapterLayout } from "../../lib/chapterList";
import { numberOf, type SectionId } from "../sections";
import YearWheel from "./YearWheel";

// A reading chapter (DESIGN §4.2): the owner's highlighted list — "a highlighted bullet point list animation
// like you implemented on augnition's website". A SERVER component: the list is real, complete HTML before any
// JavaScript, in DOM order, and identical in every mode; the one client island is the page's ChapterDirector,
// which writes data-mode (pinned | flow | static) and, while the chapter is engaged, data-active on one entry and
// its line. Nothing here is conditional on the mode: the rail, the dots and the readout are always rendered and
// app/chapter.css shows or hides their decoration per data-mode (a post-hydration DOM change would be a layout
// shift). There is no sticky year chip on phones (DESIGN §4.2.9 had one): at every phone size it floated over
// the list's rows and link icons as they scrolled under it (at 844 × 390 it covered Mercor's link), and the
// owner's call is that nothing overlaps; each entry's dates line already carries its year.
//
// The pinned height (--chapter-vh, in svh) is written inline from the data, so the first paint never shifts.
// data-pin-default marks a chapter in the pin set (OC-P: Experience yes, Education no), which is all the
// first-paint CSS needs; the director decides the rest from the live window.
//
// When every entry is one beat (the owner's no-bullets call: Experience and Education), data-grain="entry" draws
// ONE mark per entry — one tint around the head and its line, one full-height bar — as Augnition's facts panel
// lights one row; a chapter with line beats (Projects, PR 2) keeps the head-plus-line marks.
//
// Screen readers get the content, not the theatre: one <ol> under <section aria-labelledby>, h2 → h3; the
// visible "01" numerals are aria-hidden (an item is not announced twice); the rail, dots and readout are
// aria-hidden and inert; there is no aria-current and no aria-live — data-active is presentational.

export interface ChapterEntry {
  key: string;
  /** the head row after the numeral: logo, name, role, link */
  head: ReactNode;
  /** the entry's line rows, one per beat (Experience and Education: one) */
  lines: readonly ReactNode[];
}

export default function Chapter({
  id,
  title,
  layout,
  years,
  entries,
}: {
  id: SectionId;
  title: string;
  layout: ChapterLayout;
  years: readonly number[];
  entries: readonly ChapterEntry[];
}) {
  const pinDefault = PIN_CHAPTERS[id] === true;
  // every entry one beat (Experience, Education): one mark per entry (app/chapter.css, data-grain="entry")
  const entryGrain = layout.every((n) => n === 1);
  const style = { "--chapter-vh": chapterVh(layout) } as CSSProperties;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="chapter"
      data-chapter={id}
      data-layout={layout.join(",")}
      data-grain={entryGrain ? "entry" : undefined}
      data-pin-default={pinDefault ? "" : undefined}
      style={style}
    >
      <div className="ch-stage">
        <div className="ch-grid">
          <div className="ch-dial">
            <p className="ch-folio">
              <span>{numberOf(id)}</span>
              <span className="ch-folio-rule" />
            </p>
            <h2 id={`${id}-title`} className="ch-title heading-legible">
              <span className="ch-title-text">{title}</span>
            </h2>
            <YearWheel years={years} className="ch-readout" />
          </div>
          <div className="ch-panel glass">
            <div className="ch-body">
              <div className="ch-rail" aria-hidden="true" inert>
                <span className="ch-rail-track" />
                <span className="ch-rail-fill" />
                <span className="ch-rail-sticky">
                  <span className="ch-rail-cover" />
                </span>
              </div>
              <ol className="ch-list">
                {entries.map((entry, i) => (
                  <li key={entry.key} className="ch-item" data-item={i}>
                    <div className="ch-head">
                      <span className="ch-dot" aria-hidden="true" />
                      <span className="ch-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                      {entry.head}
                    </div>
                    {entry.lines.map((line, s) => (
                      <div key={s} className="ch-sub" data-sub={s} data-beat={beatOf(i, s, layout)}>
                        <span className="ch-tick" aria-hidden="true" />
                        {line}
                      </div>
                    ))}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
