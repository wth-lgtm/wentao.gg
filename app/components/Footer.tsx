"use client";

import { Github, Linkedin, Mail } from "lucide-react";

function formatLastUpdated(isoString: string | undefined): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const lastUpdated = formatLastUpdated(process.env.NEXT_PUBLIC_BUILD_TIME);

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 py-4 px-6 bg-background/90 backdrop-blur-lg border-t border-border footer-shadow">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-muted text-sm">
            <span>&copy; {currentYear} Wentao</span>
            {lastUpdated && (
              <>
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">Updated {lastUpdated}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-5">
            <a
              href="https://linkedin.com/in/wentaohe"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-foreground transition-colors"
            >
              <Linkedin size={18} />
            </a>
            <a
              href="https://github.com/wth-lgtm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-foreground transition-colors"
            >
              <Github size={18} />
            </a>
            <a
              href="mailto:me@wentao.gg"
              className="text-muted hover:text-foreground transition-colors"
            >
              <Mail size={18} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
