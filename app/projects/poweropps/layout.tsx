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
