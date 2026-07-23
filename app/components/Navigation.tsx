"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

// One index, numbered — the overlay is the whole navigation (mobile + desktop).
const sections = [
  { n: "01", name: "About", href: "#about" },
  { n: "02", name: "Experience", href: "#experience" },
  { n: "03", name: "Education", href: "#education" },
  { n: "04", name: "Projects", href: "#projects" },
  { n: "05", name: "Connect", href: "#connect" },
];

// Projects fold inline under 04 — no separate dropdown.
const projects: { name: string; href: string; comingSoon?: boolean }[] = [
  { name: "🐋 Tracker", href: "/projects/hl-whale-tracker" },
  { name: "PowerOPPS", href: "/projects/poweropps" },
  { name: "ProgDash", href: "/projects/progdash" },
  { name: "What's my RPE?", href: "#projects", comingSoon: true },
];

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Navigation() {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState("");
  const reduce = useReducedMotion() ?? false;

  // Owner's local time (SF) as ambient metadata — refreshed each half-minute.
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", {
          timeZone: "America/Los_Angeles",
          hour: "numeric",
          minute: "2-digit",
        })
      );
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  // Body scroll-lock + Escape to close while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      {/* Persistent split-corner marks — no bar, no plate. Wrapper is click-through so the
          fluid still gets cursor events between the two marks; the marks themselves are not. */}
      <div className="fixed top-0 left-0 right-0 z-50 pointer-events-none">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <a
            href="#"
            aria-label="Back to top"
            className="pointer-events-auto text-xl font-semibold tracking-tight text-foreground text-legible"
          >
            W.
          </a>

          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="pointer-events-auto group flex items-center gap-2.5 text-legible"
          >
            <span className="font-mono text-xs tracking-[0.25em] text-muted group-hover:text-foreground transition-colors">
              INDEX
            </span>
            {/* staggered rule mark → aligns on hover */}
            <span className="flex flex-col items-end gap-[4px] w-5">
              <span className="h-px w-5 bg-muted group-hover:bg-foreground transition-all duration-300" />
              <span className="h-px w-3 bg-muted group-hover:w-5 group-hover:bg-foreground transition-all duration-300" />
            </span>
          </button>
        </div>
      </div>

      {/* Full-viewport overlay = the entire menu. Frosted over the live fluid + rain. */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.35, ease: EASE }}
            className="fixed inset-0 z-[60] bg-background/75 backdrop-blur-2xl"
          >
            <div className="relative z-10 flex min-h-full flex-col max-w-6xl mx-auto px-6 py-5">
              {/* top row mirrors the persistent marks */}
              <div className="flex items-center justify-between">
                <a
                  href="#"
                  onClick={() => setOpen(false)}
                  className="text-xl font-semibold tracking-tight text-foreground"
                >
                  W.
                </a>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="group flex items-center gap-2.5"
                >
                  <span className="font-mono text-xs tracking-[0.25em] text-muted group-hover:text-foreground transition-colors">
                    CLOSE
                  </span>
                  <X size={18} className="text-muted group-hover:text-foreground transition-colors" />
                </button>
              </div>

              {/* numbered index */}
              <nav className="flex flex-1 flex-col justify-center gap-1.5 md:gap-3 py-16">
                {sections.map((s, i) => (
                  <motion.div
                    key={s.name}
                    initial={reduce ? false : { opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reduce ? 0 : 0.06 + i * 0.05, duration: 0.5, ease: EASE }}
                  >
                    <a
                      href={s.href}
                      onClick={() => setOpen(false)}
                      className="group flex items-baseline gap-4 md:gap-6 w-fit"
                    >
                      <span className="font-mono text-xs md:text-sm text-muted tabular-nums pt-1">{s.n}</span>
                      <span className="text-4xl md:text-6xl font-bold tracking-tight text-foreground/70 group-hover:text-foreground transition-colors duration-300">
                        {s.name}
                      </span>
                    </a>

                    {s.name === "Projects" && (
                      <div className="pl-11 md:pl-16 mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                        {projects.map((p) =>
                          p.comingSoon ? (
                            <span key={p.name} className="text-sm text-muted/50">
                              {p.name} <span className="text-[10px] uppercase tracking-wider">soon</span>
                            </span>
                          ) : (
                            <Link
                              key={p.name}
                              href={p.href}
                              onClick={() => setOpen(false)}
                              className="text-sm text-muted hover:text-foreground transition-colors"
                            >
                              {p.name}
                            </Link>
                          )
                        )}
                      </div>
                    )}
                  </motion.div>
                ))}
              </nav>

              {/* footer metadata */}
              <div className="flex items-center justify-between font-mono text-xs text-muted">
                <a href="mailto:me@wentao.gg" className="hover:text-foreground transition-colors">
                  me@wentao.gg
                </a>
                <div className="flex items-center gap-4">
                  <ThemeToggle />
                  <span className="tabular-nums">SF {clock}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
