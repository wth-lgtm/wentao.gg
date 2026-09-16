"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import { SECTIONS } from "./sections";

// One index, numbered — the overlay is the whole navigation (mobile + desktop). The list
// itself lives in sections.ts so the page eyebrows print the same numbers.
const sections = SECTIONS.map((s) => ({ ...s, href: `#${s.id}` }));

// Projects fold inline under 04 — no separate dropdown.
const projects: { name: string; href: string; comingSoon?: boolean }[] = [
  { name: "Whale Tracker", href: "/projects/hl-whale-tracker" },
  { name: "PowerOPPS", href: "/projects/poweropps" },
  { name: "ProgDash", href: "/projects/progdash" },
  { name: "What's my RPE?", href: "#projects", comingSoon: true },
];

const EASE = [0.16, 1, 0.3, 1] as const;

// What the Tab trap counts as focusable inside the overlay. A constant because it was a
// string literal inside a keydown handler: every control the overlay renders has to be
// matched by it, and a selector that lives beside the markup it describes is the only
// version anyone will remember to update. Deliberately narrow — the overlay renders
// nothing but links and buttons, and a full tabbable selector (tabindex, inputs,
// [contenteditable], audio/video controls) would be a list of elements that are not
// here, with `:not([tabindex="-1"])` on each to keep it honest.
const FOCUSABLE = 'a[href], button:not([disabled])';

export default function Navigation() {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState("");
  const reduce = useReducedMotion() ?? false;
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Whether closing should hand focus back to the INDEX button. It should for Escape
  // and for CLOSE, and it should NOT when the menu closed because a link in it was
  // activated: the browser has already moved focus (and the scroll position) to the
  // fragment or the new route, and pulling focus back to a button in the top-right
  // corner discards the navigation the click just performed — the visitor lands at
  // the section with their focus somewhere else entirely.
  const restoreOpener = useRef(true);
  const closeForNavigation = () => {
    restoreOpener.current = false;
    setOpen(false);
  };

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

  // Body scroll-lock, Escape, and the modal focus contract (ARIA APG): move focus in on
  // open, keep Tab inside the overlay — it used to walk straight past it into <main> behind
  // the frosted layer — and hand focus back to the INDEX button on close (WCAG 2.4.3).
  useEffect(() => {
    if (!open) return;

    // One frame of slack so framer-motion has committed the overlay's entrance styles.
    const raf = requestAnimationFrame(() => closeBtnRef.current?.focus());

    // The rest of the page, made INERT while the index is open.
    //
    // aria-modal="true" is a promise to assistive tech and the Tab trap below keeps the
    // tab sequence honest, but neither of them stops a screen reader's virtual cursor
    // walking the page behind the frosted layer, browser find-in-page landing on it, or a
    // click reaching it. `inert` removes a subtree from all of that at once, and it is the
    // attribute the APG dialog pattern asks for alongside aria-modal.
    //
    // Applied to <body>'s own children, because the overlay is one of them: every
    // provider between body and here renders a fragment, so on this page body's children
    // ARE the skip link, the canvases, this overlay, <main> and the footer. Anything
    // already inert is left alone and left out of the restore list, so nothing here can
    // hand back an element it did not take.
    const overlay = overlayRef.current;
    const inerted: HTMLElement[] = [];
    if (overlay) {
      for (const el of Array.from(document.body.children)) {
        if (!(el instanceof HTMLElement)) continue;
        if (el === overlay || el.contains(overlay)) continue;
        if (el.hasAttribute("inert")) continue;
        el.setAttribute("inert", "");
        inerted.push(el);
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      const focusables = overlay.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !overlay.contains(active);
      if (e.shiftKey ? outside || active === first : outside || active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Before the focus restore, not after: the INDEX button lives in one of the
      // subtrees above, and focus() on an inert element does nothing at all.
      for (const el of inerted) el.removeAttribute("inert");
      if (restoreOpener.current) openerRef.current?.focus();
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

          {/* Theme toggle stays a persistent top-right control, separate from the menu. */}
          <div className="pointer-events-auto flex items-center gap-3 md:gap-4 text-legible">
            <ThemeToggle />
            <button
              onClick={(e) => {
                openerRef.current = e.currentTarget;
                restoreOpener.current = true;
                setOpen(true);
              }}
              aria-label="Open menu"
              aria-expanded={open}
              className="group flex items-center gap-2.5"
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
      </div>

      {/* Full-viewport overlay = the entire menu. Frosted over the live fluid + rain. */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={overlayRef}
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
                  onClick={closeForNavigation}
                  className="text-xl font-semibold tracking-tight text-foreground"
                >
                  W.
                </a>
                <button
                  ref={closeBtnRef}
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
                      onClick={closeForNavigation}
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
                            /* Unavailable is carried by the chip's shape, not by fading the
                               label: text-muted/50 measured 2.28:1 dark / 1.97:1 light. */
                            <span key={p.name} className="text-sm text-muted">
                              {p.name}{" "}
                              <span className="rounded border border-border px-1 text-[10px] uppercase tracking-wider text-legend">
                                soon
                              </span>
                            </span>
                          ) : (
                            <Link
                              key={p.name}
                              href={p.href}
                              onClick={closeForNavigation}
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
                <a
                  href="mailto:me@wentao.gg"
                  className="hover:text-foreground transition-colors"
                >
                  me@wentao.gg
                </a>
                <span className="tabular-nums">SF {clock}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
