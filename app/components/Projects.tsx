"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Dumbbell, Video, TrendingUp, Folder, ChevronDown, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

interface Project {
  title: string;
  description: string;
  technologies: string[];
  href: string;
  icon: React.ElementType;
  logo?: string;
  comingSoon?: boolean;
}

interface ProjectCategory {
  name: string;
  icon: React.ElementType;
  projects: Project[];
}

const projectCategories: ProjectCategory[] = [
  {
    name: "₿",
    icon: TrendingUp,
    projects: [
      {
        title: "🐋 Tracker",
        description:
          "A Hyperliquid trader leaderboard tracking top whales by PnL, ROI, and volume. Live data from the Hyperliquid leaderboard API with sortable columns and time period filters.",
        technologies: ["Next.js", "TypeScript", "Tailwind", "Hyperliquid API"],
        href: "/projects/hl-whale-tracker",
        icon: TrendingUp,
        logo: "/images/icons/HL symbol_mint green.png",
      },
    ],
  },
  {
    name: "🏋️",
    icon: Dumbbell,
    projects: [
      {
        title: "PowerOPPS",
        description:
          "A powerlifting index calculator that computes performance scores across 5 standardized systems (IPF GL, DOTS, Wilks 2.0, IPF, Old Wilks) with reverse calculation for target planning.",
        technologies: ["Next.js", "TypeScript", "Tailwind", "Framer Motion"],
        href: "/projects/poweropps",
        icon: Dumbbell,
      },
      {
        title: "ProgDash",
        description:
          "A Google Sheets-powered training log that authenticates via Google OAuth, pulls your powerlifting program spreadsheet, and parses the cells into a clean, readable interface for tracking blocks, sets, and progression.",
        technologies: ["Next.js", "TypeScript", "Google OAuth", "Google Sheets API", "Tailwind"],
        href: "/projects/progdash",
        icon: FileSpreadsheet,
      },
      {
        title: "What's my RPE?",
        description:
          "A velocity-based training tool using pose estimation and optical flow to track barbell kinematics from video. Employs supervised learning on user-labeled lift data to predict RPE and estimate 1RM, with automatic lift classification for squat, bench, and deadlift.",
        technologies: ["PyTorch", "OpenCV", "MediaPipe", "FastAPI", "Next.js"],
        href: "/projects/whats-my-rpe",
        icon: Video,
        comingSoon: true,
      },
    ],
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 },
};

function ProjectCard({ project }: { project: Project }) {
  if (project.comingSoon) {
    return (
      <div className="group block bg-card/60 backdrop-blur-lg rounded-xl overflow-hidden border border-border border-dashed transition-all duration-300 h-full cursor-default pointer-events-auto opacity-70">
        <div className="relative h-36 sm:h-48 bg-background overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-muted/15 to-muted/5 flex items-center justify-center">
            <project.icon className="w-10 h-10 sm:w-12 sm:h-12 text-muted/50" />
          </div>
          <div className="absolute top-2 right-2 sm:top-3 sm:right-3 px-2 py-1 bg-muted/80 text-white text-xs font-medium rounded">
            Coming Soon
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <h3 className="text-lg sm:text-xl font-semibold mb-2 text-muted">
            {project.title}
          </h3>
          <p className="text-muted text-sm leading-relaxed mb-3 sm:mb-4">
            {project.description}
          </p>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {project.technologies.map((tech) => (
              <span
                key={tech}
                className="px-2 py-0.5 sm:py-1 text-xs font-medium bg-background text-muted rounded border border-border"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Link
      href={project.href}
      className="group block bg-card/60 backdrop-blur-lg rounded-xl overflow-hidden border border-border hover:border-muted/40 card-lift h-full pointer-events-auto"
    >
      <div className="relative h-36 sm:h-48 bg-background overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center">
          {project.logo ? (
            <Image
              src={project.logo}
              alt={`${project.title} logo`}
              width={64}
              height={64}
              className="w-12 h-12 sm:w-16 sm:h-16 object-contain opacity-60 group-hover:opacity-80 transition-opacity"
            />
          ) : (
            <project.icon className="w-10 h-10 sm:w-12 sm:h-12 text-accent/40 group-hover:text-accent/60 transition-colors" />
          )}
        </div>
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="p-2.5 sm:p-3 bg-accent rounded-full">
            <ExternalLink size={18} className="sm:w-5 sm:h-5 text-white" />
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <h3 className="text-lg sm:text-xl font-semibold mb-2 group-hover:text-accent transition-colors flex items-center gap-1.5">
          {project.logo && (
            <Image
              src={project.logo}
              alt=""
              width={22}
              height={22}
              className="w-4 h-4 sm:w-5 sm:h-5"
            />
          )}
          {project.title}
        </h3>
        <p className="text-muted text-sm leading-relaxed mb-3 sm:mb-4">
          {project.description}
        </p>
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          {project.technologies.map((tech) => (
            <span
              key={tech}
              className="px-2 py-0.5 sm:py-1 text-xs font-medium bg-background text-muted rounded border border-border"
            >
              {tech}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

function CategorySection({ category, isExpanded, onToggle }: {
  category: ProjectCategory;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      {/* Category Header - Clickable */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 sm:gap-3 mb-4 pointer-events-auto group w-full text-left"
      >
        <div className="p-2 sm:p-2.5 bg-accent/10 rounded-lg sm:rounded-xl border border-accent/20 group-hover:bg-accent/20 transition-colors">
          <Folder size={18} className="sm:w-5 sm:h-5 text-accent" />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h3 className="text-lg sm:text-xl font-semibold text-foreground group-hover:text-accent transition-colors truncate">
            {category.name}
          </h3>
          <span className="text-xs sm:text-sm text-muted whitespace-nowrap">
            {category.projects.length} project{category.projects.length !== 1 ? "s" : ""}
          </span>
        </div>
        <ChevronDown
          size={18}
          className={`sm:w-5 sm:h-5 text-muted flex-shrink-0 transition-transform duration-300 ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Projects Grid - Expandable */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pt-1 pb-2">
              {category.projects.map((project) => (
                <motion.div
                  key={project.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <ProjectCard project={project} />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Projects() {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(projectCategories.map((c) => c.name)) // Start with all expanded
  );

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  return (
    <section id="projects" className="py-20 md:py-24 px-6 relative z-20 pointer-events-none">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 tracking-tight">Projects</h2>
          <div className="w-16 h-1 bg-accent" />
        </motion.div>

        {/* Project Categories */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="space-y-8"
        >
          {projectCategories.map((category) => (
            <motion.div key={category.name} variants={itemVariants} transition={{ duration: 0.5 }}>
              <CategorySection
                category={category}
                isExpanded={expandedCategories.has(category.name)}
                onToggle={() => toggleCategory(category.name)}
              />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
