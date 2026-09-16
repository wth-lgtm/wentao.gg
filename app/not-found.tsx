import type { Metadata } from "next";
import Link from "next/link";

// /projects/anything served Next's default "This page could not be found" — the one
// page on the site with none of its tokens, no way back to the index and a bare
// black-on-white 404 next to a site that has matrix rain everywhere else.
//
// No "use client" and no retry: there is nothing to retry. A 404 is a settled answer,
// so this page ships as static HTML with no client JS of its own, and the only thing
// it owes the visitor is a route back.
// No `robots` here: Next emits `<meta name="robots" content="noindex">` for a
// not-found render on its own, and declaring it again produced the tag twice.
export const metadata: Metadata = {
  title: "Not found | wentao.GG",
};

export default function NotFound() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
          404 · no such route
        </p>
        <h1 className="mt-3 text-2xl font-bold text-foreground">
          There is nothing at this address.
        </h1>
        <p className="mt-3 text-sm text-muted">
          Either it never existed or it moved. The projects index has everything
          that is live.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link
            href="/#projects"
            className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground transition-colors hover:text-accent"
          >
            Projects
          </Link>
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
