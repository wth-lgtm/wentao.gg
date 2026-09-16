"use client";

import Link from "next/link";
import { useEffect } from "react";

// The site-wide boundary, for everything that is not the whale tracker (which has its
// own, so a panel throw there keeps the tracker's hull). Before this, any throw outside
// that route rendered Next's default error screen — the only page on the site with no
// tokens, no INDEX link and no retry.
//
// Tokens only, no component imports: this file renders when something in the tree
// below it has already failed, so it must not depend on any of it. `reset()` re-renders
// that subtree, which is the cheapest thing to try first.

export default function GlobalRouteError({
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
