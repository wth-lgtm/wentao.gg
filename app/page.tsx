import dynamic from "next/dynamic";
import Navigation from "./components/Navigation";
import ScrollProgress from "./components/ScrollProgress";
import Hero from "./components/Hero";
import Projects from "./components/Projects";
import Footer from "./components/Footer";

// Code-split heavy/below-fold components into separate chunks
const InteractiveEffects = dynamic(
  () => import("./components/InteractiveEffects")
);

const Experience = dynamic(() => import("./components/Experience"), {
  loading: () => <section className="py-24 px-6" />,
});

const Education = dynamic(() => import("./components/Education"), {
  loading: () => <section className="py-24 px-6" />,
});

const SiteStats = dynamic(() => import("./components/CommitHeatmap"), {
  loading: () => <section className="py-16 px-6" />,
});

const Connect = dynamic(() => import("./components/Connect"), {
  loading: () => <section className="py-24 px-6" />,
});

export default function Home() {
  return (
    <>
      <ScrollProgress />
      <InteractiveEffects />
      <Navigation />
      <main className="pb-20">
        <Hero />
        <Projects />
        <Experience />
        <Education />
        <SiteStats />
        <Connect />
      </main>
      <Footer />
    </>
  );
}
