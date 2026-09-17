// The activity grid's five-step ramp, kept out of the component so the board's colour
// rule can be tested without a DOM.

/** Commits on one UTC day → the grid's level 0–4. */
export function levelFor(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}
