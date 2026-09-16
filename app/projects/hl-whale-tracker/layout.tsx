import { Metadata } from "next";

// The description used to promise "PnL, win rate, and Sharpe ratio". `grep -rni
// 'sharpe\|win rate'` over this feature matched that one line and nothing else: the
// board is PnL / ROI / Volume, and `winRate` is only the upstream field name for ROI
// (types.ts:49). So the search snippet advertised two metrics the page has never had.
const TITLE = "HL Whale Tracker | Wentao";
const DESCRIPTION =
  "Hyperliquid's top 50 traders by PnL, ROI and volume across 24H, 7D, 30D and all-time, with live positions, recent fills and board-wide analytics.";

// openGraph and twitter are declared in full, not partially. Metadata is INHERITED by
// every child segment, so a layout that set only `twitter: { card }` left the root's
// block in place: every share of this route previewed as og:title "wentao.GG" with the
// homepage bio as its description, over the whale tracker's own image. Same pattern as
// app/projects/poweropps/layout.tsx, whose live tags are correct for that reason.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/projects/hl-whale-tracker" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    // Without this the inherited og:url points crawlers at the homepage as the
    // canonical object for this page.
    url: "/projects/hl-whale-tracker",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function HLWhaleTrackerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
