import Image from "next/image";
import { ExternalLink } from "lucide-react";
import Chapter, { type ChapterEntry } from "./chapter/Chapter";
import { EXPERIENCE, EXPERIENCE_LAYOUT } from "../lib/content/experience";
import { yearsFor } from "../lib/yearWheel";

// 02 Experience — a reading chapter (DESIGN §4.3), pinned by default (OC-P). Each role is one entry and one
// beat: its head row (numeral, logo, company, job title, the company link) and its line (dates · location, then
// the stack where the data has one). The collapsible cards, their chevrons and the ±60 px scroll zigzag are gone
// (OC-F; the zigzag was the last template motion on the site); the job title moves from the accent to the
// foreground, because inside a chapter the accent belongs to the active entry alone. A server component: the
// list is complete HTML before any JavaScript, and the page's ChapterDirector lights it.

const entries: ChapterEntry[] = EXPERIENCE.map((role) => ({
  key: role.company,
  head: (
    <>
      {role.logo && (
        <span className="ch-logo">
          <Image src={role.logo} alt={`${role.company} logo`} width={28} height={28} />
        </span>
      )}
      <div className="ch-head-text">
        <h3 className="ch-name">{role.company}</h3>
        <span className="ch-role">{role.title}</span>
      </div>
      {role.companyUrl && (
        <a
          href={role.companyUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Visit ${role.company}`}
          className="ch-link"
        >
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
    </>
  ),
  lines: [
    <>
      <span className="ch-line">
        {role.period} · {role.location}
      </span>
      {role.technologies.length > 0 && <span className="ch-stack">{role.technologies.join(" · ")}</span>}
    </>,
  ],
}));

export default function Experience() {
  return (
    <Chapter
      id="experience"
      title="Experience"
      layout={EXPERIENCE_LAYOUT}
      years={yearsFor(EXPERIENCE.map((r) => r.period))}
      entries={entries}
    />
  );
}
