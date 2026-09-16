"use client";

export default function Footer() {
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE;

  return (
    <footer className="py-4 px-6 bg-background/90 border-t border-border">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted text-sm font-mono">
          <span>&copy; {process.env.NEXT_PUBLIC_BUILD_YEAR} Wentao</span>
          {buildDate && (
            <>
              <span>·</span>
              <span>Updated {buildDate}</span>
            </>
          )}
          <span>·</span>
          <a
            href="https://github.com/wth-lgtm/wentao.gg"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}
