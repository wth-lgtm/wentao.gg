import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "../../lib/ogCard";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt =
  "Whale Tracker — Hyperliquid's top 50 traders by PnL, ROI and volume, with positions, fills and board analytics";

export default function Image() {
  return renderOgCard({
    title: "Whale Tracker",
    // ROI, not omitted, and the three tabs the card never mentioned. The subtitle read
    // "by PnL and volume" while the board's middle column is ROI — the same omission the
    // layout's own description was rewritten to fix — and it described a leaderboard the
    // page outgrew two tabs ago.
    subtitle: "Top 50 by PnL, ROI and volume · positions · fills · analytics",
    footer: "WENTAO.GG",
  });
}
