import * as THREE from "three";

import { LOGO_CONTOURS } from "@/lib/logo/contours";

/* Extrudes the traced wordmark into a solid. Ported from the standalone
 * chrome viewer so both renderings of the logo share one source of truth. */

/** Ray-casting point-in-polygon, used to decide which outer contour a
 * hole belongs to (the wordmark has counters inside several letters). */
function pointInRing(pt: [number, number], ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a[1] > pt[1] !== b[1] > pt[1] &&
      pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function buildShapes(): THREE.Shape[] {
  const outers = LOGO_CONTOURS.filter((c) => c.area > 0).map((c) => c.pts);
  const holes = LOGO_CONTOURS.filter((c) => c.area < 0).map((c) => c.pts);

  return outers.map((o) => {
    const s = new THREE.Shape(o.map((p) => new THREE.Vector2(p[0], p[1])));
    holes
      .filter((h) => pointInRing(h[0], o))
      .forEach((h) =>
        s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1])))),
      );
    return s;
  });
}

/**
 * Recomputes normals with a crease angle: bevels blend smoothly while the
 * front and back caps stay perfectly flat. Three's own computeVertexNormals
 * averages across the cap/bevel seam, which smears the mirror reflection
 * across the face and kills the chrome read.
 */
function shadeNormals(geo: THREE.BufferGeometry, angleDeg: number) {
  const pos = geo.attributes.position.array as Float32Array;
  const n = pos.length / 9;
  const COS = Math.cos((angleDeg * Math.PI) / 180);

  let zmax = -1e9;
  let zmin = 1e9;
  for (let i = 2; i < pos.length; i += 3) {
    if (pos[i] > zmax) zmax = pos[i];
    if (pos[i] < zmin) zmin = pos[i];
  }

  const key = (i: number) =>
    `${Math.round(pos[i * 3] * 1e5)}_${Math.round(pos[i * 3 + 1] * 1e5)}_${Math.round(pos[i * 3 + 2] * 1e5)}`;

  const weld = new Map<string, number[]>();
  const fn = new Float32Array(n * 3);
  const fa = new Float32Array(n);
  const grp = new Int8Array(n);
  const E = 1e-6;

  for (let f = 0; f < n; f++) {
    const a = f * 9;
    const ux = pos[a + 3] - pos[a];
    const uy = pos[a + 4] - pos[a + 1];
    const uz = pos[a + 5] - pos[a + 2];
    const vx = pos[a + 6] - pos[a];
    const vy = pos[a + 7] - pos[a + 1];
    const vz = pos[a + 8] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1e-12;
    fa[f] = len;
    fn[f * 3] = nx / len;
    fn[f * 3 + 1] = ny / len;
    fn[f * 3 + 2] = nz / len;

    const z0 = pos[a + 2];
    const z1 = pos[a + 5];
    const z2 = pos[a + 8];
    const front =
      Math.abs(z0 - zmax) < E && Math.abs(z1 - zmax) < E && Math.abs(z2 - zmax) < E;
    const back =
      Math.abs(z0 - zmin) < E && Math.abs(z1 - zmin) < E && Math.abs(z2 - zmin) < E;
    grp[f] = front ? 1 : back ? 2 : 0;
    if (grp[f]) continue; // caps are planar: exact axis normal, no blending

    for (let k = 0; k < 3; k++) {
      const kk = key(f * 3 + k);
      let arr = weld.get(kk);
      if (!arr) {
        arr = [];
        weld.set(kk, arr);
      }
      arr.push(f * 3 + k);
    }
  }

  const out = new Float32Array(pos.length);
  for (let f = 0; f < n; f++) {
    if (!grp[f]) continue;
    const nz = grp[f] === 1 ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      out[(f * 3 + k) * 3] = 0;
      out[(f * 3 + k) * 3 + 1] = 0;
      out[(f * 3 + k) * 3 + 2] = nz;
    }
  }

  weld.forEach((corners) => {
    const cl: {
      sx: number; sy: number; sz: number;
      mx: number; my: number; mz: number;
      g: number; cs: number[];
    }[] = [];
    corners.forEach((ci) => {
      const f = (ci / 3) | 0;
      const nx = fn[f * 3];
      const ny = fn[f * 3 + 1];
      const nz = fn[f * 3 + 2];
      let hit = null;
      for (const c of cl) {
        if (c.g === grp[f] && nx * c.mx + ny * c.my + nz * c.mz > COS) {
          hit = c;
          break;
        }
      }
      if (!hit) {
        hit = { sx: 0, sy: 0, sz: 0, mx: nx, my: ny, mz: nz, g: grp[f], cs: [] };
        cl.push(hit);
      }
      hit.sx += nx * fa[f];
      hit.sy += ny * fa[f];
      hit.sz += nz * fa[f];
      const l = Math.hypot(hit.sx, hit.sy, hit.sz) || 1;
      hit.mx = hit.sx / l;
      hit.my = hit.sy / l;
      hit.mz = hit.sz / l;
      hit.cs.push(ci);
    });
    cl.forEach((c) =>
      c.cs.forEach((ci) => {
        out[ci * 3] = c.mx;
        out[ci * 3 + 1] = c.my;
        out[ci * 3 + 2] = c.mz;
      }),
    );
  });

  geo.setAttribute("normal", new THREE.BufferAttribute(out, 3));
}

/** Centred on the origin so it spins about its own middle. */
export function buildLogoGeometry(depth = 0.34, bevel = 0.02) {
  const body = Math.max(0.01, depth - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(buildShapes(), {
    depth: body,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 5,
    steps: 1,
    curveSegments: 1,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(
    -(bb.max.x + bb.min.x) / 2,
    -(bb.max.y + bb.min.y) / 2,
    -(bb.max.z + bb.min.z) / 2,
  );
  shadeNormals(geo, 35);
  return geo;
}
