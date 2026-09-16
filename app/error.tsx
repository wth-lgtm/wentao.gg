"use client";

import Link from "next/link";
import { useEffect } from "react";

// The root SEGMENT's boundary, for everything that is not the whale tracker (which has
// its own, so a panel throw there keeps the tracker's hull). Before this, any throw
// outside that route rendered Next's default error screen — the only page on the site
// with no tokens, no INDEX link and no retry.
//
// Renamed from GlobalRouteError, which claimed a job this file does not have: in the App
// Router the GLOBAL boundary is `app/global-error.tsx`, which replaces the root layout
// and is the only thing that catches a throw in the layout itself. `app/error.tsx`
// renders INSIDE that layout and catches its children. So a throw in layout.tsx or in
// ThemeProvider still reaches Next's default screen, and the name said otherwise.
// global-error.tsx is deliberately not added here: it cannot use the fonts, the theme
// class or the providers it replaces, so it is a second, token-less page to design and
// maintain for a failure mode this site has not had.
//
// Tokens only, no component imports: this file renders when something in the tree
// below it has already failed, so it must not depend on any of it. `reset()` re-renders
// that subtree, which is the cheapest thing to try first.

export default function SiteRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route render failed", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
          Something broke
        </p>
        <h1 className="mt-3 text-2xl font-bold text-foreground">
          This page stopped rendering.
        </h1>
        <p className="mt-3 text-sm text-muted">
          A retry re-renders it from scratch. If it lands here again, the index has
          everything else.
        </p>
        <p className="mt-3 font-mono text-[11px] break-words text-[var(--legend)]">
          {error.message || "No message was attached to the error."}
          {error.digest ? ` · digest ${error.digest}` : ""}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground transition-colors hover:text-accent"
          >
            Retry
          </button>
          <Link
            href="/"
            className="rounded-lg px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--legend)] transition-colors hover:text-foreground"
          >
            Index
          </Link>
        </div>
      </div>
    </main>
  );
}
