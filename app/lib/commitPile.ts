// The card's second reading of its own data: what the physics pile beside the activity
// grid is allowed to claim. Kept pure so the mapping can be tested without a DOM.

import type { CommitDay } from "./githubStats";

export interface Piece {
  /** The grid's five-step level of the day this commit landed on. */
  level: number;
}

const DAY_MS = 86_400_000;

/** The activity grid's ramp; the pile colours its pieces with the same function. */
export function levelFor(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

/**
 * One piece per commit the payload DATES, coloured by its day's level, oldest day first
 * so the pour lays the quarter down as sediment. Never padded to the repo's commit total:
 * the route only dates the commits inside the window, and level 0 means "a day with no
 * commits" in the legend under the grid — a commit cannot sit on one of those, so a
 * padding piece would contradict the legend and assert a count the data does not know.
 */
export function piecesForDays(days: readonly CommitDay[]): Piece[] {
  const pieces: Piece[] = [];
  for (const day of days) {
    const level = levelFor(day.count);
    for (let i = 0; i < day.count; i++) pieces.push({ level });
  }
  return pieces;
}

/**
 * The UTC day the route regenerated on, recovered from the `windowStart` it reports
 * (commitWindowStart puts that `weeks * 7 + slackDays` days before its own today). The
 * payload is served for up to 15 minutes past a 5-minute regeneration, and Vercel can
 * hold a stale copy across a UTC midnight, so the client compares this with its own
 * today before drawing the newest column: a day the snapshot never saw is unknown, not
 * an empty cell. Null when the field is missing or unparsable — never a guessed date.
 */
export function snapshotDay(
  windowStart: string | null | undefined,
  weeks: number,
  slackDays = 1,
): string | null {
  if (!windowStart) return null;
  const start = Date.parse(`${windowStart}T00:00:00Z`);
  if (Number.isNaN(start)) return null;
  return new Date(start + (weeks * 7 + slackDays) * DAY_MS).toISOString().slice(0, 10);
}
