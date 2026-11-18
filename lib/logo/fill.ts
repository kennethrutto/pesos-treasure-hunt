import { LOGO_CONTOURS } from "@/lib/logo/contours";

/* Points that fill the wordmark, for planting things in its shape.
 *
 * Separate from geometry.ts on purpose: that module extrudes the mark into a
 * solid and pulls in three.js to do it, and this one answers a different
 * question — "is this spot inside the letters?" — in plain numbers. The hunt
 * needs the second without paying for the first, and a test or a script can
 * use it without a WebGL context.
 *
 * Coordinates come out in the contours' own space, x and y both roughly
 * -1..1, origin centred. The caller scales.
 */

/** Ray-casting point-in-polygon. Same method as geometry.ts uses to match
 * holes to outers; duplicated rather than exported across because the two
 * modules deliberately do not depend on each other. */
function inRing(x: number, y: number, ring: readonly (readonly [number, number])[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Inside the letterforms: within some outer contour and not inside a hole.
 *
 * The hole test is global rather than per-outer. Matching each counter to
 * its parent letter is what geometry.ts has to do — an ExtrudeGeometry needs
 * holes attached to the right Shape — but for a yes/no fill test the counters
 * never overlap a different letter, so "inside any hole" is the same answer
 * and needs no containment pass. */
export function insideLogo(x: number, y: number): boolean {
  let hit = false;
  for (const c of LOGO_CONTOURS) {
    if (c.area > 0 && inRing(x, y, c.pts)) {
      hit = true;
      break;
    }
  }
  if (!hit) return false;
  for (const c of LOGO_CONTOURS) {
    if (c.area < 0 && inRing(x, y, c.pts)) return false;
  }
  return true;
}

export type LogoPoint = { x: number; y: number };

/**
 * Fills the mark on a regular grid, then shuffles the result.
 *
 * A grid rather than random darts because even coverage is what makes the
 * letterforms legible — random sampling clumps, and a clump inside a stroke
 * reads as a blob while the gap beside it reads as a break in the letter.
 *
 * Shuffled because the caller hands these out to hedge lumps in order, and
 * an unshuffled grid fills the mark top-to-bottom: if there are fewer lumps
 * than points, an in-order list draws the top half of the logo and nothing
 * below it. Shuffling means a short list still describes the whole mark,
 * just more sparsely.
 *
 * Deterministic shuffle, so the same call gives the same arrangement and a
 * re-render never reshuffles the planting.
 *
 * The default step is chosen to OVERSHOOT: it yields ~1190 points against
 * the ~980 hedge lumps a 13x13 maze produces, so every lump has somewhere to
 * go and none of the maze has to sink. The caller takes as many as it has
 * lumps, and because the list is shuffled that subset still covers the whole
 * mark rather than a corner of it. At this spacing (0.225 world units against
 * a ~0.5 lump) the clumps interpenetrate, which is what makes the strokes
 * read as one solid hedge instead of a dotted line.
 */
export function logoFillPoints(step = 0.03): LogoPoint[] {
  const pts: LogoPoint[] = [];
  for (let y = -1; y <= 1; y += step) {
    for (let x = -1; x <= 1; x += step) {
      if (insideLogo(x, y)) pts.push({ x, y });
    }
  }

  // xorshift, seeded fixed: same planting every time.
  let s = 0x9e3779b9;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  return pts;
}
