import { ArrowDown } from "lucide-react";
import HeroAnimations from "./HeroClient";
import NameCaustic from "./NameCaustic";
import { HERO_NAME, HERO_NAME_METRICS } from "./heroName";

export default function Hero() {
  return (
    <section
      id="about"
      aria-label="Introduction"
      className="relative min-h-svh flex flex-col justify-start md:justify-center px-6 pt-32 pb-16 md:py-20 z-20 pointer-events-none"
    >
      <div className="max-w-6xl mx-auto w-full">
        <div
          className="relative z-20 animate-fade-in-up"
          style={{ animationDelay: "0.1s", opacity: 0, animationFillMode: "forwards" }}
        >
          <HeroAnimations>
            {/* LCP element: static heading in server HTML, visible instantly */}
            <div className="relative min-h-[3rem] md:min-h-[7rem]">
              <span className={`${HERO_NAME_METRICS} text-foreground text-shimmer`}>
                {HERO_NAME}
              </span>
              {/* Light from the same pointer that paints the fluid, stacked on top.
                  Decorative and additive — the heading above is the real one. */}
              <NameCaustic />
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
