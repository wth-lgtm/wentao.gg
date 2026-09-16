// The INDEX overlay and the page eyebrows drifted apart in the 2/5 redesign: the menu was
// renumbered 01 About … 05 Connect while the sections kept the 01–04 the 1/5 redesign gave
// them, so four of the five index entries landed on a section captioned with a different
// number. One list, read by both, is the only way that can't happen again.

export const SECTIONS = [
  { n: "01", name: "About", id: "about" },
  { n: "02", name: "Experience", id: "experience" },
  { n: "03", name: "Education", id: "education" },
  { n: "04", name: "Projects", id: "projects" },
  { n: "05", name: "Connect", id: "connect" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

// The id union makes a wrong folio a compile error, so the "" branch is unreachable.
export function numberOf(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.n ?? "";
}
