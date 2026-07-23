"use client";

import { useEffect, useState } from "react";

// Posts once on mount to /api/visit (the server dedups by cookie) and shows the unique
// visitor total. Renders nothing until a real number arrives — no placeholder flash, and
// nothing shows if the counter isn't configured yet (count === null).
export default function VisitorCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/visit", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && typeof d?.count === "number") setCount(d.count);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (count === null) return null;

  return (
    <>
      <span aria-hidden>·</span>
      <span className="tabular-nums">{count.toLocaleString()} visitors</span>
    </>
  );
}
