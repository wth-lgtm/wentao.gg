"use client";

import { useEffect, useSyncExternalStore } from "react";
import "../lib/frameFramer";
import { getServerSiteMotion, getSiteMotion, subscribeSiteMotion, type SiteMotionState } from "../lib/siteMotion";

// The motion policy (DESIGN §3.4). Before first paint the blocking theme script in layout.tsx has already
// written html[data-site-motion] = "on" | "off" from the two media queries; after hydration this keeps it LIVE
// (a visitor can turn Reduce Motion or forced colours on with the page open) and gives every component the
// same live answer through useSiteMotion(). Importing it also wires app/lib/frame.ts to framer's batcher
// (frameFramer.ts), so the page has one DOM clock from the first client module on.

/** The live policy: { allowed, reduced, forcedColors, finePointer }. Server render and hydration see all false. */
export function useSiteMotion(): SiteMotionState {
  return useSyncExternalStore(subscribeSiteMotion, getSiteMotion, getServerSiteMotion);
}

export default function SiteMotion() {
  useEffect(() => {
    // subscribing attaches the media-query listeners, which rewrite the attribute on every change
    const sync = () => { document.documentElement.dataset.siteMotion = getSiteMotion().allowed ? "on" : "off"; };
    sync();
    return subscribeSiteMotion(sync);
  }, []);
  return null;
}
