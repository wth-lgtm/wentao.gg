// The chapters' step events (DESIGN §4.2.2): one event per committed step, for listeners that are not the row
// marks themselves — Projects' flap board (PR 2) and the travelling glass (PR 5). Synchronous, inside the
// step's beat timeout; a listener must not read layout.

export interface ChapterStep {
  chapter: string;
  /** −1 when the marks cleared */
  item: number;
  sub: number;
  beat: number;
  itemChanged: boolean;
}

const listeners = new Set<(e: ChapterStep) => void>();

export function onChapterStep(cb: (e: ChapterStep) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function emitChapterStep(e: ChapterStep): void {
  for (const cb of [...listeners]) cb(e);
}
