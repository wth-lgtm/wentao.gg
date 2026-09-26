import { ArrowDown } from "lucide-react";
import HeroAnimations from "./HeroClient";
import NameCaustic from "./NameCaustic";
import WorldMap from "./map/WorldMap";
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
          {/* worldMap: the visitor card's world, drawn here on the server and handed down as
              a slot, so its land is in the HTML and in no client bundle (map/WorldMap.tsx). */}
          <HeroAnimations worldMap={<WorldMap />}>
            {/* LCP element: static heading in server HTML, visible instantly.
                Now a real <h1>. The comments here have called this "the heading" since
                it was written, but the markup was a <span>, so the document served
                four h2s, thirteen h3s and no top-level heading at all.

                The h1 is the CONTAINER, not the text span, and that placement is
                load-bearing rather than stylistic. globals.css carries an unlayered
                `h1 { letter-spacing: -0.03em }` plus a grouped `line-height: 1.2`,
                while Tailwind's `tracking-[-0.045em]` and `leading-[0.92]` live
                inside @layer utilities — and an UNLAYERED declaration beats a layered
                one regardless of specificity. Tagging the span itself would therefore
                have quietly retracked and re-led the wordmark, which matters twice
                over: heroName.ts renders this string a second time in NameCaustic as
                an aria-hidden light overlay, and the two copies must share exact
                metrics or the caustic lands off the letterforms.

                On the container it cannot bite. Those three properties are all
                inherited ones, and both inner copies declare all three explicitly via
                HERO_NAME_METRICS — an explicit declaration always beats an inherited
                value, layers or not. The container holds no direct text of its own. */}
            {/* data-hero-h1: the jack field's keep-out reads this rect while it is on screen (JackFieldScene.tsx). */}
            <h1 data-hero-h1 className="relative min-h-[3rem] md:min-h-[7rem]">
              <span className={`${HERO_NAME_METRICS} text-foreground text-shimmer`}>
                {HERO_NAME}
              </span>
              {/* Light from the same pointer that paints the fluid, stacked on top.
                  Decorative and additive — the heading above is the real one. */}
              <NameCaustic />
            </h1>
          </HeroAnimations>
        </div>

        {/* Scroll indicator — desktop only (on phones it collides with the CTA) */}
        <div
          className="hidden md:block absolute bottom-10 left-1/2 -translate-x-1/2 z-20 pointer-events-auto animate-fade-in-up"
          style={{ animationDelay: "2s", opacity: 0, animationFillMode: "forwards" }}
        >
          <a
            href="#experience"
            aria-label="Scroll to experience"
            className="text-muted hover:text-foreground transition-colors inline-block"
          >
            <ArrowDown size={24} className="animate-bounce" />
          </a>
        </div>
      </div>
    </section>
  );
}
