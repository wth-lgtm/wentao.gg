import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Navigation from "./components/Navigation";
import ScrollProgress from "./components/ScrollProgress";
import Hero from "./components/Hero";
import Projects from "./components/Projects";
import Footer from "./components/Footer";
import MatrixRain from "./components/MatrixRain";
import HeroMeta from "./components/HeroMeta";
import JackField from "./components/JackField";
import Experience from "./components/Experience";
import Education from "./components/Education";
import ChapterDirector from "./components/chapter/ChapterDirector";

// Code-split heavy/below-fold components into separate chunks
const InteractiveEffects = dynamic(
  () => import("./components/InteractiveEffects")
);

// Experience and Education are reading chapters (DESIGN §4.2): server components, statically imported like
// Projects. On a hard load they were already server-rendered; the dynamic() placeholders (a ≈ 160 px empty
// section) only ever showed on a cold SOFT navigation — a project page opened directly, then Back to
// /#projects — where a late 1,600 px chapter would throw the anchor off by its height (E19).

const SiteStats = dynamic(() => import("./components/CommitHeatmap"), {
  loading: () => <section className="py-20 md:py-24 px-6" />,
});

const Connect = dynamic(() => import("./components/Connect"), {
  loading: () => <section className="py-20 md:py-24 px-6" />,
});

// The root layout deliberately declares no canonical (it would be inherited by every
// project route); the homepage supplies its own.
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <ScrollProgress />
      {/* Back-to-front fixed layers: matrix rain (z-0) → fluid (z-10) → the jack field (z-10,
          later in the DOM so it paints over the fluid) → content (z-20). */}
      <MatrixRain />
      <InteractiveEffects />
      <JackField />
      <Navigation />
      <HeroMeta />
      <main id="main" tabIndex={-1} className="relative overflow-x-clip">
        <Hero />
        <Experience />
        <Education />
        <Projects />
        <SiteStats />
        <Connect />
      </main>
      <Footer />
      {/* The one director of the reading chapters: modes, marks, keep-your-place (renders nothing). */}
      <ChapterDirector />
    </>
  );
}
