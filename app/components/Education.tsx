import Image from "next/image";
import Chapter, { type ChapterEntry } from "./chapter/Chapter";
import { EDUCATION, EDUCATION_LAYOUT } from "../lib/content/education";

// 03 Education — a reading chapter (DESIGN §4.4), in FLOW by default (OC-P: the page reads pinned → flowing →
// pinned; `?pin=edu` on a review build pins it). Each school is one entry and one beat: its head row (numeral,
// logo, the school's name as its link, and its location beside it, linked) and its line (each degree — type and
// field, the field linked). No dates anywhere and no year wheel: the owner, 2026-09-25 — "put the location next to
// the school name and get rid of the years as it will expose my age". The highlight chips are gone with every other
// detail line (2026-09-24), and so is the ±60 px zigzag. A server component; the ChapterDirector lights it.

const entries: ChapterEntry[] = EDUCATION.map((school) => ({
  key: school.name,
  head: (
    <>
      {school.logo && (
        <span className="ch-logo">
          <Image src={school.logo} alt={`${school.name} logo`} width={28} height={28} />
        </span>
      )}
      <div className="ch-head-text">
        <h3 className="ch-name">
          {school.url ? (
            <a href={school.url} target="_blank" rel="noopener noreferrer" className="ch-text-link">
              {school.name}
            </a>
          ) : (
            school.name
          )}
        </h3>
        {/* the place beside the name, as a role sits beside its company in Experience */}
        <span className="ch-role ch-nowrap">
          {school.locationLink ? (
            <a href={school.locationLink} target="_blank" rel="noopener noreferrer" className="ch-text-link">
              {school.location}
            </a>
          ) : (
            school.location
          )}
        </span>
      </div>
    </>
  ),
  lines: [
    <>
      {school.degrees.map((degree, k) => (
        <span key={k} className="ch-degree ch-line">
          <span className="ch-line ch-line-strong">
            {degree.degreeType} in{" "}
            {degree.fieldLink ? (
              <a href={degree.fieldLink} target="_blank" rel="noopener noreferrer" className="ch-text-link">
                {degree.field}
              </a>
            ) : (
              degree.field
            )}
          </span>
        </span>
      ))}
    </>,
  ],
}));

export default function Education() {
  // No year wheel: Education shows no dates (the owner, 2026-09-25), so the chapter gets no `years` at all.
  return <Chapter id="education" title="Education" layout={EDUCATION_LAYOUT} entries={entries} />;
}
