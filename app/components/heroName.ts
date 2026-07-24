// The hero wordmark is rendered TWICE: once as the server-rendered LCP heading
// (Hero.tsx) and once as the client-only light overlay (NameCaustic.tsx). The two
// copies sit exactly on top of each other, so they must render identical glyphs at
// identical metrics — if either the string or the type scale drifts, the light lands
// off the letterforms. Both live here so that can't happen.
//
// Deliberately NOT a client module: Hero.tsx stays a server component and the
// heading text stays in the static HTML, which is what makes it the LCP element.

export const HERO_NAME = "I'm Wentao";

// Metrics only — no colour or paint classes. Each copy adds its own fill:
// the base gets `text-foreground text-shimmer`, the overlay gets `text-caustic`.
export const HERO_NAME_METRICS =
  "block font-bold tracking-[-0.045em] leading-[0.92] text-[clamp(2.5rem,9vw,7rem)]";
