import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// E13: three.js stays out of the home page's first chunk. verify-field.mjs `initialJs` checks the BUILT chunks;
// this checks the SOURCE: the static import closure of the home route (app/layout.tsx + app/page.tsx) — every
// `import … from`, side-effect `import "…"` and `export … from`, but not `import()` / `dynamic(() => import())`,
// which are chunk boundaries — must never reach `three` or `@react-three/*`.

const ROOT = path.join(import.meta.dirname, "..");
const STATIC = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : path.resolve(path.dirname(from), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function closure(entries: string[]): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const stack = entries.map((e) => path.join(ROOT, e));
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f) || !/\.(ts|tsx|mjs|js)$/.test(f)) continue;
    files.add(f);
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const m of src.matchAll(STATIC)) {
      if (/^\s*import\s+type\b/.test(m[0].trim()) || /^\s*export\s+type\b/.test(m[0].trim())) continue;
      const spec = m[1];
      const r = resolve(f, spec);
      if (r) stack.push(r);
      else if (!spec.startsWith(".")) packages.set(spec, path.relative(ROOT, f));
    }
  }
  return { files, packages };
}

test("the home route's static import closure never reaches three or @react-three/*", () => {
  const { files, packages } = closure(["app/layout.tsx", "app/page.tsx"]);
  const offenders = [...packages].filter(([p]) => p === "three" || p.startsWith("three/") || p.startsWith("@react-three/"));
  assert.deepEqual(offenders, [], `three reached from: ${offenders.map(([p, f]) => `${f} → ${p}`).join(", ")}`);
  // the closure really does include the chapter machinery and the jack field's gate (so the test is not vacuous)
  const rel = [...files].map((f) => path.relative(ROOT, f));
  for (const must of ["app/components/JackField.tsx", "app/lib/mechanism.ts", "app/lib/frame.ts"]) assert.ok(rel.includes(must), `${must} is in the closure`);
  assert.ok(!rel.includes("app/components/JackFieldScene.tsx"), "the scene stays behind dynamic()");
});
