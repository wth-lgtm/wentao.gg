// 02 Experience, as data (moved out of Experience.tsx, every string byte-identical to f4b738f except that dates
// show years only — the owner, 2026-09-25: "get rid of the month too"; tests/content.test.ts derives them). The site lists each role as its company, its job title, its dates and its
// location, and nothing else: `technologies` stays here as data (the resume's stack line), but Experience.tsx
// does not render it. No detailed bullets: the owner, 2026-09-24 —
// "for the bullet points we can keep them empty for now. We just need to list the individual experiences and
// job titles because the detailed bullet points are going to be reflected on my actual PDF resume, not on
// here." The one description line the old card carried (Mercor's) is gone with the rest; it stays in git
// history. Nothing here is invented.

import type { ChapterLayout } from "../chapterList";

export interface Role {
  title: string;
  company: string;
  companyUrl?: string;
  logo?: string;
  period: string;
  location: string;
  technologies: readonly string[];
}

export const EXPERIENCE: readonly Role[] = [
  {
    title: "Engineering Lead",
    company: "Mercor",
    companyUrl: "https://www.mercor.com/",
    logo: "/images/profile/mercor_logo.png",
    period: "2026 - Present",
    location: "San Francisco, CA",
    technologies: [],
  },
  {
    title: "Data Engineer",
    company: "Meta",
    companyUrl: "https://www.meta.com/",
    logo: "/images/profile/meta_logo.jpeg",
    period: "2024 - 2026",
    location: "New York City, NY",
    technologies: ["Python", "SQL", "Java", "PHP", "Spark", "Presto"],
  },
  {
    title: "Software Engineer",
    company: "Cherre",
    companyUrl: "https://cherre.com/",
    logo: "/images/profile/cherre_logo.jpeg",
    period: "2022 - 2024",
    location: "New York City, NY",
    technologies: ["Python", "SQL", "PyTorch", "Postgres", "BigQuery", "Airflow", "dbt", "AWS", "GCP", "Docker", "Kubernetes"],
  },
  {
    title: "Software Engineer",
    company: "Mashey",
    companyUrl: "https://www.analytics8.com/blog/analytics8-acquires-mashey-investing-more-in-the-future-of-data-and-analytics-consulting/",
    logo: "/images/profile/mashey_logo.jpeg",
    period: "2021 - 2022",
    location: "Remote",
    technologies: ["Python", "SQL", "PyTorch", "Postgres", "BigQuery", "Airflow", "dbt", "AWS", "GCP", "Docker", "Kubernetes"],
  },
  {
    title: "Machine Learning Engineer",
    company: "Jefferson Street Technologies",
    companyUrl: "https://www.jeffersonst.io/",
    logo: "/images/profile/jefferson_street_technologies_logo.jpeg",
    period: "2020 - 2021",
    location: "Remote",
    technologies: ["Python", "SQL", "TensorFlow", "PyTorch", "RAG"],
  },
];

/** One beat per role: the chapter lights entry by entry (derived, never typed by hand). */
export const EXPERIENCE_LAYOUT: ChapterLayout = EXPERIENCE.map(() => 1);
