import type { Metadata } from "next";
import SessionWrapper from "./SessionWrapper";

export const metadata: Metadata = {
  title: "ProgDash | Powerlifting Program Viewer",
  alternates: { canonical: "/projects/progdash" },
  description:
    "Sign in with Google and load your powerlifting program from Google Sheets into a clean, readable interface.",
  openGraph: {
    title: "ProgDash | Powerlifting Program Viewer",
    description:
      "Sign in with Google and load your powerlifting program from Google Sheets into a clean, readable interface.",
    type: "website",
    // Next replaces the parent's openGraph block rather than merging into it, so a
    // partial block here silently drops what the root declared. og:url was inherited
    // and pointed crawlers at the homepage as this page's canonical object; og:site_name
    // and og:locale were simply lost. Same three lines, same reason, as the whale
    // tracker's layout.
    url: "/projects/progdash",
    siteName: "wentao.GG",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "ProgDash | Powerlifting Program Viewer",
    description:
      "Sign in with Google and load your powerlifting program from Google Sheets into a clean, readable interface.",
  },
};

export default function ProgDashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionWrapper>{children}</SessionWrapper>;
}
