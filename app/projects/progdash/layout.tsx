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
