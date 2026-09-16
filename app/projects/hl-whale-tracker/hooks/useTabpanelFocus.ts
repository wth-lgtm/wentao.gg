"use client";

import { useCallback, useEffect, useRef } from "react";

// Whether a tabpanel belongs in the tab sequence is a question about what it currently
// CONTAINS, so it is measured rather than declared.
//
// The tablist is one Tab stop (roving tabindex), so Tab out of the rack goes to
// whatever follows the panel — and a panel holding no control is skipped entirely, its
// content unreachable by keyboard. The APG tabs pattern answers that by putting such a
// panel into the sequence itself. But the inverse is just as real a defect: a tabindex
// on a panel that DOES hold controls buys the reader a stop on a non-interactive div
// before the first real one.
//
// Declaring it per panel got both wrong here, because focusability is a property of the
// STATE, not the panel. Analytics has an explorer link per LeaderCard when it has rows
// and nothing focusable in its loading and empty branches; Trades has the Orders/Tape
// segmented control only in its loaded branch — five of its six branches (no address,
// loading, error, no data, no fills) render no control at all, and a visitor can open
// TAPE with no trader selected. Enumerating those branches in page.tsx also dates
// instantly: a panel that gains a retry button in one of its error states would silently
// keep a redundant stop.
//
// So: ask the DOM. The attribute is set imperatively rather than through React state
// because it is a readout of the rendered result — routing it back through a render
// would mean re-rendering the panel to describe the panel. React never sets `tabIndex`
// on these wrappers, so nothing fights over the attribute.

/** What the browser puts in the tab sequence without being asked. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Returns a ref for the active tabpanel wrapper. Attach the same ref to every panel —
 * page.tsx mounts exactly one at a time, and the ref is detached from the outgoing
 * panel before it attaches to the incoming one.
 */
export function useTabpanelFocus() {
  const observer = useRef<MutationObserver | null>(null);

  // The observer outlives any single render, so it is torn down with the page.
  useEffect(() => () => observer.current?.disconnect(), []);

  return useCallback((panel: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (panel === null) {
      return;
    }
    const measure = () => {
      if (panel.querySelector(FOCUSABLE) === null) {
        panel.setAttribute("tabindex", "0");
        return;
      }
      // The panel is about to stop being focusable, and the reader may be STANDING on
      // it: Tab into a panel that held no control, then the fetch resolves underneath.
      // Removing the attribute then leaves focus on an element the browser no longer
      // considers focusable, and where the next Tab resumes from is browser-specific —
      // so the reader either walks on from here or is dropped to <body> and restarts the
      // whole sequence at the top of the page. Handing focus to the first control the
      // panel now has keeps their place, and it is the element Tab would have reached
      // next in any case. Guarded on the panel ITSELF holding focus: a control inside it
      // is already where we would be sending them.
      const parked = document.activeElement === panel;
      panel.removeAttribute("tabindex");
      if (parked) panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
    measure();
    // A panel's focusability changes when its CONTENT does — a fetch resolving, a
    // window switching, an error clearing. childList + subtree catches all of those
    // without the hook having to know which state it is looking at. Attributes are
    // deliberately not observed, so `measure`'s own setAttribute cannot re-trigger it.
    observer.current = new MutationObserver(measure);
    observer.current.observe(panel, { childList: true, subtree: true });
  }, []);
}
