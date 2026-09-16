import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PowerOPPS | Powerlifting Calculator",
  alternates: { canonical: "/projects/poweropps" },
  description:
    "Calculate your IPF GL, DOTS, Wilks scores and find your target total",
  openGraph: {
    title: "PowerOPPS | Powerlifting Calculator",
    description:
      "Calculate your IPF GL, DOTS, Wilks scores and find your target total",
    type: "website",
    // Next replaces the parent's openGraph block rather than merging into it, so a
    // partial block here silently drops what the root declared. og:url was inherited
    // and pointed crawlers at the homepage as this page's canonical object; og:site_name
    // and og:locale were simply lost. Same three lines, same reason, as the whale
    // tracker's layout.
    url: "/projects/poweropps",
    siteName: "wentao.GG",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "PowerOPPS | Powerlifting Calculator",
    description:
      "Calculate your IPF GL, DOTS, Wilks scores and find your target total",
  },
};

export default function PowerOPPSLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
