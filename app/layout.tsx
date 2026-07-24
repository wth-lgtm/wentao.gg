import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "./components/ThemeProvider";
import MotionProvider from "./components/MotionProvider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  // Variable font: omit `weight` to load the full 300–700 axis so 500/600 render
  // as true weights instead of synthesized faux-bold from the 400/700 masters.
  display: "swap",
  preload: true,
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
});

const DESCRIPTION =
  "Wentao He — Engineering Lead on Mercor's Applied AI team, in San Francisco. Data infrastructure at scale, and a few things built for the fun of it.";

export const metadata: Metadata = {
  // Required for crawlers: without it Next emits a RELATIVE og:image URL, which every
  // scraper rejects, so the preview silently stays blank.
  metadataBase: new URL("https://wentao.gg"),
  title: "wentao.GG",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: "wentao.GG",
    description: DESCRIPTION,
    type: "website",
    url: "/",
    siteName: "wentao.GG",
    locale: "en_US",
  },
  twitter: {
    // "summary" renders a small square thumbnail; the 1200x630 card needs this.
    card: "summary_large_image",
    title: "wentao.GG",
    description: DESCRIPTION,
  },
};

// Script to prevent flash of wrong theme
const themeScript = `
  (function() {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = stored === 'light' ? 'light' : stored === 'dark' ? 'dark' : (prefersDark ? 'dark' : 'light');
    document.documentElement.classList.add(theme);
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}>
        <ThemeProvider>
          <MotionProvider>
            {children}
          </MotionProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
