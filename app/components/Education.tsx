import Image from "next/image";
import Chapter, { type ChapterEntry } from "./chapter/Chapter";
import { EDUCATION, EDUCATION_LAYOUT } from "../lib/content/education";
import { yearsFor } from "../lib/yearWheel";

// 03 Education — a reading chapter (DESIGN §4.4), in FLOW by default (OC-P: the page reads pinned → flowing →
// pinned; `?pin=edu` on a review build pins it). Each school is one entry and one beat: its head row (numeral,
// logo, the school's name as its link) and its line (each degree — type and field, the field linked — with its
// date and location, the location linked). The highlight chips are gone with every other detail line (the
// owner's call, 2026-09-24), and so is the ±60 px zigzag. A server component; the ChapterDirector lights it.

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
          <span className="ch-line">
            {degree.period} ·{" "}
            {degree.locationLink ? (
              <a href={degree.locationLink} target="_blank" rel="noopener noreferrer" className="ch-text-link">
                {degree.location}
              </a>
            ) : (
              degree.location
            )}
          </span>
        </span>
      ))}
    </>,
  ],
}));

export default function Education() {
  return (
    <Chapter
      id="education"
      title="Education"
      layout={EDUCATION_LAYOUT}
      years={yearsFor(EDUCATION.map((s) => s.degrees[0].period))}
      entries={entries}
    />
  );
}
