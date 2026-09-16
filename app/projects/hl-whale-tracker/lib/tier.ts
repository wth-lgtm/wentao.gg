/**
 * The rank language of the board, in one place.
 *
 * Tier is static font WEIGHT on the berth plate (.hl-plate[data-tier] in globals.css),
 * not a medal colour. The gold/silver/bronze scheme it replaced was carried by hue
 * alone and measured 1.74:1, 2.31:1 and 2.90:1 against the light --card (#f4f4f5) —
 * all three below WCAG AA.
 *
 * It lives here because that retirement only ever landed on the desktop row: commit
 * eee25e4 rewrote LeaderboardRow and never touched TraderCard, so the phone kept
 * shipping the retired medals for two months while the definition sat inline in a
 * file the card does not import. Two layouts reading one exported function is what
 * stops the next divergence.
 */

/** The tiers globals.css actually styles. Nothing else may reach `data-tier`. */
export type RankTier = "1" | "2" | "3" | "4";

/**
 * A `switch` rather than `rank <= 3 ? String(rank) : "4"`, because the ternary
 * stringifies its input: rank 0, -1 or 2.5 would emit `data-tier="2.5"`, which
 * matches no rule and renders a plate with no weight and no tier-4 --legend colour.
 * Out of range collapses to the one tier that is always defined.
 */
export function tierOf(rank: number): RankTier {
  switch (rank) {
    case 1:
      return "1";
    case 2:
      return "2";
    case 3:
      return "3";
    default:
      return "4";
  }
}
