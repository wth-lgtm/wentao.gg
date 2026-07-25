import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "../../lib/ogCard";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Whale Tracker — Hyperliquid trader leaderboard";

export default function Image() {
  return renderOgCard({
    title: "Whale Tracker",
    subtitle: "Hyperliquid's top traders by PnL and volume",
    footer: "WENTAO.GG",
  });
}
