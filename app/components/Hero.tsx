import { ArrowDown } from "lucide-react";
import HeroAnimations from "./HeroClient";

export default function Hero() {
  return (
    <section
      id="about"
      aria-label="Introduction"
      className="relative min-h-svh flex flex-col justify-start md:justify-center px-6 pt-28 pb-28 md:pt-20 md:pb-20 z-20 pointer-events-none"
    >
      <div className="max-w-6xl mx-auto w-full">
        <div
          className="relative z-20 animate-fade-in-up"
          style={{ animationDelay: "0.1s", opacity: 0, animationFillMode: "forwards" }}
        >
          <HeroAnimations>
            {/* LCP element: static heading in server HTML, visible instantly */}
            <div className="min-h-[3.5rem] md:min-h-[7rem]">
              <span className="block font-bold tracking-[-0.045em] leading-[0.92] text-foreground text-shimmer text-[clamp(2.75rem,9vw,7rem)]">
                I&apos;m Wentao
              </span>
            </div>
          </HeroAnimations>
        </div>

        {/* Scroll indicator — desktop only (on phones it collides with the CTA) */}
        <div
          className="hidden md:block absolute bottom-10 left-1/2 -translate-x-1/2 z-20 pointer-events-auto animate-fade-in-up"
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
