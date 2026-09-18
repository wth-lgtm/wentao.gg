import { test } from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three";
import { ENV, KEY, environmentScene, jackGeometry } from "../app/lib/jackMaterials";

// The object was lifted out of ConnectorField.tsx without a behaviour change; these pin the
// numbers the card was tuned to so a hero-side edit cannot drift them by accident. What the
// jack wears is tested in glass-look.test.ts (the table) and jack-glass.test.ts (the material).

test("one key light, up and to the right, and the one-plane environment — the card's numbers", () => {
  assert.deepEqual(KEY, { position: [6, 8, 2.5], intensity: 2.2 });
  assert.deepEqual(ENV, { plane: [6, 4], position: [5, 6, 4], intensity: 4, floor: 0.15 });
});

test("the environment scene and the geometry are singletons: one plane at the key's side over a grey floor, one lathe with the ao bake", () => {
  const s = environmentScene();
  assert.equal(environmentScene(), s);
  assert.equal(s.children.length, 1);
  const plane = s.children[0] as THREE.Mesh;
  assert.deepEqual([plane.position.x, plane.position.y, plane.position.z], [5, 6, 4]);
  assert.ok((s.background as THREE.Color).r === 0.15);
  const g = jackGeometry();
  assert.equal(jackGeometry(), g);
  assert.ok(g.getAttribute("ao"), "the per-vertex ao bake, kept for a future finish, unread by the glass");
});
