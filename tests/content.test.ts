import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { EXPERIENCE, EXPERIENCE_LAYOUT } from "../app/lib/content/experience";
import { EDUCATION, EDUCATION_LAYOUT } from "../app/lib/content/education";
import { beatCount, chapterVh } from "../app/lib/chapterList";

// The strings as they stood at f4b738f (app/components/Experience.tsx and Education.tsx before the chapters),
// minus the detail lines the owner removed on 2026-09-24 ("We just need to list the individual experiences and
// job titles"). Copied once, by hand, from `git show f4b738f:app/components/Experience.tsx` — the data modules
// must match them byte for byte, so the implementer can neither retype nor invent a row.
const BASE_ROLES = [
  { title: "Engineering Lead", company: "Mercor", companyUrl: "https://www.mercor.com/", logo: "/images/profile/mercor_logo.png", period: "Mar 2026 - Present", location: "San Francisco, CA", technologies: [] },
  { title: "Data Engineer", company: "Meta", companyUrl: "https://www.meta.com/", logo: "/images/profile/meta_logo.jpeg", period: "May 2024 - Mar 2026", location: "New York City, NY", technologies: ["Python", "SQL", "Java", "PHP", "Spark", "Presto"] },
  { title: "Software Engineer", company: "Cherre", companyUrl: "https://cherre.com/", logo: "/images/profile/cherre_logo.jpeg", period: "Nov 2022 - May 2024", location: "New York City, NY", technologies: ["Python", "SQL", "PyTorch", "Postgres", "BigQuery", "Airflow", "dbt", "AWS", "GCP", "Docker", "Kubernetes"] },
  { title: "Software Engineer", company: "Mashey", companyUrl: "https://www.analytics8.com/blog/analytics8-acquires-mashey-investing-more-in-the-future-of-data-and-analytics-consulting/", logo: "/images/profile/mashey_logo.jpeg", period: "Oct 2021 - Nov 2022", location: "Remote", technologies: ["Python", "SQL", "PyTorch", "Postgres", "BigQuery", "Airflow", "dbt", "AWS", "GCP", "Docker", "Kubernetes"] },
  { title: "Machine Learning Engineer", company: "Jefferson Street Technologies", companyUrl: "https://www.jeffersonst.io/", logo: "/images/profile/jefferson_street_technologies_logo.jpeg", period: "May 2020 - Oct 2021", location: "Remote", technologies: ["Python", "SQL", "TensorFlow", "PyTorch", "RAG"] },
];

const BASE_SCHOOLS = [
  {
    name: "University of Pennsylvania", url: "https://www.upenn.edu", logo: "/images/profile/University-of-Pennsylvania-Logo-PNG7.png",
    degrees: [{ degreeType: "Master of Science", field: "Robotics (Artificial Intelligence)", fieldLink: "https://www.grasp.upenn.edu/", period: "May 2020", location: "Philadelphia, PA", locationLink: "https://maps.app.goo.gl/YnvqcgUp48qooJoj9" }],
  },
  {
    name: "Carnegie Mellon University", url: "https://www.cmu.edu", logo: "/images/profile/cmu-wordmark-square-w-on-r.png",
    degrees: [
      { degreeType: "Master of Science", field: "Mechanical Engineering", fieldLink: "https://www.meche.engineering.cmu.edu/", period: "Dec 2017", location: "Pittsburgh, PA", locationLink: "https://maps.app.goo.gl/YTjegkLknQ6pWHwa6" },
      { degreeType: "Bachelor of Science", field: "Mechanical Engineering", fieldLink: "https://www.meche.engineering.cmu.edu/", period: "May 2017", location: "Pittsburgh, PA", locationLink: "https://maps.app.goo.gl/YTjegkLknQ6pWHwa6" },
    ],
  },
];

// Dates show years only (the owner, 2026-09-25: "get rid of the month too"): the expected strings are the base's
// with the month names taken out, so a year can never be retyped wrong either.
const yearsOnly = (period: string) => period.replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? /g, "");

test("years only: the month names come out and nothing else changes", () => {
  assert.equal(yearsOnly("May 2024 - Mar 2026"), "2024 - 2026");
  assert.equal(yearsOnly("Mar 2026 - Present"), "2026 - Present");
  assert.equal(yearsOnly("Dec 2017"), "2017");
});

test("Experience: every company, job title, date (years only), location, link and stack string equals f4b738f's, in order", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(EXPERIENCE)), BASE_ROLES.map((r) => ({ ...r, period: yearsOnly(r.period) })));
  for (const r of EXPERIENCE) assert.match(r.period, /^\d{4}( - (\d{4}|Present))?$/, `${r.company}: ${r.period}`);
});

test("Education: every school, degree, field, date (years only), location and link string equals f4b738f's, in order", () => {
  const expected = BASE_SCHOOLS.map((s) => ({ ...s, degrees: s.degrees.map((d) => ({ ...d, period: yearsOnly(d.period) })) }));
  assert.deepEqual(JSON.parse(JSON.stringify(EDUCATION)), expected);
  for (const s of EDUCATION) for (const d of s.degrees) assert.match(d.period, /^\d{4}$/, `${s.name}: ${d.period}`);
});

test("no detailed bullets (owner, 2026-09-24): no role carries a description, no school a highlight — nothing invented, nothing kept", () => {
  for (const r of EXPERIENCE) assert.deepEqual(Object.keys(r).sort(), ["company", "companyUrl", "location", "logo", "period", "technologies", "title"]);
  for (const s of EDUCATION) assert.deepEqual(Object.keys(s).sort(), ["degrees", "logo", "name", "url"]);
  const root = path.join(import.meta.dirname, "..");
  for (const f of ["app/components/Experience.tsx", "app/components/Education.tsx", "app/lib/content/experience.ts", "app/lib/content/education.ts"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    for (const gone of ["Applied AI Team", "Perelman", "Biomechatronics", "Carnegie Mellon Racing", "description:", "highlights:"]) {
      assert.ok(!src.includes(gone), `${f} still carries "${gone}"`);
    }
  }
});

test("an Experience entry is its company, job title, dates and location (owner decision #2): the stack stays data, never rendered", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "app/components/Experience.tsx"), "utf8");
  assert.ok(!/role\.technologies/.test(src), "Experience.tsx renders role.technologies");
  assert.ok(!src.includes("ch-stack"), "Experience.tsx renders a stack line");
  for (const k of ["role.company", "role.title", "role.period", "role.location"]) assert.ok(src.includes(k), `Experience.tsx no longer renders ${k}`);
});

test("layouts are derived from the data: one beat per entry (5 roles, 2 schools); the pinned chapter heights follow", () => {
  assert.deepEqual([...EXPERIENCE_LAYOUT], [1, 1, 1, 1, 1]);
  assert.deepEqual([...EDUCATION_LAYOUT], [1, 1]);
  assert.equal(beatCount(EXPERIENCE_LAYOUT), EXPERIENCE.length);
  assert.equal(beatCount(EDUCATION_LAYOUT), EDUCATION.length);
  assert.equal(chapterVh(EXPERIENCE_LAYOUT), 180, "100 + 15 lead + 15 tail + 5 × 10");
  assert.equal(chapterVh(EDUCATION_LAYOUT), 150, "100 + 15 + 15 + 2 × 10 (only if pinned: ?pin=edu)");
});
