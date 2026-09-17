// Deterministic pseudo-random in [0, 1) from an index and a seed — the same value on the
// server, on every client and on every render, so nothing laid out from it can drift
// between hydration and paint, and the card's first frame is identical on every load.
// Not a stream: call it with the index you mean.
export function rand(i: number, seed: number): number {
  return Math.abs(Math.sin(i * 127.1 + seed * 311.7) * 43758.5453) % 1;
}
