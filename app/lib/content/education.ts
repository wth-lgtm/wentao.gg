// 03 Education, as data (moved out of Education.tsx; every string byte-identical to f4b738f; tests/content.test.ts
// derives them). Each school is listed as its name, its location and its degrees (type and field), and nothing
// else. No dates: the owner, 2026-09-25 — "for education, let's put the location next to the school name and get
// rid of the years as it will expose my age". The years are not hidden but absent: they are in no string, prop or
// attribute the page ships (git history keeps them). The old card's highlight chips were detail lines, removed with
// every detailed bullet (the owner, 2026-09-24). Nothing here is invented.

import type { ChapterLayout } from "../chapterList";

export interface Degree {
  degreeType: string;
  field: string;
  fieldLink?: string;
}

export interface School {
  name: string;
  url?: string;
  logo?: string;
  location: string;
  locationLink?: string;
  degrees: readonly Degree[];
}

export const EDUCATION: readonly School[] = [
  {
    name: "University of Pennsylvania",
    url: "https://www.upenn.edu",
    logo: "/images/profile/University-of-Pennsylvania-Logo-PNG7.png",
    location: "Philadelphia, PA",
    locationLink: "https://maps.app.goo.gl/YnvqcgUp48qooJoj9",
    degrees: [
      {
        degreeType: "Master of Science",
        field: "Robotics (Artificial Intelligence)",
        fieldLink: "https://www.grasp.upenn.edu/",
      },
    ],
  },
  {
    name: "Carnegie Mellon University",
    url: "https://www.cmu.edu",
    logo: "/images/profile/cmu-wordmark-square-w-on-r.png",
    location: "Pittsburgh, PA",
    locationLink: "https://maps.app.goo.gl/YTjegkLknQ6pWHwa6",
    degrees: [
      {
        degreeType: "Master of Science",
        field: "Mechanical Engineering",
        fieldLink: "https://www.meche.engineering.cmu.edu/",
      },
      {
        degreeType: "Bachelor of Science",
        field: "Mechanical Engineering",
        fieldLink: "https://www.meche.engineering.cmu.edu/",
      },
    ],
  },
];

/** One beat per school: the chapter lights entry by entry (derived, never typed by hand). */
export const EDUCATION_LAYOUT: ChapterLayout = EDUCATION.map(() => 1);
