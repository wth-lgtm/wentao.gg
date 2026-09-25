import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "./components/ThemeProvider";
import MotionProvider from "./components/MotionProvider";
import SiteMotion from "./components/SiteMotion";
import { BOOT_MOTION_SCRIPT } from "./lib/siteMotion";
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
  // NO `alternates` here on purpose. Metadata is INHERITED by every child segment, so a
  // root canonical of "/" made all four project routes announce themselves as duplicates
  // of the homepage — i.e. it asked Google to drop them. Each route declares its own
  // self-referencing canonical instead (see app/page.tsx and the project layouts).
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

// Script to prevent flash of wrong theme.
//
// The localStorage read is guarded, because this is the one place on the site where it
// was not. WebKit throws SecurityError on ANY localStorage access under "Block all
// cookies" (and in some embedded webviews) — ThemeProvider wraps its reads for exactly
// that reason — and here the throw happens in a blocking inline script in <head>,
// BEFORE the class is applied and before React exists to catch anything. A blocked-
// storage visitor got no theme class at all, so every token fell back to its :root
// default for the life of the page. Falling through to the system preference is the
// same answer an absent key gets, which is the right one: nothing was stored.
//
// The same blocking script writes html[data-site-motion] = "on" | "off" (reduced motion or forced colours →
// "off"; app/lib/siteMotion.ts BOOT_MOTION_SCRIPT), so the reading chapters' CSS can lay out the first paint
// (pinned or in flow) before hydration without a shift. With JS off the attribute is absent and every
// chapter renders static. SiteMotion keeps it live after hydration; <html suppressHydrationWarning> covers it.
const themeScript = `
  (function() {
    var stored = null;
    try { stored = localStorage.getItem('theme'); } catch (e) {}
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' ? 'light' : stored === 'dark' ? 'dark' : (prefersDark ? 'dark' : 'light');
    document.documentElement.classList.add(theme);
    try { ${BOOT_MOTION_SCRIPT} } catch (e) {}
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
            <SiteMotion />
            {children}
          </MotionProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
