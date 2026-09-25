// Wires app/lib/frame.ts to framer-motion's frame batcher — the page's one DOM clock (E4). Imported for its
// side effect by client code only (SiteMotion, the ChapterDirector); tests never import it, because framer's
// batcher is a no-op under node. `frame` comes from framer-motion, which re-exports motion-dom's batcher;
// motion-dom itself is transitive and absent from package.json, so it is never imported directly.

import { cancelFrame, frame } from "framer-motion";
import { setScheduler, type FrameCallback, type Phase } from "./frame";

if (typeof window !== "undefined") {
  setScheduler({
    schedule: (phase: Phase, fn: FrameCallback) => { frame[phase](fn); },
    // cancelFrame removes the callback from every step; each wrapper is unique to one (callback, phase)
    cancel: (_phase: Phase, fn: FrameCallback) => { cancelFrame(fn); },
  });
}

export {};
