"use client";

import { useEffect } from "react";
import "../../lib/frameFramer";
import { onFrame } from "../../lib/frame";
import { atBeat, BEAT_MS } from "../../lib/mechanism";
import { getScroll, scrollStoreCalls, subscribeScroll, type ScrollState } from "../../lib/scrollStore";
import { getSiteMotion, subscribeSiteMotion } from "../../lib/siteMotion";
import {
  PIN_CHAPTERS, PIN_QUERY, STAGE_CLEAR, TOOLBAR_PX, TWO_COLUMN_MIN,
  activeItemAt, beatCount, beatOf, beatToActive, chapterPin, createReadingLine, decideMode, headClamp, pickOwner,
  pinAtBeat, pinSetFromFlag, railHeadAt, readingLineActive, type ChapterLayout,
} from "../../lib/chapterList";
import { createCommit, type Commit } from "../../lib/chapterCommit";
import { emitChapterStep } from "../../lib/chapterBus";
import { correctPlace, snapshotPlace, type ChapterBox, type ChapterMode, type Place } from "../../lib/keepPlace";
import { packCorridor } from "../../lib/packCorridor";
import type { Rect } from "../../lib/fieldLayout";
import { getFieldPacks, onFieldPacks } from "../../lib/fieldPresence";

// THE ONE DIRECTOR of the reading chapters (DESIGN §4.2.3, E1). Mounted once on the home page; renders nothing.
// It owns every chapter's mode and drives the marks, imperatively, with no React state:
//
//   MODE. After document.fonts.ready it writes data-mode = pinned | flow | static on every [data-chapter] —
//   static when motion is not allowed (reduced motion or forced colours, read LIVE), flow when the window fails
//   PIN_QUERY (700 × 720, the Augnition gate) or the chapter is not in the pin set (OC-P), and pinned only when
//   its panel also fits the band (bandFits, 16 px of slack to pin, none to stay). Re-evaluated on resize,
//   orientation and zoom (a resize event), either media query changing, a list or the page resizing (text
//   spacing, fonts), never while the INDEX overlay is open; on a coarse pointer a height-only change under
//   120 px (iOS toolbars) is ignored. So the mode fits whatever window the visitor has, from a 360 px phone to a
//   2560 px desktop, with no size written anywhere.
//
//   KEEP YOUR PLACE. A flip snapshots one reading place from the layout still on screen, writes every mode in
//   one go, then applies ONE instant scrollTo (keepPlace.ts) with overflow-anchor held off until the second
//   frame. A resize restores the place from the last scroll rest while the reader is still there, and the place
//   at the last scroll frame (cached geometry, no layout read) once they have scrolled since.
//
//   MARKS. Each chapter's runtime subscribes to the scroll store only while it is within a viewport (an
//   IntersectionObserver, 100 % margin). In the read phase it turns the scroll into ONE target beat — pinned:
//   activeItemAt(raw pin over the stage's cached height); flow: the row that crossed the 62 % reading line —
//   and hands it to the commit, which steps `shown` toward it once per 100 ms boundary (the catch-up riffle).
//   A step writes data-active on the entry and its line, and --active-item on the section, inside the beat's
//   timeout: attribute writes only, no layout read. The pinned rail's fill (transform only) and --pin-progress
//   are written in the render phase, the head clamped to the next uncommitted row. At rest nothing is pending.
//
//   TITLES in the corridor between the jack packs (packCorridor.ts, O3), and keyboard focus inside a chapter
//   scrolled so its row is the marked one in the next frame (E10): pinned, to its beat; flow, onto the reading line.

type Mode = ChapterMode;
/** the elements, outside the chapters, a resize mid-scroll can anchor the reader's place on (placeFromCache) */
const ANCHOR_SELECTOR = "h2, h3, h4, li, article, p";
const FOLLOW_TAU_MS = BEAT_MS / 3; // the rail head closes a released gap in about one beat
// Review builds only (NEXT_PUBLIC_REVIEW_FLAGS=1, inlined at build): ?pin= and the ?chapterDebug surface with its
// callback counters. Every read of it is a build-time constant, so a production build compiles all of it out.
const REVIEW = process.env.NEXT_PUBLIC_REVIEW_FLAGS === "1";

interface Geometry {
  pageTop: number;
  height: number;
  stageH: number;
  railLen: number;
  /** each beat's rail y (px from the rail's top): the entry's dot for its first line, the line otherwise */
  rowYs: number[];
  /** each beat's row, page y (flow: what crosses the reading line) */
  beatTops: number[];
  /** each beat's row top relative to the stage's top (pinned: where the row sits in the docked stage) */
  rowRel: number[];
  listBottom: number;
}

interface Stats { callbacks: number; steps: number }

/**
 * An element's LAYOUT box in page coordinates (the offsetParent chain; transforms ignored): where the hero's h1 and
 * visitor card rest. Their entrance animates a translate for ≈ 300 ms after hydration, and a corridor read from
 * getBoundingClientRect then followed it — the title slid 16 px and back, logged as layout shifts. The jack field
 * reads the same boxes at its birth, after the entrance, so this is the composition it solves.
 */
function layoutRect(el: Element | null): Rect | null {
  if (!(el instanceof HTMLElement)) return null;
  let x = 0, y = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) { x += n.offsetLeft; y += n.offsetTop; }
  return { left: x, top: y, right: x + el.offsetWidth, bottom: y + el.offsetHeight };
}

class ChapterRuntime {
  readonly el: HTMLElement;
  readonly id: string;
  readonly layout: ChapterLayout;
  readonly beats: number;
  readonly stage: HTMLElement;
  readonly panel: HTMLElement;
  readonly dial: HTMLElement;
  readonly rail: HTMLElement;
  readonly fill: HTMLElement;
  readonly items: HTMLElement[];
  readonly subs: HTMLElement[];
  readonly dots: HTMLElement[];
  mode: Mode | null = null;
  geom: Geometry = { pageTop: 0, height: 0, stageH: 0, railLen: 0, rowYs: [], beatTops: [], rowRel: [], listBottom: 0 };
  readonly commit: Commit;
  readonly stats: Stats = { callbacks: 0, steps: 0 };
  pin = 0;
  engaged = false;
  target = -1;
  /** the target row's viewport y while engaged: how near the reader's eye (the reading line) this chapter's mark is */
  focusY = Number.NaN;
  corridor: { top: number; bottom: number } | null = null;
  private lineTarget = -1;
  private side: -1 | 1 = -1;
  private head = 0;
  private following = false;
  private lastT = 0;
  private written = { scale: Number.NaN, pin: Number.NaN };
  private io: IntersectionObserver | null = null;
  private near = false;
  private readonly onNear: (near: boolean) => void;

  constructor(el: HTMLElement, onNear: (near: boolean) => void) {
    this.onNear = onNear;
    this.el = el;
    this.id = el.dataset.chapter ?? "";
    this.layout = (el.dataset.layout ?? "1").split(",").map(Number);
    this.beats = beatCount(this.layout);
    this.stage = el.querySelector<HTMLElement>(".ch-stage")!;
    this.panel = el.querySelector<HTMLElement>(".ch-panel")!;
    this.dial = el.querySelector<HTMLElement>(".ch-dial")!;
    this.rail = el.querySelector<HTMLElement>(".ch-rail")!;
    this.fill = el.querySelector<HTMLElement>(".ch-rail-fill")!;
    this.items = [...el.querySelectorAll<HTMLElement>("li[data-item]")];
    this.dots = this.items.map((li) => li.querySelector<HTMLElement>(".ch-dot")!);
    this.subs = [];
    for (const s of el.querySelectorAll<HTMLElement>("[data-beat]")) this.subs[Number(s.dataset.beat)] = s;
    this.commit = createCommit({
      atBeat: (cb) => atBeat(cb),
      velocity: () => getScroll().velocity,
      onStep: (next, prev) => this.onStep(next, prev),
    });
  }

  /** the mode the first paint's CSS chose (before any data-mode): the stage is sticky only when pinned */
  cssMode(): Mode {
    return getComputedStyle(this.stage).position === "sticky" ? "pinned" : "flow";
  }

  currentMode(): Mode {
    return this.mode ?? this.cssMode();
  }

  /** layout reads, cached; never while scrolling (the director calls it on resize, fonts, mode flips) */
  measure(): void {
    const sy = window.scrollY;
    const r = this.el.getBoundingClientRect();
    const rail = this.rail.getBoundingClientRect();
    const stageTop = this.stage.getBoundingClientRect().top;
    const rowYs: number[] = [];
    const beatTops: number[] = [];
    for (let b = 0; b < this.beats; b++) {
      const a = beatToActive(b, this.layout);
      const sub = this.subs[b];
      if (a.sub === 0) {
        const dot = this.dots[a.item]?.getBoundingClientRect();
        const li = this.items[a.item]?.getBoundingClientRect();
        rowYs.push(dot ? dot.top + dot.height / 2 - rail.top : 0);
        beatTops.push(li ? li.top + sy : 0);
      } else {
        const s = sub?.getBoundingClientRect();
        rowYs.push(s ? s.top + 7 - rail.top : 0);
        beatTops.push(s ? s.top + sy : 0);
      }
    }
    const list = this.items[this.items.length - 1]?.getBoundingClientRect();
    this.geom = {
      pageTop: r.top + sy,
      height: r.height,
      stageH: this.stage.clientHeight,
      railLen: rail.height,
      rowYs,
      beatTops,
      rowRel: beatTops.map((t) => t - sy - stageTop),
      listBottom: list ? list.bottom + sy : r.bottom + sy,
    };
  }

  box(): ChapterBox {
    return { id: this.id, top: this.geom.pageTop, height: this.geom.height, mode: this.currentMode(), stageHeight: this.geom.stageH, beatTops: this.geom.beatTops, layout: this.layout };
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    const wasPinned = this.mode === "pinned";
    this.commit.clear();
    this.mode = mode;
    this.el.dataset.mode = mode;
    if (wasPinned || mode !== "pinned") {
      this.fill.style.removeProperty("transform");
      this.rail.style.removeProperty("--pin-progress");
      this.written = { scale: Number.NaN, pin: Number.NaN };
    }
    this.following = false;
    this.lineTarget = -1;
    if (mode === "static") {
      this.stopWatching();
      this.el.style.removeProperty("--active-item");
    } else {
      this.startWatching();
    }
  }

  private startWatching(): void {
    if (this.io) return;
    this.io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      if (e.isIntersecting) this.attach(); else this.detach();
    }, { rootMargin: "100% 0px" });
    this.io.observe(this.el);
  }

  private stopWatching(): void {
    this.io?.disconnect();
    this.io = null;
    this.detach();
  }

  private attach(): void {
    if (this.near) return;
    this.near = true;
    this.onNear(true);
  }

  /** leaving the viewport's neighbourhood: marks cleared synchronously, nothing pending (E22) */
  private detach(): void {
    const was = this.near;
    this.near = false;
    this.commit.clear();
    this.following = false;
    this.engaged = false;
    if (was) this.onNear(false);
  }

  get subscribed(): boolean { return this.near; }

  /**
   * READ phase: arithmetic on cached layout only. Sets this chapter's gate (engaged) and target beat; the
   * director then lets exactly one chapter own the marks (the accent is spent once per viewport) and hands the
   * owner's target to its commit. `line` is the page's one reading line (the director's, viewport px).
   */
  gate(s: Readonly<ScrollState>, line: number): void {
    if (REVIEW) this.stats.callbacks++;
    const g = this.geom;
    const vh = window.innerHeight;
    let target = -1;
    if (this.mode === "pinned") {
      const top = g.pageTop - s.y;
      this.pin = chapterPin(top, g.height, g.stageH);
      const stageTop = Math.min(Math.max(top, 0), top + g.height - g.stageH);
      this.engaged = stageTop < (2 * vh) / 3 && stageTop + g.stageH > vh / 3;
      this.side = this.pin < 0.5 ? -1 : 1;
      if (this.engaged) {
        target = activeItemAt(this.pin, this.layout).beat;
        this.focusY = stageTop + (g.rowRel[target] ?? 0);
      }
      onFrame("render", this.render);
    } else if (this.mode === "flow") {
      const listTop = (g.beatTops[0] ?? g.pageTop) - s.y;
      const listBottom = g.listBottom - s.y;
      // engaged from the moment the first row crosses the reading line until the list's bottom slides under the top
      // clear band (STAGE_CLEAR.top, the W. / INDEX marks), i.e. for as long as the CSS rail is on screen: a short
      // list resting wholly above the line (Education at the top of the screen after INDEX → Education or a hard
      // load of /#education) keeps its last crossed row marked, which is what the rail shows read — a full rail
      // always has its last row marked and its dots seated. (The pinned stage's middle-third release was not
      // enough: at 2560 × 1440 Education's list rests above vh / 3 at its own section top, rail full, dots grey.)
      this.engaged = listTop <= line && listBottom > STAGE_CLEAR.top;
      this.side = listTop > line ? -1 : 1;
      if (this.engaged) {
        this.lineTarget = readingLineActive(g.beatTops.map((t) => t - s.y), line, this.lineTarget);
        target = this.lineTarget;
        this.focusY = (g.beatTops[Math.max(0, target)] ?? g.pageTop) - s.y;
      } else {
        this.lineTarget = -1;
      }
    } else {
      this.engaged = false;
    }
    this.target = target;
  }

  /** the director's verdict for this frame: own the marks (the target) or clear them on the next beat */
  apply(owner: boolean): void {
    this.commit.setTarget(owner ? this.target : -1);
  }

  /** RENDER phase: the pinned rail — transform and --pin-progress only, nothing written that did not change */
  private readonly render = () => {
    if (REVIEW) this.stats.callbacks++;
    if (this.mode !== "pinned") return;
    const g = this.geom;
    if (!(g.railLen > 0)) return;
    const raw = railHeadAt(this.pin, this.layout, g.rowYs, g.railLen);
    const clamped = headClamp(raw, g.rowYs, this.commit.shown);
    const now = performance.now();
    if (this.following && clamped > this.head) {
      const dt = Math.min(100, now - this.lastT);
      this.head += (clamped - this.head) * (1 - Math.exp(-dt / FOLLOW_TAU_MS));
      if (clamped - this.head < 0.5) { this.head = clamped; this.following = false; }
      else onFrame("render", this.render);
    } else {
      this.head = clamped;
      this.following = false;
    }
    this.lastT = now;
    const scale = Math.round((this.head / g.railLen) * 10000) / 10000;
    const pin = Math.round(this.pin * 1000) / 1000;
    if (scale !== this.written.scale) { this.fill.style.transform = `scaleY(${scale})`; this.written.scale = scale; }
    if (pin !== this.written.pin) { this.rail.style.setProperty("--pin-progress", String(pin)); this.written.pin = pin; }
  };

  /** a committed step (inside the beat's timeout): attribute writes only */
  private onStep(next: number, prev: number): void {
    if (REVIEW) { this.stats.callbacks++; this.stats.steps++; }
    const a = next >= 0 ? beatToActive(next, this.layout) : null;
    const p = prev >= 0 ? beatToActive(prev, this.layout) : null;
    if (p) {
      if (!a || a.item !== p.item) this.items[p.item]?.removeAttribute("data-active");
      this.subs[prev]?.removeAttribute("data-active");
    }
    if (a) {
      this.items[a.item]?.setAttribute("data-active", "");
      this.subs[next]?.setAttribute("data-active", "");
      this.el.dataset.activeItem = String(a.item);
      this.el.dataset.activeSub = String(a.sub);
      this.el.style.setProperty("--active-item", String(a.item));
    } else {
      delete this.el.dataset.activeItem;
      delete this.el.dataset.activeSub;
      // the wheel rests on the end the reader left by, so a return never rolls through the whole range
      this.el.style.setProperty("--active-item", String(this.side < 0 ? 0 : this.items.length - 1));
    }
    emitChapterStep({ chapter: this.id, item: a?.item ?? -1, sub: a?.sub ?? -1, beat: next, itemChanged: (a?.item ?? -1) !== (p?.item ?? -1) });
    if (this.mode === "pinned") {
      if (next > prev && prev >= 0) { this.following = true; this.lastT = performance.now(); }
      onFrame("render", this.render);
    }
  }

  /**
   * A keyboard focus inside the chapter (SETUP phase, after the browser's own focus scroll): scroll so the focused
   * row is the one marked — pinned, to the middle of its beat's slot; flow, its row just past the reading line
   * (`line`), so the entry that lights is the one the focus ring is in. Smooth within three beats, instant beyond.
   */
  focusBeat(target: HTMLElement, line: number): void {
    if (this.mode !== "pinned" && this.mode !== "flow") return;
    const sub = target.closest<HTMLElement>("[data-beat]");
    const item = target.closest<HTMLElement>("[data-item]");
    const beat = sub ? Number(sub.dataset.beat) : item ? beatOf(Number(item.dataset.item), 0, this.layout) : -1;
    if (beat < 0 || beat === this.commit.shown) return;
    const g = this.geom;
    let y: number;
    if (this.mode === "pinned") {
      y = g.pageTop + pinAtBeat(beat, this.layout) * Math.max(0, g.height - g.stageH);
    } else {
      const top = g.beatTops[beat];
      if (top === undefined) return;
      const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      y = Math.min(maxY, Math.max(0, top - line + 12));
    }
    const far = this.commit.shown < 0 || Math.abs(beat - this.commit.shown) > 3;
    window.scrollTo({ top: Math.round(y), behavior: far ? "instant" : "smooth" });
  }

  dispose(): void {
    this.stopWatching();
    delete this.el.dataset.mode;
  }
}

interface DirectorDebug {
  readonly ready: boolean;
  readonly evaluations: number;
  readonly flips: number;
  readonly list: unknown[];
  /** every chapter callback that ran: the runtimes' gates, renders and steps, the director's own (scroll frame,
   *  scroll event, evaluation, rest capture, resize, focus, the correction frames) and the scroll store's */
  readonly callbacks: number;
  readonly callbackBreakdown: Record<string, number>;
  evaluate(): void;
  readonly restPlace: Place | null;
  readonly restStale: boolean;
  readonly liveY: number | null;
  readonly landHash: string | null;
  readonly corrections: unknown[];
}

function createDirector(): () => void {
  const html = document.documentElement;
  // ONE scroll subscription for the page, held only while some chapter is within a viewport of the screen
  let unsubscribe: (() => void) | null = null;
  let owner: ChapterRuntime | null = null;
  // the director's own callbacks, for the harness's zero-at-rest count (?chapterDebug; review builds only)
  const calls = { scrollFrame: 0, scrollEvent: 0, evaluate: 0, rest: 0, resize: 0, focus: 0, correction: 0 };
  const onNear = () => {
    const any = runtimes.some((rt) => rt.subscribed);
    if (any && !unsubscribe) { unsubscribe = subscribeScroll(onScroll); kick(); }
    else if (!any && unsubscribe) { unsubscribe(); unsubscribe = null; owner = null; liveY = null; }
    else if (any) kick();
  };
  const runtimes: ChapterRuntime[] = [...document.querySelectorAll<HTMLElement>("[data-chapter]")].map((el) => new ChapterRuntime(el, onNear));
  if (runtimes.length === 0) return () => {};

  // READ phase: every nearby chapter computes its gate and target; exactly ONE owns the marks, so two chapters
  // are never marked in one viewport (the accent is spent once per viewport). When two are engaged at once — a
  // released pinned stage still crossing the middle third while the next chapter's first row reaches the reading
  // line — the one whose target row is nearer the reading line (the reader's eye) owns them; the current owner
  // keeps them unless the other is nearer by more than HYSTERESIS_PX. A handover lands on one beat: the old
  // owner clears on the same boundary the new one docks on.
  const onScroll = (s: Readonly<ScrollState>) => {
    if (REVIEW) calls.scrollFrame++;
    if (printing()) return; // print is not a window: nothing relights while the page is laid out for paper
    // the scroll this frame, against the geometry cached before any resize still to be evaluated: where a resize
    // that arrives mid-scroll finds the reader (placeFromCache)
    if (!resizePending) liveY = s.y;
    const near = runtimes.filter((rt) => rt.subscribed);
    const line = readingLine();
    for (const rt of near) rt.gate(s, line);
    owner = pickOwner(near, line, owner);
    for (const rt of near) rt.apply(rt === owner);
  };
  const kickRead = () => onScroll(getScroll());
  /** re-derive every target from the scroll as it is now (after a mode flip, an attach, a measure) */
  const kick = () => { if (unsubscribe) onFrame("read", kickRead); };

  const pinMq = matchMedia(PIN_QUERY);
  const coarseMq = matchMedia("(pointer: coarse)");
  // PRINT IS NOT A WINDOW. Under print media PIN_QUERY ("screen and …") stops matching, and an evaluation would
  // flip every chapter to flow, relight the marks against the paper layout and, on the way back, correct the
  // reader's place (a print round trip moved a reader from mid-Experience to Education). While printing
  // (beforeprint/afterprint, or print media emulated) nothing evaluates, relights or takes a rest place; the
  // print CSS neutralises whatever marks were on screen, and afterwards one evaluation runs with no correction
  // unless the window itself changed.
  const printMq = matchMedia("print");
  let printEvent = false;
  let printDeferred = false;
  const printing = () => printEvent || printMq.matches;
  // THE reading line, one for the page: the flow gates, keep-your-place and the focus scroll all read it, and it
  // is re-measured on every evaluation (every resize the director accepts), so a height-only resize on a desktop
  // moves it with the window while iOS's toolbars do not (createReadingLine). The flow rail's CSS fill sits on
  // the same 62svh.
  const lineMeter = createReadingLine();
  const lineNow = () => lineMeter.at(window.innerWidth, html.clientHeight, coarseMq.matches);
  let lineY = lineNow();
  const readingLine = () => lineY;
  const pinSet = (REVIEW && pinSetFromFlag(window.location.search)) || PIN_CHAPTERS;
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);

  let ready = false;
  let pending = false;
  let disposed = false;
  let evaluations = 0;
  let flips = 0;
  let lastW = window.innerWidth;
  let lastH = window.innerHeight;
  let anchorRelease = 0;
  let resizePending = false;
  const debug = REVIEW && new URLSearchParams(window.location.search).has("chapterDebug");
  const corrections: unknown[] = [];
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  let restPlace: { place: Place; el: Element | null } | null = null;
  // KEEP-YOUR-PLACE ACROSS A RESIZE MID-SCROLL. The rest place is taken 160 ms after scrolling stops, so it is only
  // the reader's place while they are still there: any scroll of theirs since makes it stale (a phone rotated
  // during momentum, a window snapped mid-fling or mid-glide, DevTools opened mid-scroll — restoring the rest place
  // then threw the reader thousands of px back). A stale rest place gives way to the place at the last scroll
  // frame, computed from the geometry cached before the resize (pure arithmetic; no layout read while scrolling).
  // The director's own scrolls (a correction, a hash landing) are not the reader's.
  let restStale = true;
  let liveY: number | null = null;
  let ownScrollY: number | null = null;
  let readerScrolled = false;
  /** the page's top-level sections (main's children, the footer) at the last measure, and finer anchors inside the
   *  ones that are not chapters (their headings, list items, articles, paragraphs): where a resize mid-scroll finds
   *  the reader outside every chapter, from cached geometry alone */
  let sections: { el: Element; top: number }[] = [];
  let anchors: { el: Element; top: number; bottom: number }[] = [];
  let cachedVh = window.innerHeight;
  // A hard load of /#section lands on it once the modes are decided, unless the reader has already moved. The
  // browser's own fragment scroll is smooth here (html { scroll-behavior: smooth }) and can be cut short — by a
  // mode flip above the target, or by framer's keyframe measurement, which restores the scrollY it read
  // mid-glide (measured: /#education stopped 9 px down). Only on a fresh navigation: a reload or Back restores
  // the reader's own position, which wins.
  const navType = (performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? "navigate";
  let landHash: string | null = navType === "navigate" && window.location.hash.length > 1 ? decodeURIComponent(window.location.hash.slice(1)) : null;

  const indexOpen = () => document.body.style.overflow === "hidden";

  // the panel is the same width and type in flow and pinned (one grid), so its height here is its pinned height
  // (decideMode, chapterList.ts, holds the rule; the reads happen only where it needs them)
  const decide = (rt: ChapterRuntime, motion: boolean, stageH: number, narrow: boolean): Mode => {
    const pinQuery = pinMq.matches, inPinSet = !!pinSet[rt.id];
    if (!motion || !pinQuery || !inPinSet) return decideMode({ motion, pinQuery, inPinSet, panelH: 0, stageH, pinnedNow: false, narrow, dialH: 0 });
    const pinnedNow = rt.currentMode() === "pinned";
    return decideMode({ motion, pinQuery, inPinSet, panelH: rt.panel.offsetHeight, stageH, pinnedNow, narrow, dialH: narrow && pinnedNow ? rt.dial.offsetHeight : 0 });
  };

  /** the element at the viewport centre outside every chapter: the deepest one whose box spans the centre line */
  const centreElement = (y: number): Element | null => {
    const main = document.querySelector("main");
    const roots = [...(main?.children ?? []), ...document.querySelectorAll("body > footer")];
    let node: Element | undefined = roots.find((el) => { const r = el.getBoundingClientRect(); return r.top <= y && r.bottom > y; });
    for (let depth = 0; node && depth < 12; depth++) {
      const child: Element | undefined = [...node.children].find((c) => { const r = c.getBoundingClientRect(); return r.height > 0 && r.top <= y && r.bottom > y; });
      if (!child) break;
      node = child;
    }
    return node ?? null;
  };

  /** the reader's place in the layout on screen (fresh measures: layout reads, never while scrolling) */
  const snapshot = (): { place: Place; el: Element | null } => {
    measureAll();
    const sy = window.scrollY, vh = window.innerHeight;
    const centreY = sy + vh / 2;
    const inside = runtimes.find((rt) => centreY >= rt.geom.pageTop && centreY < rt.geom.pageTop + rt.geom.height);
    // inside a chapter with nothing marked yet, the chapter's own box is the anchor; outside, the centre element
    const el = inside ? inside.el : centreElement(vh / 2);
    const place = snapshotPlace({
      scrollY: sy,
      viewportH: vh,
      readingLine: readingLine(),
      chapters: runtimes.map((rt) => rt.box()),
      shown: Object.fromEntries(runtimes.map((rt) => [rt.id, rt.commit.shown])),
      centre: el ? { key: "element", pageTop: el.getBoundingClientRect().top + sy } : null,
    });
    return { place, el };
  };

  /** every cached measure (layout reads): the chapters, the top-level sections, the viewport */
  function measureAll(): void {
    for (const rt of runtimes) rt.measure();
    const sy = window.scrollY;
    const main = document.querySelector("main");
    const roots = [...(main?.children ?? []), ...document.querySelectorAll("body > footer")];
    sections = roots.map((el) => ({ el, top: el.getBoundingClientRect().top + sy }));
    anchors = [];
    for (const root of roots) {
      if (root.hasAttribute("data-chapter")) continue;
      for (const el of root.querySelectorAll(ANCHOR_SELECTOR)) {
        if (el.closest("[data-chapter]")) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0) anchors.push({ el, top: r.top + sy, bottom: r.bottom + sy });
      }
    }
    cachedVh = window.innerHeight;
  }

  /** the reader's place at scroll `y` in the CACHED layout (pure: no layout read) — inside a chapter, its shown
   *  row or pin; outside, the deepest cached anchor whose box spans the viewport centre (the tightest box), else
   *  the top-level section there. A section's top alone missed a resize that reflows the inside of a tall section
   *  but leaves its top where it was (1440 → 1000 mid-Projects: the centre block drifted 52 px, the correction a
   *  no-op). */
  const placeFromCache = (y: number): { place: Place; el: Element | null } => {
    const centreY = y + cachedVh / 2;
    let sec: { el: Element; top: number } | null = null;
    for (const s of sections) if (s.top <= centreY) sec = s;
    let tight: { el: Element; top: number; bottom: number } | null = null;
    for (const a of anchors) if (a.top <= centreY && a.bottom > centreY && (!tight || a.bottom - a.top < tight.bottom - tight.top)) tight = a;
    const at = tight ?? sec;
    const place = snapshotPlace({
      scrollY: y,
      viewportH: cachedVh,
      readingLine: readingLine(),
      chapters: runtimes.map((rt) => rt.box()),
      shown: Object.fromEntries(runtimes.map((rt) => [rt.id, rt.commit.shown])),
      centre: at ? { key: "element", pageTop: at.top } : null,
    });
    return { place, el: at ? at.el : null };
  };

  // the place at the last scroll rest: what a resize restores (by the time a resize event runs, svh units and
  // every wrap have already moved, so the layout on screen can no longer say where the reader was)
  const captureRest = () => {
    if (REVIEW) calls.rest++;
    restTimer = undefined;
    if (!ready || disposed || resizePending || indexOpen() || printing()) return;
    // not while a step is pending or held (a jump reads as a fling until the velocity zeroes): the place is the
    // entry the reader will see marked, so wait for it
    if (runtimes.some((rt) => rt.commit.pending || rt.commit.held)) { restTimer = setTimeout(captureRest, 120); return; }
    restPlace = snapshot();
    restStale = false;
    ownScrollY = null;
  };
  const onScrollEvent = () => {
    if (REVIEW) calls.scrollEvent++;
    if (resizePending || printing()) return;
    // a scroll that lands where the director itself just scrolled is its own; any other is the reader's
    const own = ownScrollY !== null && Math.abs(window.scrollY - ownScrollY) < 2;
    if (!own) { ownScrollY = null; restStale = true; readerScrolled = true; }
    clearTimeout(restTimer);
    restTimer = setTimeout(captureRest, 160);
  };
  /** the director's own instant scroll (a correction, a landing): not the reader's, so it leaves the rest place fresh */
  const scrollOwn = (y: number) => {
    ownScrollY = Math.round(y);
    window.scrollTo({ top: Math.round(y), behavior: "instant" });
    if (unsubscribe) liveY = window.scrollY;
  };

  const placeDials = () => {
    const packs = getFieldPacks();
    const w = html.clientWidth, h = html.clientHeight;
    // at their page-top position, as the scene solves them (fieldLayout.atPageTop of a rect read at scroll 0)
    const h1 = layoutRect(document.querySelector("[data-hero-h1]"));
    const card = layoutRect(document.querySelector("[data-hero-card]"));
    const span = document.querySelector<HTMLElement>("[data-hero-h1] span");
    const font = span ? parseFloat(getComputedStyle(span).fontSize) : null;
    for (const rt of runtimes) {
      const mode = rt.currentMode();
      if (!packs || mode === "static" || window.innerWidth < TWO_COLUMN_MIN) {
        rt.corridor = null;
        rt.el.style.removeProperty("--ch-dial-top");
        continue;
      }
      const d = rt.dial.getBoundingClientRect();
      const c = packCorridor({
        width: w, height: h, h1FontPx: font,
        hero: { h1, card },
        packs, x: [d.left, d.right], clear: STAGE_CLEAR,
      });
      rt.corridor = c ? { top: c.top, bottom: c.bottom } : null;
      if (!c || c.bottom - c.top < d.height) { rt.el.style.removeProperty("--ch-dial-top"); continue; }
      const top = Math.round(Math.min(c.bottom - d.height, Math.max(c.top, c.top + (c.bottom - c.top - d.height) / 2)));
      rt.el.style.setProperty("--ch-dial-top", `${top}px`);
    }
  };

  const evaluate = () => {
    if (REVIEW) calls.evaluate++;
    if (disposed || !ready) return;
    if (printing()) { printDeferred = true; return; }
    if (indexOpen()) { pending = true; return; }
    pending = false;
    evaluations++;
    const resized = resizePending;
    resizePending = false;
    const motion = getSiteMotion().allowed;
    const stageH = probe.offsetHeight || window.innerHeight;
    const narrow = window.innerWidth < TWO_COLUMN_MIN;
    const next = runtimes.map((rt) => decide(rt, motion, stageH, narrow));
    const firstTime = runtimes.some((rt) => rt.mode === null);
    const changed = runtimes.some((rt, i) => rt.currentMode() !== next[i]);
    if (!changed && !firstTime && !resized) {
      lineY = lineNow();
      measureAll();
      placeDials();
      kick();
      return;
    }
    // one reading place: after a resize, the rest place if the reader has not scrolled since, else the place at
    // the last scroll frame in the layout cached before the resize, else (no chapter near) the layout on screen;
    // without a resize, the layout still on screen
    const held = !resized ? snapshot()
      : restPlace && !restStale ? restPlace
      : liveY !== null ? placeFromCache(liveY)
      : snapshot();
    // the place was read against the old line; the correction and every gate from here read the new one
    lineY = lineNow();
    if (changed || resized) {
      if (changed) flips++;
      html.style.setProperty("overflow-anchor", "none");
    }
    // every mode in one go
    runtimes.forEach((rt, i) => rt.setMode(next[i]));
    measureAll();
    placeDials();
    if (changed || resized) {
      const pageTopOf = (key: string): number | null => (key === "element" && held.el && held.el.isConnected ? held.el.getBoundingClientRect().top + window.scrollY : null);
      const correct = () => {
        const y = correctPlace(held.place, { chapters: runtimes.map((rt) => rt.box()), pageTopOf, readingLine: readingLine() });
        if (debug) {
          corrections.push({ place: held.place, y, from: window.scrollY, resized, changed });
          if (corrections.length > 20) corrections.shift();
        }
        if (y !== null && Math.abs(window.scrollY - y) >= 1) scrollOwn(y);
        else if (unsubscribe) liveY = window.scrollY;
      };
      readerScrolled = false;
      correct();
      cancelAnimationFrame(anchorRelease);
      anchorRelease = requestAnimationFrame(() => {
        if (REVIEW) calls.correction++;
        // a second look after the next layout (late images, fonts), then anchoring comes back and the rest place
        // is taken afresh from the corrected layout
        measureAll();
        correct();
        anchorRelease = requestAnimationFrame(() => {
          if (REVIEW) calls.correction++;
          html.style.removeProperty("overflow-anchor");
          // the corrected place stands until the reader's next scroll (the marks re-dock on the next beat)
          if (held.place.kind !== "none" && !readerScrolled) { restPlace = held; restStale = false; }
        });
      });
    }
    if (firstTime) landOnHash();
    kick();
  };

  /** a hard load of /#experience (or any section): land its top once the modes are decided (E1) */
  const landOnHash = () => {
    const id = landHash;
    landHash = null;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    // the landing supersedes a pending second-look correction (it would put back the place read mid-glide)
    cancelAnimationFrame(anchorRelease);
    const land = () => {
      const y = Math.round(el.getBoundingClientRect().top + window.scrollY);
      if (Math.abs(window.scrollY - y) >= 2) scrollOwn(y);
    };
    land();
    anchorRelease = requestAnimationFrame(() => {
      land();
      anchorRelease = requestAnimationFrame(() => html.style.removeProperty("overflow-anchor"));
    });
  };
  // any input of the reader's own cancels the landing
  const cancelLanding = () => { landHash = null; };
  const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  for (const t of inputs) window.addEventListener(t, cancelLanding, { passive: true, once: true });

  const request = () => { if (ready && !disposed) onFrame("read", evaluate); };

  const onResize = () => {
    if (REVIEW) calls.resize++;
    if (printing()) return; // the paper's size is not the window's (checked again when printing ends)
    const w = window.innerWidth, h = window.innerHeight;
    // iOS toolbars: a height-only change under TOOLBAR_PX on a coarse pointer moves nothing
    if (coarseMq.matches && w === lastW && Math.abs(h - lastH) < TOOLBAR_PX) return;
    lastW = w; lastH = h;
    resizePending = true;
    clearTimeout(restTimer);
    request();
  };

  // keyboard focus in a pinned or flow chapter: next frame's setup phase, after the browser's own scroll-into-view,
  // so the lit entry is the one the focus ring is in (in flow the reading line alone once lit whichever row the
  // browser's focus scroll happened to park there). Mouse focus never scrolls.
  const onFocusIn = (e: FocusEvent) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rt = runtimes.find((r) => r.el.contains(t));
    if (!rt || (rt.mode !== "pinned" && rt.mode !== "flow")) return;
    let visible = false;
    try { visible = t.matches(":focus-visible"); } catch { visible = false; }
    if (visible) onFrame("setup", () => { if (REVIEW) calls.focus++; rt.focusBeat(t, readingLine()); });
  };

  // the INDEX overlay sets body.style.overflow = "hidden" (Navigation.tsx): the classic scrollbar goes and
  // widths change for a frame, so nothing is measured while it is open; one evaluation runs when it closes
  const bodyObserver = new MutationObserver(() => { if (pending && !indexOpen()) request(); });
  bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["style"] });

  const ro = new ResizeObserver(request);
  const main = document.querySelector("main");
  if (main) ro.observe(main);
  for (const rt of runtimes) { ro.observe(rt.el); ro.observe(rt.panel); ro.observe(rt.dial); }

  const resumeFromPrint = () => {
    if (printing()) return;
    const deferred = printDeferred;
    printDeferred = false;
    if (window.innerWidth !== lastW || window.innerHeight !== lastH) onResize();
    else if (deferred) request();
  };
  const onBeforePrint = () => { printEvent = true; };
  const onAfterPrint = () => { printEvent = false; resumeFromPrint(); };
  window.addEventListener("beforeprint", onBeforePrint);
  window.addEventListener("afterprint", onAfterPrint);
  printMq.addEventListener("change", resumeFromPrint);

  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScrollEvent, { passive: true });
  pinMq.addEventListener("change", request);
  const offMotion = subscribeSiteMotion(request);
  const offField = onFieldPacks(request);
  document.addEventListener("focusin", onFocusIn);

  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  (fonts ? fonts.ready : Promise.resolve()).then(() => {
    if (disposed) return;
    ready = true;
    onFrame("read", evaluate);
  });

  if (debug) {
    const w = window as unknown as { __chapters?: DirectorDebug };
    w.__chapters = {
      get ready() { return ready; },
      get evaluations() { return evaluations; },
      get flips() { return flips; },
      get callbacks() {
        const own = Object.values(calls).reduce((n, v) => n + v, 0);
        return runtimes.reduce((n, rt) => n + rt.stats.callbacks, 0) + own + scrollStoreCalls.listener + scrollStoreCalls.timer;
      },
      get callbackBreakdown() {
        return { runtimes: runtimes.reduce((n, rt) => n + rt.stats.callbacks, 0), ...calls, storeListener: scrollStoreCalls.listener, storeTimer: scrollStoreCalls.timer };
      },
      get list() {
        return runtimes.map((rt) => ({
          id: rt.id, mode: rt.mode, shown: rt.commit.shown, target: rt.target, engaged: rt.engaged, pending: rt.commit.pending,
          held: rt.commit.held, subscribed: rt.subscribed, pin: rt.pin, callbacks: rt.stats.callbacks, steps: rt.stats.steps,
          panelH: rt.panel.offsetHeight, stageH: rt.geom.stageH, height: rt.geom.height, pageTop: rt.geom.pageTop,
          rowYs: rt.geom.rowYs, railLen: rt.geom.railLen, beatTops: rt.geom.beatTops, corridor: rt.corridor, layout: rt.layout,
          owner: rt === owner,
        }));
      },
      evaluate: () => evaluate(),
      get restPlace() { return restPlace ? restPlace.place : null; },
      get restStale() { return restStale; },
      get liveY() { return liveY; },
      get landHash() { return landHash; },
      get corrections() { return corrections; },
    };
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(anchorRelease);
    clearTimeout(restTimer);
    window.removeEventListener("beforeprint", onBeforePrint);
    window.removeEventListener("afterprint", onAfterPrint);
    printMq.removeEventListener("change", resumeFromPrint);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScrollEvent);
    for (const t of inputs) window.removeEventListener(t, cancelLanding);
    pinMq.removeEventListener("change", request);
    offMotion();
    offField();
    document.removeEventListener("focusin", onFocusIn);
    bodyObserver.disconnect();
    ro.disconnect();
    probe.remove();
    unsubscribe?.();
    unsubscribe = null;
    for (const rt of runtimes) rt.dispose();
    html.style.removeProperty("overflow-anchor");
    delete (window as unknown as { __chapters?: DirectorDebug }).__chapters;
  };
}

export default function ChapterDirector() {
  useEffect(() => createDirector(), []);
  return null;
}
