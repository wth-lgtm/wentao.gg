"use client";

import { useRef } from "react";
import { Activity, TrendingUp, Trophy, Wallet } from "lucide-react";

export type Tab = "leaderboard" | "positions" | "trades" | "analytics";

/**
 * How a tab was activated. The rack does not care, but the page does: selection is
 * mirrored into the URL, and an arrow key that pushes a history entry means a reader
 * who walks the four tabs has to press Back four times to leave. Automatic activation
 * is kept exactly as it was — this only lets the caller tell a deliberate destination
 * from a pass over one.
 */
export type TabActivation = "pointer" | "keyboard";

// The address label used to be appended INSIDE two of these tabs. That was wrong
// three ways: it duplicated across Positions and Trades, the container's `uppercase`
// mangled the hex into 0XA822...D748, and at flex-1 the extra text wrapped to a
// second line and grew the whole bar. The focused address now lives once, in its own
// strip below, where it can't fight the tab layout.
//
// `short` is the phone form. At 390px each of the four cells is 84px wide; a 14px
// icon, its 6px gap and an 11px mono label tracked at 0.16em leave room for five
// glyphs, and "LEADERBOARD" measures ~92px on its own. The old fix for that was
// `truncate`, which ellipsised three of the four labels ("LEADER… / POSITI… /
// ANALYT…") — a primary nav control must never ellipsize its own name. So the phone
// gets a deliberately chosen abbreviation instead of a cut string, and `aria-label`
// carries the full word so the accessible name never shortens.
const TABS: { id: Tab; label: string; short: string; icon: React.ElementType }[] = [
  { id: "leaderboard", label: "Leaderboard", short: "BOARD", icon: Trophy },
  { id: "positions", label: "Positions", short: "POSNS", icon: Wallet },
  { id: "trades", label: "Trades", short: "TAPE", icon: Activity },
  { id: "analytics", label: "Analytics", short: "STATS", icon: TrendingUp },
];

export default function TabNavigation({
  activeTab,
  onChange,
}: {
  activeTab: Tab;
  onChange: (tab: Tab, via: TabActivation) => void;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // A tablist is ONE tab stop, not four: the selected tab holds tabIndex 0 and the
  // arrows move between them (WAI-ARIA APG, tabs pattern). Before this, Tab walked
  // every tab individually and the arrows did nothing at all.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = TABS.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    // Home/End otherwise scroll the page out from under the control.
    event.preventDefault();
    // Automatic activation: selection follows focus, which is what a click already
    // does — there is no confirm step on the pointer path, so adding one on the
    // keyboard path would make the two disagree. Positions and Trades do fetch, but
    // they render their own loading state exactly as they do for a click.
    //
    // "keyboard" is the one thing the caller cannot infer: arrowing across the rack is
    // four activations of a control the reader is still moving through, not four
    // destinations. Enter and Space fall through the switch above to the browser's own
    // button activation, so they arrive as "pointer" — which is what they are, a
    // deliberate choice of this tab.
    onChange(TABS[next].id, "keyboard");
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Whale tracker views"
      className="hl-rack mb-3 grid grid-cols-4 gap-1 rounded-xl border border-border bg-card p-1"
    >
      {TABS.map((tab, index) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            id={`hl-tab-${tab.id}`}
            role="tab"
            aria-selected={active}
            // page.tsx mounts only the selected panel, so this IDREF resolves for the
            // selected tab and dangles for the other three. That is the trade for not
            // mounting four panels of live data at once, and it is the only tab whose
            // "go to controlled element" gesture has anywhere to go.
            aria-controls={`hl-panel-${tab.id}`}
            // The visible text is the abbreviation below sm, so the name is stated
            // here and stays the full word at every width.
            aria-label={tab.label}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id, "pointer")}
            onKeyDown={(event) => onKeyDown(event, index)}
            // text-background over the plate's bg-foreground fill (globals.css
            // .hl-tab-plate) — the label and the plate are SIBLINGS, the label above it
            // at z-10, so the two are changed together: white on the dark theme's
            // --accent measured 3.68:1, and foreground on background is 16.09:1 dark,
            // 19.79:1 light. Accent stays for focus rings.
            className={`hl-tab relative flex min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] whitespace-nowrap transition-colors ${
              active ? "text-background" : "text-[var(--legend)] hover:text-foreground"
            }`}
          >
            {/* Exactly one lit plate exists at a time, and it belongs to the selected
                tab — which is what keeps the rack reading as a single control rather
                than four independent buttons. Switching tabs therefore unmounts this
                span and mounts another; hlPlateSeat seats it at its new berth on the
                300ms beat. */}
            {active && <span aria-hidden className="hl-tab-plate" />}
            <Icon size={14} aria-hidden className="relative z-10 shrink-0" />
            {/* Both spans stay in the DOM — the hidden one is display:none, so it is
                out of the accessibility tree and out of the layout, and whichever
                survives is the name if aria-label ever goes missing. */}
            <span className="relative z-10 sm:hidden">{tab.short}</span>
            <span className="relative z-10 hidden sm:inline">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
