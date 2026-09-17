// The card's one pointer, shared by the CSS board and the canvas column. CommitHeatmap's
// listener writes it; the scene's frame loop reads it and binds `wake` so a move over the
// board (not the canvas) can still ask the demand frameloop for a frame — the scene is
// alive before the cursor reaches the column. A mutable channel rather than state on
// purpose: a setState per pointer move would re-render the card, the Canvas and every
// child on every pixel. Lives here, not in ConnectorField, because CommitHeatmap may only
// import that module through dynamic() — a runtime import would pull three.js into the
// card's chunk.

export interface PointerRig {
  /** −0.5..0.5 across the card, left to right */
  x: number;
  /** −0.5..0.5 down the card, top to bottom */
  y: number;
  /** client pixels of the last move */
  cx: number;
  cy: number;
  /** pixels travelled since the previous move — ~px per frame at a 60 Hz pointer, the wake ribbon's brush radius */
  speed: number;
  /** the pointer is on the card */
  over: boolean;
  wake: (() => void) | null;
  move(x: number, y: number, cx?: number, cy?: number): void;
  leave(): void;
  bind(wake: (() => void) | null): void;
}

export function createPointerRig(): PointerRig {
  return {
    x: 0,
    y: 0,
    cx: 0,
    cy: 0,
    speed: 0,
    over: false,
    wake: null,
    move(x, y, cx = 0, cy = 0) {
      // the first move after an enter has no previous point: a stale one would read as a flick
      this.speed = this.over ? Math.hypot(cx - this.cx, cy - this.cy) : 0;
      this.x = x;
      this.y = y;
      this.cx = cx;
      this.cy = cy;
      this.over = true;
      this.wake?.();
    },
    leave() {
      this.over = false;
      this.speed = 0;
      this.wake?.();
    },
    bind(wake) {
      this.wake = wake;
    },
  };
}
