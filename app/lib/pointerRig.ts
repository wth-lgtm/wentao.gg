// The card's one pointer, shared by the CSS board and the canvas tray. CommitHeatmap's
// listener writes it; the pile's frame loop reads it and binds `wake` so a move over the
// board (not the canvas) can still ask the demand frameloop for a frame. A mutable channel
// rather than state on purpose: a setState per pointer move would re-render the card, the
// Canvas and every Environment child on every pixel. Lives here, not in FloatingBackground,
// because CommitHeatmap may only import that module through dynamic() — a runtime import
// would pull three.js into the card's chunk.

export interface PointerRig {
  /** −0.5..0.5 across the card, left to right */
  x: number;
  /** −0.5..0.5 down the card, top to bottom */
  y: number;
  /** the pointer is on the card */
  over: boolean;
  wake: (() => void) | null;
  move(x: number, y: number): void;
  leave(): void;
  bind(wake: (() => void) | null): void;
}

export function createPointerRig(): PointerRig {
  return {
    x: 0,
    y: 0,
    over: false,
    wake: null,
    move(x, y) {
      this.x = x;
      this.y = y;
      this.over = true;
      this.wake?.();
    },
    leave() {
      this.over = false;
      this.wake?.();
    },
    bind(wake) {
      this.wake = wake;
    },
  };
}
