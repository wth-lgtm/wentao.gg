import { Metadata } from "next";

export const metadata: Metadata = {
  title: "HL Whale Tracker | Wentao",
  description: "Track top Hyperliquid traders by PnL, win rate, and Sharpe ratio",
  alternates: { canonical: "/projects/hl-whale-tracker" },
  twitter: { card: "summary_large_image" },
};

export default function HLWhaleTrackerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
