"use client";

import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect } from "react";

// There was no boundary anywhere under app/ (`find app -name 'error.tsx'` returned
// nothing), so a render-time throw in any one of the four panels — an upstream shape
// change that slips past the null guards is the realistic path — replaced the whole
// tracker with Next's unstyled default error screen: no chrome, no INDEX link, no way
// back and no retry.
//
// This is deliberately the page's own hull rather than a generic apology: the header is
// the same sticky header, the message wears the etched legend style, and `reset()` is
// the retry the default screen never had. A boundary here also keeps the failure
// LOCAL — app/error.tsx would have swallowed the site's chrome as well.

export default function WhaleTrackerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The only record of a client-side throw on a static page. Vercel's runtime logs do
    // not see it, and the digest is what correlates it with a server-side one.
    console.error("Whale tracker render failed", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-background">
      {/* bg-background, not /95: the page this stands in for made its header fully
          opaque precisely because a 95% fill let the content behind ghost through once
          body's overflow-x became `clip` and sticky started engaging, and the comment at
          the top of this file promises "the same sticky header". */}
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="max-w-4xl mx-auto px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center">
          <Link
            href="/#projects"
            className="flex items-center gap-2 justify-self-start text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm hidden sm:inline">Back</span>
          </Link>
          <h1 className="flex items-center gap-1.5 text-base sm:text-lg font-bold">
            <Image
              src="/images/icons/HL symbol_mint green.png"
              alt=""
              width={20}
              height={20}
              className="w-4 h-4 sm:w-5 sm:h-5"
            />
            Whale Tracker
          </h1>
          <span />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
        <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--legend)]">
            Instrument fault
          </p>
          <p className="mt-3 text-sm text-foreground">
            The tracker stopped drawing rather than show you a number it could not
            stand behind. Nothing was sent anywhere and nothing is stored, so a retry
            is a clean second attempt at the same request.
          </p>
          {/* The thrown message, in the legend voice rather than in --loss: the colour
              reserved for failure is already spent on the page's own error banner, and
              a minified production message is context for the retry, not a headline. */}
          <p className="mt-3 font-mono text-[11px] break-words text-[var(--legend)]">
            {error.message || "No message was attached to the error."}
            {error.digest ? ` · digest ${error.digest}` : ""}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground transition-colors hover:text-accent"
            >
              <RefreshCw size={13} aria-hidden />
              Retry
            </button>
            <Link
              href="/#projects"
              className="rounded-lg px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--legend)] transition-colors hover:text-foreground"
            >
              Back to projects
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
