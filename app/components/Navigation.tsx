"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ChevronDown, Dumbbell, Video, TrendingUp, Folder, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

const navItems = [
  { name: "About", href: "#about" },
  { name: "Experience", href: "#experience" },
  { name: "Education", href: "#education" },
  { name: "Projects", href: "#projects", hasDropdown: true },
  { name: "Contact", href: "#connect", isButton: true },
];

interface ProjectItem {
  name: string;
  href: string;
  description: string;
  icon: React.ElementType;
  comingSoon?: boolean;
}

interface ProjectCategory {
  name: string;
  icon: React.ElementType;
  projects: ProjectItem[];
}

const projectCategories: ProjectCategory[] = [
  {
    name: "₿",
    icon: TrendingUp,
    projects: [
      {
        name: "🐋 Tracker",
        href: "/projects/hl-whale-tracker",
        description: "Hyperliquid trader leaderboard",
        icon: TrendingUp,
      },
    ],
  },
  {
    name: "🏋️",
    icon: Dumbbell,
    projects: [
      {
        name: "PowerOPPS",
        href: "/projects/poweropps",
        description: "Powerlifting index calculator",
        icon: Dumbbell,
      },
      {
        name: "ProgDash",
        href: "/projects/progdash",
        description: "Google Sheets program viewer",
        icon: FileSpreadsheet,
      },
      {
        name: "What's my RPE?",
        href: "#projects",
        description: "Velocity-based RPE predictor",
        icon: Video,
        comingSoon: true,
      },
    ],
  },
];

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [mobileProjectsOpen, setMobileProjectsOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [mobileExpandedCategory, setMobileExpandedCategory] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProjectsOpen(false);
        setExpandedCategory(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsProjectsOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsProjectsOpen(false);
      setExpandedCategory(null);
    }, 150);
  };

  const toggleCategory = (categoryName: string) => {
    setExpandedCategory(expandedCategory === categoryName ? null : categoryName);
  };

  return (
    <>
      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? "bg-background/80 backdrop-blur-lg border-b border-border"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <motion.a
              href="#"
              className="text-xl font-semibold tracking-tight"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              W.
            </motion.a>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-6">
              {navItems.map((item, index) => (
                item.hasDropdown ? (
                  <div
                    key={item.name}
                    ref={dropdownRef}
                    className="relative"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  >
                    <motion.button
                      className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      onClick={() => setIsProjectsOpen(!isProjectsOpen)}
                    >
                      {item.name}
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-200 ${isProjectsOpen ? "rotate-180" : ""}`}
                      />
                    </motion.button>

                    <AnimatePresence>
                      {isProjectsOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.96 }}
                          transition={{ duration: 0.15 }}
                          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 bg-card border border-border rounded-xl shadow-lg overflow-hidden"
                        >
                          <div className="p-2">
                            <a
                              href={item.href}
                              className="block px-3 py-2 text-xs text-muted hover:text-foreground transition-colors"
                              onClick={() => setIsProjectsOpen(false)}
                            >
                              View All Projects
                            </a>
                            <div className="h-px bg-border my-1" />

                            {/* Categories with inline expansion */}
                            {projectCategories.map((category) => (
                              <div key={category.name}>
                                <button
                                  onClick={() => toggleCategory(category.name)}
                                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-background transition-colors group"
                                >
                                  <div className="flex items-center gap-3">
                                    <div className="p-1.5 bg-accent/10 rounded-md group-hover:bg-accent/20 transition-colors">
                                      <Folder size={14} className="text-accent" />
                                    </div>
                                    <span className="text-sm font-medium text-foreground">{category.name}</span>
                                  </div>
                                  <ChevronDown
                                    size={14}
                                    className={`text-muted transition-transform duration-200 ${
                                      expandedCategory === category.name ? "rotate-180" : ""
                                    }`}
                                  />
                                </button>

                                {/* Expanded projects */}
                                <AnimatePresence>
                                  {expandedCategory === category.name && (
                                    <motion.div
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: "auto" }}
                                      exit={{ opacity: 0, height: 0 }}
                                      transition={{ duration: 0.2 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="pl-4 pb-1">
                                        {category.projects.map((project) => (
                                          project.comingSoon ? (
                                            <div
                                              key={project.name}
                                              className="flex items-center gap-3 px-3 py-2.5 rounded-lg opacity-50 cursor-default"
                                            >
                                              <div className="p-1.5 bg-muted/10 rounded-md">
                                                <project.icon size={14} className="text-muted" />
                                              </div>
                                              <div>
                                                <div className="text-sm font-medium text-muted">{project.name}</div>
                                                <div className="text-xs text-muted">{project.description}</div>
                                              </div>
                                            </div>
                                          ) : (
                                            <Link
                                              key={project.name}
                                              href={project.href}
                                              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-background transition-colors group"
                                              onClick={() => {
                                                setIsProjectsOpen(false);
                                                setExpandedCategory(null);
                                              }}
                                            >
                                              <div className="p-1.5 bg-accent/10 rounded-md group-hover:bg-accent/20 transition-colors">
                                                <project.icon size={14} className="text-accent" />
                                              </div>
                                              <div>
                                                <div className="text-sm font-medium text-foreground">{project.name}</div>
                                                <div className="text-xs text-muted">{project.description}</div>
                                              </div>
                                            </Link>
                                          )
                                        ))}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : item.isButton ? (
                  <motion.a
                    key={item.name}
                    href={item.href}
                    className="text-sm font-medium px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {item.name}
                  </motion.a>
                ) : (
                  <motion.a
                    key={item.name}
                    href={item.href}
                    className="text-sm text-muted hover:text-foreground transition-colors"
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    whileHover={{ y: -2 }}
                  >
                    {item.name}
                  </motion.a>
                )
              ))}
              <ThemeToggle />
            </div>

            {/* Mobile: Theme Toggle + Menu Button */}
            <div className="md:hidden flex items-center gap-2">
              <ThemeToggle />
              <button
                className="p-2 text-muted hover:text-foreground transition-colors"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 z-40 bg-background/95 backdrop-blur-lg md:hidden overflow-y-auto"
          >
            <div className="flex flex-col items-center justify-center min-h-full py-20 gap-6">
              {navItems.map((item, index) => (
                item.hasDropdown ? (
                  <div key={item.name} className="flex flex-col items-center w-full max-w-sm px-6">
                    <motion.button
                      className="flex items-center gap-2 text-2xl font-medium text-muted hover:text-foreground transition-colors"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      onClick={() => setMobileProjectsOpen(!mobileProjectsOpen)}
                    >
                      {item.name}
                      <ChevronDown
                        size={20}
                        className={`transition-transform duration-200 ${mobileProjectsOpen ? "rotate-180" : ""}`}
                      />
                    </motion.button>

                    <AnimatePresence>
                      {mobileProjectsOpen && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="mt-4 flex flex-col items-center gap-4 w-full"
                        >
                          <a
                            href={item.href}
                            className="text-sm text-muted hover:text-foreground transition-colors"
                            onClick={() => {
                              setMobileProjectsOpen(false);
                              setIsMobileMenuOpen(false);
                            }}
                          >
                            View All Projects
                          </a>

                          {/* Mobile Categories */}
                          {projectCategories.map((category) => (
                            <div key={category.name} className="w-full">
                              <button
                                className="w-full flex items-center justify-between px-4 py-3 bg-card rounded-xl border border-border"
                                onClick={() => setMobileExpandedCategory(
                                  mobileExpandedCategory === category.name ? null : category.name
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="p-2 bg-accent/10 rounded-lg">
                                    <Folder size={18} className="text-accent" />
                                  </div>
                                  <span className="font-medium text-foreground">{category.name}</span>
                                </div>
                                <ChevronDown
                                  size={18}
                                  className={`text-muted transition-transform duration-200 ${
                                    mobileExpandedCategory === category.name ? "rotate-180" : ""
                                  }`}
                                />
                              </button>

                              <AnimatePresence>
                                {mobileExpandedCategory === category.name && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="mt-2 space-y-2 pl-4"
                                  >
                                    {category.projects.map((project) => (
                                      project.comingSoon ? (
                                        <div
                                          key={project.name}
                                          className="flex items-center gap-3 px-4 py-3 bg-card/50 rounded-xl border border-border opacity-50"
                                        >
                                          <div className="p-2 bg-muted/10 rounded-lg">
                                            <project.icon size={18} className="text-muted" />
                                          </div>
                                          <div>
                                            <div className="font-medium text-muted">{project.name}</div>
                                            <div className="text-xs text-muted">{project.description}</div>
                                          </div>
                                        </div>
                                      ) : (
                                        <Link
                                          key={project.name}
                                          href={project.href}
                                          className="flex items-center gap-3 px-4 py-3 bg-card rounded-xl border border-border"
                                          onClick={() => {
                                            setMobileProjectsOpen(false);
                                            setMobileExpandedCategory(null);
                                            setIsMobileMenuOpen(false);
                                          }}
                                        >
                                          <div className="p-2 bg-accent/10 rounded-lg">
                                            <project.icon size={18} className="text-accent" />
                                          </div>
                                          <div>
                                            <div className="font-medium text-foreground">{project.name}</div>
                                            <div className="text-xs text-muted">{project.description}</div>
                                          </div>
                                        </Link>
                                      )
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : item.isButton ? (
                  <motion.a
                    key={item.name}
                    href={item.href}
                    className="text-xl font-medium px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl transition-colors"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {item.name}
                  </motion.a>
                ) : (
                  <motion.a
                    key={item.name}
                    href={item.href}
                    className="text-2xl font-medium text-muted hover:text-foreground transition-colors"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {item.name}
                  </motion.a>
                )
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
