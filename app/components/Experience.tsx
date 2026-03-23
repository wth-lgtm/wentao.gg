"use client";

import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { useRef, useState } from "react";
import { MapPin, Calendar, ChevronDown } from "lucide-react";
import Image from "next/image";

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
    title: "Software Engineer",
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
    title: "Data Engineer",
    company: "Cherre",
    companyUrl: "https://cherre.com/",
    logo: "/images/profile/cherre_logo.jpeg",
    period: "Nov 2022 - May 2024",
    location: "New York City, NY",
    description: [],
    technologies: ["Python", "SQL", "PyTorch", "Postgres", "BigQuery", "Airflow", "dbt", "AWS", "GCP", "Docker", "Kubernetes"],
  },
  {
    title: "Data Engineer",
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
          {index < experiences.length - 1 && (
            <div className="w-0.5 h-full bg-border absolute top-3 left-[5px]" />
          )}
        </div>

        {/* Card content */}
        <div className="flex-1 bg-white/5 backdrop-blur-lg hover:bg-white/10 rounded-xl transition-all duration-300 border border-white/10 hover:border-white/20 hover:card-shadow group pointer-events-auto overflow-hidden">
          {/* Clickable header */}
          <button
            onClick={onToggle}
            className="w-full text-left p-6 md:p-8"
          >
            <div className="flex items-center gap-4 mb-3">
              {experience.logo && (
                <div className="flex-shrink-0 w-12 h-12 bg-white">
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
                <h3
                  className={`text-xl md:text-2xl font-semibold text-foreground group-hover:text-accent transition-colors ${experience.companyUrl ? "hover:underline cursor-pointer" : ""}`}
                  onClick={experience.companyUrl ? (e) => { e.stopPropagation(); window.open(experience.companyUrl, "_blank", "noopener,noreferrer"); } : undefined}
                >
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

            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted">
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

          {/* Expandable content */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
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
        </div>
      </div>
    </motion.div>
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
    <section id="experience" className="py-24 px-6 relative z-20 pointer-events-none">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 tracking-tight">Experience</h2>
          <div className="w-16 h-1 bg-accent" />
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
