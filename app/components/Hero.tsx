import { ArrowDown } from "lucide-react";
import HeroAnimations from "./HeroClient";
import MagneticButton from "./MagneticButton";

export default function Hero() {
  return (
    <section
      id="about"
      aria-label="Introduction"
      className="relative min-h-screen flex flex-col justify-center px-6 pt-20 z-20 pointer-events-none"
    >
      <div className="max-w-5xl mx-auto w-full">
        <div
          className="space-y-6 relative z-20 pointer-events-none animate-fade-in-up"
          style={{ animationDelay: "0.1s", opacity: 0, animationFillMode: "forwards" }}
        >
          <HeroAnimations>
            {/* LCP element: static heading in server HTML, visible instantly */}
            <div className="min-h-[3.5rem] md:min-h-[8rem]">
              <span className="block font-bold tracking-[-0.045em] leading-[0.92] text-foreground text-shimmer text-[clamp(3rem,12vw,8rem)]">
                I&apos;m Wentao
              </span>
            </div>
          </HeroAnimations>

          {/* Primary CTA — subtle magnetic hover (reduced-motion safe) */}
          <div
            className="flex gap-4 pt-4 animate-fade-in-up"
            style={{ animationDelay: "0.8s", opacity: 0, animationFillMode: "forwards" }}
          >
            <MagneticButton
              href="#connect"
              className="px-6 py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors pointer-events-auto inline-block"
            >
              Get in touch
            </MagneticButton>
          </div>
        </div>

        {/* Scroll indicator */}
        <div
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 pointer-events-auto animate-fade-in-up"
          style={{ animationDelay: "2s", opacity: 0, animationFillMode: "forwards" }}
        >
          <a
            href="#experience"
            className="text-muted hover:text-foreground transition-colors inline-block"
          >
            <ArrowDown size={24} className="animate-bounce" />
          </a>
        </div>
      </div>
    </section>
  );
}
