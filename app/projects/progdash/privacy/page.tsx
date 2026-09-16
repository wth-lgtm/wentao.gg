import type { Metadata } from "next";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import Link from "next/link";

// Without this the page inherited ProgDash's layout title and shipped as
// "ProgDash | Powerlifting Program Viewer" — the wrong title on the one page Google's
// OAuth verification actually reads. Kept indexable on purpose for the same reason.
export const metadata: Metadata = {
  title: "Privacy Policy | ProgDash",
  description:
    "What ProgDash accesses in your Google account, what it does not store, and how to revoke access.",
  alternates: { canonical: "/projects/progdash/privacy" },
};

export default function ProgDashPrivacy() {
  return (
    <main className="min-h-screen bg-background">
      {/* Opaque, and no backdrop-blur — the same decision, and the same reason, as the
          whale tracker's header. Until body's `overflow-x: hidden` became `clip` (PR #61)
          this header never actually stuck: body was a scroll container, so it stuck to
          body and scrolled away with the page, and the fill never had anything behind it.
          Now it engages, and measured in Chromium at 1440x620 and 390x500 in both themes
          there are 2-10 text-bearing elements under its band at a scroll of 250px, at a
          0.9 fill with blur(12px) over them. A full-width backdrop-filter also
          re-rasterises on every scroll frame. */}
      <header className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            href="/projects/progdash"
            className="flex items-center gap-2 text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm hidden sm:inline">Back</span>
          </Link>
          <h1 className="text-lg font-bold flex items-center gap-2">
            {/* --gain, not green-500: the token is measured in both themes (10.2:1 on
                dark, 5.55:1 on light) and a hardcoded palette step is neither. */}
            <FileSpreadsheet size={20} className="text-gain" />
            ProgDash
          </h1>
          <div className="w-16" />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <h2 className="text-2xl sm:text-3xl font-bold mb-6">Privacy Policy</h2>
        <p className="text-xs text-muted mb-8">Last updated: July 24, 2026</p>

        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <section>
            <h3 className="text-base font-semibold text-foreground mb-2">What ProgDash Does</h3>
            <p>
              ProgDash is a free tool that lets you sign in with Google to view your
              Google Sheets data in a clean training interface. It is designed for
              powerlifting program spreadsheets but works with any spreadsheet.
            </p>
          </section>

          <section>
            <h3 className="text-base font-semibold text-foreground mb-2">Data We Access</h3>
            <p>When you sign in, ProgDash requests read-only access to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                The <strong className="text-foreground">names only</strong> of the
                spreadsheets in your Google Drive, so it can offer you a list to pick from
              </li>
              <li>Your Google Sheets data (to display the contents you select)</li>
            </ul>
            <p className="mt-2">
              All access is <strong className="text-foreground">read-only</strong>. ProgDash
              cannot modify, delete, or create any files in your Google account. Its Drive
              permission is limited to file metadata, so it is not able to open or download
              any Drive file — only the spreadsheet you explicitly choose is ever read.
            </p>
          </section>

          <section>
            <h3 className="text-base font-semibold text-foreground mb-2">Data We Store</h3>
            <p>
              <strong className="text-foreground">None.</strong> ProgDash does not store,
              save, or persist any of your data. Your spreadsheet data is fetched on
              demand and only exists in your browser session. When you close the tab or
              sign out, all data is gone.
            </p>
            <p className="mt-2">
              We do not use cookies for tracking, analytics on your sheet data, or any
              form of persistent storage beyond what is required for authentication
              (a session cookie).
            </p>
          </section>

          <section>
            <h3 className="text-base font-semibold text-foreground mb-2">Third-Party Services</h3>
            <p>
              ProgDash uses Google OAuth 2.0 for authentication and the Google Sheets
              and Drive APIs to read your data. No other third-party services receive
              your data.
            </p>
          </section>

          <section>
            <h3 className="text-base font-semibold text-foreground mb-2">Revoking Access</h3>
            <p>
              You can revoke ProgDash&apos;s access to your Google account at any time by
              visiting your{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gain underline hover:text-foreground transition-colors"
              >
                Google Account permissions
              </a>
              {" "}and removing ProgDash.
            </p>
          </section>

          <section>
            <h3 className="text-base font-semibold text-foreground mb-2">Contact</h3>
            <p>
              If you have any questions about this privacy policy, you can reach out
              via the contact information on{" "}
              <Link
                href="/"
                className="text-gain underline hover:text-foreground transition-colors"
              >
                wentao.gg
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
