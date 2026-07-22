"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { MapPin, Calendar } from "lucide-react";
import Image from "next/image";

interface Degree {
  degreeType: string;
  field: string;
  fieldLink?: string;
  period: string;
  location: string;
  locationLink?: string;
}

interface Highlight {
  text: string;
  link?: string;
}

interface School {
  name: string;
  url?: string;
  logo?: string;
  degrees: Degree[];
  highlights?: Highlight[];
}

const education: School[] = [
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
    highlights: [{ text: "Research @ Perelman School of Medicine" }],
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
    highlights: [
      { text: "Research @ Experimental Biomechatronics Lab" },
      { text: "🏎️ Carnegie Mellon Racing", link: "https://www.carnegiemellonracing.org/" },
    ],
  },
];

function EducationCard({
  school,
  index,
}: {
  school: School;
  index: number;
}) {
  const cardRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: cardRef,
    offset: ["start end", "center center"],
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 1]);
  const x = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [index % 2 === 0 ? -60 : 60, 0, 0]
  );
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1, 1]);

  return (
    <motion.div
      ref={cardRef}
      style={{ opacity, x, scale }}
      className="relative"
    >
      <div className="flex items-start gap-6">
        {/* Timeline dot and line */}
        <div className="hidden md:flex flex-col items-center">
          <motion.div
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="w-3 h-3 bg-accent rounded-full z-10"
          />
          {index < education.length - 1 && (
            <div className="w-0.5 h-full bg-border absolute top-3 left-[5px]" />
          )}
        </div>

        {/* Card content */}
        <div className="flex-1 bg-card/60 backdrop-blur-lg hover:bg-card-hover rounded-xl p-6 md:p-8 transition-all duration-300 border border-border hover:border-muted/60 hover:card-shadow group pointer-events-auto">
          <div className="flex items-center gap-4 mb-4">
            {school.logo && (
              <div className="flex-shrink-0 w-12 h-12 bg-white">
                <Image
                  src={school.logo}
                  alt={`${school.name} logo`}
                  width={48}
                  height={48}
                  className="w-full h-full object-contain"
                />
              </div>
            )}
            <h3 className="text-xl md:text-2xl font-semibold text-foreground group-hover:text-accent transition-colors">
              {school.url ? (
                <a href={school.url} target="_blank" rel="noopener noreferrer" className="transition-all duration-300 hover:text-accent hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]">
                  {school.name}
                </a>
              ) : (
                school.name
              )}
            </h3>
          </div>

          <div className="space-y-4">
            {school.degrees.map((degree, degreeIndex) => (
              <div
                key={degreeIndex}
                className="pl-4 border-l border-border"
              >
                <p className="font-medium mb-2">
                  <span className="text-accent">{degree.degreeType}</span>
                  <span className="text-foreground"> in {degree.fieldLink ? (
                    <a href={degree.fieldLink} target="_blank" rel="noopener noreferrer" className="transition-all duration-300 hover:text-accent hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]">
                      {degree.field}
                    </a>
                  ) : (
                    degree.field
                  )}</span>
                </p>
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
                  <span className="flex items-center gap-1.5">
                    <Calendar size={14} className="text-muted" />
                    {degree.period}
                  </span>
                  {degree.locationLink ? (
                    <a href={degree.locationLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 transition-all duration-300 hover:text-accent hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]">
                      <MapPin size={14} className="text-muted" />
                      {degree.location}
                    </a>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <MapPin size={14} className="text-muted" />
                      {degree.location}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {school.highlights && school.highlights.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-border">
              {school.highlights.map((highlight) =>
                highlight.link ? (
                  <a
                    key={highlight.text}
                    href={highlight.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 text-xs font-medium bg-muted/20 text-foreground rounded-full hover:bg-muted/30 transition-colors pointer-events-auto"
                  >
                    {highlight.text}
                  </a>
                ) : (
                  <span
                    key={highlight.text}
                    className="px-3 py-1 text-xs font-medium bg-muted/20 text-foreground rounded-full"
                  >
                    {highlight.text}
                  </span>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function Education() {
  return (
    <section id="education" className="py-24 px-6 relative z-20 pointer-events-none">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 tracking-tight">Education</h2>
          <div className="w-16 h-1 bg-accent" />
        </motion.div>

        <div className="space-y-8 md:space-y-10">
          {education.map((school, index) => (
            <EducationCard key={school.name} school={school} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
