"use client";

import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { useRef, useState } from "react";
import { MapPin, Calendar, ChevronDown, ExternalLink } from "lucide-react";
import Image from "next/image";
import { numberOf } from "./sections";

interface Experience {
  title: string;
  company: string;
  companyUrl?: string;
  logo?: string;
  period: string;
  location: string;
  description: string[];
  technologies: string[];
}

const experiences: Experience[] = [
  {
    title: "Engineering Lead",
    company: "Mercor",
    companyUrl: "https://www.mercor.com/",
    logo: "/images/profile/mercor_logo.png",
    period: "Mar 2026 - Present",
    location: "San Francisco, CA",
    description: [
      "Applied AI Team",
    ],
    technologies: [],
  },
  {
    title: "Data Engineer",
    company: "Meta",
    companyUrl: "https://www.meta.com/",
    logo: "/images/profile/meta_logo.jpeg",
    period: "May 2024 - Mar 2026",
    location: "New York City, NY",
    description: [],
    technologies: ["Python", "SQL", "Java", "PHP", "Spark", "Presto"],
  },
  {
    title: "Software Engineer",
    company: "Cherre",
    companyUrl: "https://cherre.com/",
    logo: "/images/profile/cherre_logo.jpeg",
    period: "Nov 2022 - May 2024",
    location: "New York City, NY",
    description: [],
    technologies: ["Python", "SQL", "PyTorch", "Postgres", "BigQuery", "Airflow", "dbt", "AWS", "GCP", "Docker", "Kubernetes"],
  },
  {
    title: "Software Engineer",
    company: "Mashey",
    companyUrl: "https://www.analytics8.com/blog/analytics8-acquires-mashey-investing-more-in-the-future-of-data-and-analytics-consulting/",
    logo: "/images/profile/mashey_logo.jpeg",
    period: "Oct 2021 - Nov 2022",
    location: "Remote",
    description: [],
    technologies: ["Python", "SQL", "PyTorch", "Postgres", "BigQuery", "Airflow", "dbt", "AWS", "GCP", "Docker", "Kubernetes"],
  },
  {
    title: "Machine Learning Engineer",
    company: "Jefferson Street Technologies",
    companyUrl: "https://www.jeffersonst.io/",
    logo: "/images/profile/jefferson_street_technologies_logo.jpeg",
    period: "May 2020 - Oct 2021",
    location: "Remote",
    description: [],
    technologies: ["Python", "SQL", "TensorFlow", "PyTorch", "RAG"],
  },
];

function ExperienceCard({
  experience,
  index,
  isExpanded,
  onToggle,
}: {
  experience: Experience;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const cardRef = useRef(null);
  const panelId = `experience-panel-${index}`;
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
    <div className="relative">
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
          {index < experiences.length - 1 && (
            /* h-full resolves against the card ROW, so with top-3 (12px) the rail
               stopped 28px short of the next dot — a visible break in every gap.
               +1.75rem spans the remainder of the md:space-y-10 (40px) gap. */
            <div className="w-0.5 h-[calc(100%+1.75rem)] bg-border absolute top-3 left-[5px]" />
          )}
        </div>

        {/* Card content — the scroll-driven entrance lives on the card ITSELF so no
            ancestor becomes a backdrop root that would blank out the glass blur. */}
        <motion.div
          ref={cardRef}
          style={{ opacity, x, scale }}
          className="flex-1 glass card-lift group pointer-events-auto hover:border-muted/60"
        >
          {/* The company link is a SIBLING of the toggle, not the <h3> inside it: that <h3>
              carried a bare onClick + window.open, so the only way to reach the company site
              was a mouse — Tab landed on the button and nothing announced a link at all
              (WCAG 2.1.1). Anchored to the header so it stays put when the card expands. */}
          <div className="relative">
            {/* Clickable header. The focus ring is drawn INSIDE: .glass is overflow:hidden
                and this button's border box IS the clip rectangle, so the global
                `outline-offset: 2px` ring fell entirely outside it and was never visible
                (WCAG 2.4.7). That now lives in globals.css as .glass-inset-focus, where
                specificity beats the unlayered `*:focus-visible` on its own — here it
                took two arbitrary-value utilities each with a load-bearing `!`, which is
                a cascade fight spelled out on an element. */}
            <button
              onClick={onToggle}
              aria-expanded={isExpanded}
              // Only while the panel is in the DOM. AnimatePresence unmounts it on
              // collapse, so a permanent aria-controls named an element that was not
              // there for all but one of the five cards — an idref a screen reader
              // offers to jump to and then cannot find.
              aria-controls={isExpanded ? panelId : undefined}
              className="glass-inset-focus w-full text-left p-6 md:p-8"
            >
              <div className="flex items-center gap-4 mb-3">
                {experience.logo && (
                  <div className="flex-shrink-0 w-12 h-12 bg-white rounded-[18px] overflow-hidden">
                    <Image
                      src={experience.logo}
                      alt={`${experience.company} logo`}
                      width={48}
                      height={48}
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {/* No group-hover:text-accent. --accent IS the link colour on this
                      page — the company's own link is the sibling anchor anchored to
                      this header — so tinting the heading on card hover offered a link
                      that is not there, while the actual link a few pixels away gets no
                      hover of its own from the card. What this control does is expand
                      the card, which the chevron and the card lift already say. */}
                  <h3 className="text-xl md:text-2xl font-semibold text-foreground">
                    {experience.company}
                  </h3>
                  <p className="text-accent font-medium">{experience.title}</p>
                </div>
                <ChevronDown
                  size={20}
                  className={`text-muted flex-shrink-0 transition-transform duration-300 ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-4 pr-10 text-xs sm:text-sm text-muted">
                <span className="flex items-center gap-1 sm:gap-1.5">
                  <Calendar size={12} className="sm:w-3.5 sm:h-3.5 text-muted" />
                  {experience.period}
                </span>
                <span className="flex items-center gap-1 sm:gap-1.5">
                  <MapPin size={12} className="sm:w-3.5 sm:h-3.5 text-muted" />
                  {experience.location}
                </span>
              </div>
            </button>

            {experience.companyUrl && (
              <a
                href={experience.companyUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Visit ${experience.company}`}
                className="absolute bottom-4 right-4 md:bottom-6 md:right-6 p-2 text-muted transition-colors hover:text-accent"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>

          {/* Expandable content */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                id={panelId}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="px-6 md:px-8 pb-6 md:pb-8">
                  <ul className="space-y-2 mb-6">
                    {experience.description.map((item, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="text-muted leading-relaxed pl-4 border-l border-border"
                      >
                        {item}
                      </motion.li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap gap-2">
                    {experience.technologies.map((tech, i) => (
                      <motion.span
                        key={tech}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.1 + i * 0.03 }}
                        className="px-3 py-1 text-xs font-medium bg-muted/20 text-foreground rounded-full"
                      >
                        {tech}
                      </motion.span>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

export default function Experience() {
  const containerRef = useRef(null);
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(
    new Set() // Start with all collapsed
  );

  const toggleJob = (index: number) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <section id="experience" aria-label="Experience" className="py-20 md:py-24 px-6 relative z-20 pointer-events-none">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-xs tracking-[0.25em] text-muted">{numberOf("experience")}</span>
            <span className="h-px w-12 bg-border" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight heading-legible">Experience</h2>
        </motion.div>

        <div ref={containerRef} className="space-y-8 md:space-y-10">
          {experiences.map((experience, index) => (
            <ExperienceCard
              key={index}
              experience={experience}
              index={index}
              isExpanded={expandedJobs.has(index)}
              onToggle={() => toggleJob(index)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
