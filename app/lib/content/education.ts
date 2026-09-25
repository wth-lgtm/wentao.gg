// 03 Education, as data (moved out of Education.tsx, every string byte-identical to f4b738f; tests/content.test.ts
// holds them). Each school is listed as its name, its degrees (type and field), their dates and their location.
// The old card's highlight chips (research labs, the racing team) were detail lines, and the owner's call of
// 2026-09-24 removes every detailed bullet from the site ("the detailed bullet points are going to be reflected
// on my actual PDF resume, not on here"); they stay in git history. Nothing here is invented.

import type { ChapterLayout } from "../chapterList";

export interface Degree {
  degreeType: string;
  field: string;
  fieldLink?: string;
  period: string;
  location: string;
  locationLink?: string;
}

export interface School {
  name: string;
  url?: string;
  logo?: string;
  degrees: readonly Degree[];
}

export const EDUCATION: readonly School[] = [
  {
    name: "University of Pennsylvania",
    url: "https://www.upenn.edu",
    logo: "/images/profile/University-of-Pennsylvania-Logo-PNG7.png",
    degrees: [
      {
        degreeType: "Master of Science",
        field: "Robotics (Artificial Intelligence)",
        fieldLink: "https://www.grasp.upenn.edu/",
        period: "May 2020",
        location: "Philadelphia, PA",
        locationLink: "https://maps.app.goo.gl/YnvqcgUp48qooJoj9",
      },
    ],
  },
  {
    name: "Carnegie Mellon University",
    url: "https://www.cmu.edu",
    logo: "/images/profile/cmu-wordmark-square-w-on-r.png",
    degrees: [
      {
        degreeType: "Master of Science",
        field: "Mechanical Engineering",
        fieldLink: "https://www.meche.engineering.cmu.edu/",
        period: "Dec 2017",
        location: "Pittsburgh, PA",
        locationLink: "https://maps.app.goo.gl/YTjegkLknQ6pWHwa6",
      },
      {
        degreeType: "Bachelor of Science",
        field: "Mechanical Engineering",
        fieldLink: "https://www.meche.engineering.cmu.edu/",
        period: "May 2017",
        location: "Pittsburgh, PA",
        locationLink: "https://maps.app.goo.gl/YTjegkLknQ6pWHwa6",
      },
    ],
  },
];

/** One beat per school: the chapter lights entry by entry (derived, never typed by hand). */
export const EDUCATION_LAYOUT: ChapterLayout = EDUCATION.map(() => 1);
