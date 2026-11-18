import { useEffect, useState } from "react";
import * as THREE from "three";

import type { GardenPalette } from "@/lib/huntBoards";

/** One channel of a leaf, as the palette describes it: the generator's
 * brightness scaled and lifted, then clamped. */
function chan(v: number, [mul, add]: readonly [number, number]): number {
  return Math.min(255, Math.floor(v * mul + add));
}

/* Surfaces for the garden, drawn at runtime.
 *
 * Flat colours on boxes are what make a scene read as Minecraft: real
 * paving has joints, real turf has a mowing direction, real hedge has
 * leaves and crevices. None of that needs a photograph — it needs texture,
 * and a canvas can draw all three in a few milliseconds.
 *
 * Generated rather than shipped because a set of 2K photographic tiles is
 * several megabytes of repository and a licence to keep track of, for a
 * page whose whole point is that it loads. These are a few hundred
 * kilobytes of GPU memory and nothing on the wire.
 *
 * Built once and cached at module scope: the maze re-renders often, and
 * re-rasterising the same canvas on every one is the kind of cost that
 * only shows up on a phone.
 */

/** Deterministic noise so a reload does not reshuffle the grain. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext("2d")! };
}

/** Scatters fine per-pixel grain over whatever has been drawn. This is what
 * stops a flat fill reading as plastic under a directional light. */
function grain(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: () => number,
  amount: number,
  step = 1,
) {
  const image = ctx.getImageData(0, 0, size, size);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4 * step) {
    const n = (rand() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  ctx.putImageData(image, 0, 0);
}

/* ---------- paving ---------- */

/** Sawn limestone flags, four to a tile.
 *
 * Mid-grey rather than near-white on purpose. Stone bright enough to read
 * as sunlit in the material clips to paper under a daylight key and loses
 * every joint and edge in it — the light supplies the brightness, the
 * texture only has to supply the form.
 *
 * Joints are drawn as a soft dark trough rather than a hairline: a
 * one-pixel line aliases into a dotted mess the moment the camera is not
 * square to it, which at this angle it never is. */
function buildPaving() {
  const SIZE = 1024;
  const SLABS = 4;
  const { canvas, ctx } = makeCanvas(SIZE);
  const rand = mulberry(0x5eed1);
  const cell = SIZE / SLABS;

  // The mortar bed the flags are set into.
  ctx.fillStyle = "#5d584e";
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let y = 0; y < SLABS; y++) {
    for (let x = 0; x < SLABS; x++) {
      const j = 6;
      const px = x * cell + j;
      const py = y * cell + j;
      const w = cell - j * 2;

      // Each flag is cut from its own block, so no two match.
      const base = 138 + Math.floor(rand() * 30);
      ctx.fillStyle = `rgb(${base}, ${base - 5}, ${base - 17})`;
      ctx.fillRect(px, py, w, w);

      // Mottling within the flag — cloudy limestone, not poured concrete.
      for (let i = 0; i < 90; i++) {
        const r = 6 + rand() * 46;
        const d = rand() > 0.5;
        ctx.fillStyle = d
          ? `rgba(96,90,78,${0.03 + rand() * 0.07})`
          : `rgba(206,199,182,${0.03 + rand() * 0.07})`;
        ctx.beginPath();
        ctx.arc(px + rand() * w, py + rand() * w, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // A lit top-left arris and a shaded bottom-right one. This is what
      // makes a flag read as a solid block with thickness.
      ctx.strokeStyle = "rgba(232,226,210,0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py + w);
      ctx.lineTo(px, py);
      ctx.lineTo(px + w, py);
      ctx.stroke();

      ctx.strokeStyle = "rgba(58,54,46,0.45)";
      ctx.beginPath();
      ctx.moveTo(px + w, py);
      ctx.lineTo(px + w, py + w);
      ctx.lineTo(px, py + w);
      ctx.stroke();

      // Weathering that collects along the joint.
      ctx.fillStyle = "rgba(74,70,58,0.16)";
      ctx.fillRect(px, py + w - 5, w, 5);
      ctx.fillRect(px + w - 5, py, 5, w);
    }
  }

  // Quarry speckle across the whole surface.
  const rand2 = mulberry(0x11a3);
  for (let i = 0; i < 14000; i++) {
    const l = rand2() > 0.5 ? 245 : 60;
    ctx.fillStyle = `rgba(${l},${l},${l - 8},${0.05 + rand2() * 0.12})`;
    ctx.fillRect(rand2() * SIZE, rand2() * SIZE, 1 + rand2() * 2, 1 + rand2() * 2);
  }

  grain(ctx, SIZE, rand, 20, 2);

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 16;
  map.colorSpace = THREE.SRGBColorSpace;

  const bump = new THREE.CanvasTexture(canvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;

  return { map, bump };
}

/* ---------- turf ---------- */

/** Mown lawn: broad stripes, then blade-scale grain across them.
 *
 * The stripes are the thing that makes turf read as kept rather than as a
 * field — the reference photograph has them, and without them a lawn at
 * this distance is an unbroken slab of colour.
 *
 * Red for the Pop Up season, like the hedge: a lawn gone over to autumn
 * rather than a green one with red planting on it, because the season is
 * the whole garden turning, not a few beds of it. */
function buildTurf(p: GardenPalette) {
  const SIZE = 1024;
  const { canvas, ctx } = makeCanvas(SIZE);
  const rand = mulberry(0x6a5511);

  ctx.fillStyle = p.turf.base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  /* Mown bands, softened at their edges. A hard-edged band reads as a
   * printed stripe; a real one is where the roller laid the blades over, and
   * it fades across a few centimetres. */
  const band = SIZE / 6;
  for (let i = 0; i < 6; i++) {
    const g = ctx.createLinearGradient(0, i * band, 0, (i + 1) * band);
    const up = i % 2 === 0;
    const a = 0.055;
    g.addColorStop(0, `rgba(${up ? "255,255,255" : "0,0,0"},${a * 0.3})`);
    g.addColorStop(0.5, `rgba(${up ? "255,255,255" : "0,0,0"},${a})`);
    g.addColorStop(1, `rgba(${up ? "255,255,255" : "0,0,0"},${a * 0.3})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, i * band, SIZE, band);
  }

  /* Deliberately NO broad tonal patches. They read beautifully on one tile
   * and then repeat across the lawn as a grid of identical pale discs,
   * which is the single loudest tell that a surface is tiled. Everything
   * below is blade-scale, and blade-scale detail tiles invisibly. */

  // Blades. Short strokes along the mowing direction.
  ctx.lineWidth = 1;
  for (let i = 0; i < 22000; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const dark = rand() > 0.5;
    ctx.strokeStyle = dark ? p.turf.bladeDark : p.turf.bladeLight;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y + 2 + rand() * 4);
    ctx.stroke();
  }

  grain(ctx, SIZE, rand, 18);

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 16;
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/* ---------- hedge ---------- */

/** Clipped box hedge.
 *
 * Built back to front — a near-black interior, then four passes of leaves
 * getting smaller and lighter. That ordering is what gives it depth: the
 * gaps between the top leaves fall through to shadow instead of to more
 * leaf, which is the difference between foliage and a painted wall.
 *
 * The leaves are red — maroon in the mass, scarlet at the tips — for the
 * Pop Up season. Every hedge, every tree and the mark they walk into are
 * skinned from this one canvas, so this is where the season is set.
 *
 * Returned with a bump map as well, because hedge is the surface where the
 * light most has to break up across the face. Flat shading on a box is
 * precisely the read we are trying to lose. */
function buildHedge(p: GardenPalette) {
  const SIZE = 1024;
  const { canvas, ctx } = makeCanvas(SIZE);
  const rand = mulberry(0x4e3a17);

  ctx.fillStyle = p.hedge.base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  /* `v` is the leaf's brightness, carried in the red channel and lifted
   * there: red carries under a third of the luminance green does, so a red
   * leaf drawn at the green one's values comes out near black on the lit
   * side of a hedge. Green and blue follow at a fixed fraction, which keeps
   * every leaf the same red at a different depth instead of drifting orange
   * as it lightens. */
  const leaf = (x: number, y: number, r: number, v: number, alpha: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    const ch = p.hedge.leaf;
    ctx.fillStyle = `rgba(${chan(v, ch.r)}, ${chan(v, ch.g)}, ${chan(v, ch.b)}, ${alpha})`;
    ctx.beginPath();
    // A leaf is a pointed ellipse, not a circle. At this density the shape
    // barely registers individually but it is what keeps the mass from
    // looking like gravel.
    ctx.ellipse(0, 0, r, r * (0.42 + rand() * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Deep mass.
  for (let i = 0; i < 9000; i++) {
    leaf(rand() * SIZE, rand() * SIZE, 5 + rand() * 11, 34 + rand() * 30, 0.9);
  }
  // Mid layer.
  for (let i = 0; i < 7000; i++) {
    leaf(rand() * SIZE, rand() * SIZE, 4 + rand() * 8, 62 + rand() * 40, 0.85);
  }
  // Sunlit tips, sparse — this is the layer that reads as growth.
  for (let i = 0; i < 4200; i++) {
    leaf(rand() * SIZE, rand() * SIZE, 3 + rand() * 6, 110 + rand() * 62, 0.8);
  }
  // A few bright new shoots.
  for (let i = 0; i < 900; i++) {
    leaf(rand() * SIZE, rand() * SIZE, 2 + rand() * 4, 168 + rand() * 46, 0.7);
  }

  // Broad shading so one face is not uniformly bright across its width.
  for (let i = 0; i < 60; i++) {
    const r = 60 + rand() * 210;
    ctx.fillStyle = `rgba(${p.hedge.shade},${0.05 + rand() * 0.09})`;
    ctx.beginPath();
    ctx.arc(rand() * SIZE, rand() * SIZE, r, 0, Math.PI * 2);
    ctx.fill();
  }

  grain(ctx, SIZE, rand, 26, 2);

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 16;
  map.colorSpace = THREE.SRGBColorSpace;

  const bump = new THREE.CanvasTexture(canvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;

  return { map, bump };
}

/* ---------- cache ---------- */

type Drawn = {
  paving: THREE.Texture;
  pavingBump: THREE.Texture;
  turf: THREE.Texture;
  hedge: THREE.Texture;
  hedgeBump: THREE.Texture;
};

/* One set per palette, not one set. Two editions of the hunt are on the site
 * at once and a player moves between them in a tap; a single cache would
 * hand the second one the first one's garden. Keyed by palette id, so the
 * set is still built once per season rather than once per mount. */
const cache = new Map<string, Drawn>();

export type GardenScale = {
  /** World units one turf tile covers. Its eight mown bands divide this. */
  turfTile: number;
  /** World units one paving tile covers. Four slabs divide this. */
  pavingTile: number;
  /** Size of the surface the paving is laid on, in world units. */
  pavingExtent: number;
  /** Size of the lawn, in world units. */
  turfExtent: number;
};

/** Null on the server, where there is no canvas to draw on. Callers render
 * with plain colours until the first client frame.
 *
 * Scale is applied here rather than by the caller: the textures are shared
 * and cached, so a component reaching in to set `repeat` on them is
 * reaching into everyone else's copy. */
export function gardenTextures(scale: GardenScale, palette: GardenPalette) {
  if (typeof document === "undefined") return null;
  let drawn = cache.get(palette.id);
  if (!drawn) {
    const hedge = buildHedge(palette);
    const paving = buildPaving();
    drawn = {
      paving: paving.map,
      pavingBump: paving.bump,
      turf: buildTurf(palette),
      hedge: hedge.map,
      hedgeBump: hedge.bump,
    };
    cache.set(palette.id, drawn);
  }

  const turfRepeat = scale.turfExtent / scale.turfTile;
  drawn.turf.repeat.set(turfRepeat, turfRepeat);
  const pavingRepeat = scale.pavingExtent / scale.pavingTile;
  drawn.paving.repeat.set(pavingRepeat, pavingRepeat);
  drawn.pavingBump.repeat.set(pavingRepeat, pavingRepeat);
  drawn.hedge.repeat.set(1.4, 1.4);
  drawn.hedgeBump.repeat.set(1.4, 1.4);

  return drawn;
}


/* ---------- photographs ---------- */

/* Real photographs beat anything drawn here, so if they are present they
 * win. Drop seamless, square tiles into public/garden/ and they are used
 * automatically:
 *
 *   public/garden/hedge.jpg   clipped foliage, close up
 *   public/garden/stone.jpg   paving, shot square on
 *   public/garden/turf.jpg    mown grass
 *
 * Each is optional and each is loaded independently, so one photograph
 * improves one surface without the others having to exist. A missing file
 * is not an error — it is the normal state until someone adds one.
 *
 * They MUST tile seamlessly. A photograph with a bright corner or an
 * uneven exposure repeats across the lawn as a visible grid, which looks
 * worse than the drawn version it replaced.
 *
 * And a photograph replaces the season along with the drawing. The drawn
 * surfaces are red; a photograph of green hedge dropped in here puts last
 * season's planting back on every wall of the maze. */

const PHOTO_NAMES = {
  hedge: "hedge.jpg",
  stone: "stone.jpg",
  turf: "turf.jpg",
} as const;

/** Under the palette's own folder — /garden/red/hedge.jpg — because a
 * photograph replaces the season along with the drawing, and one shared
 * folder would put whichever season was photographed on both editions. */
function photoPath(paletteId: string, key: PhotoKey): string {
  return `/garden/${paletteId}/${PHOTO_NAMES[key]}`;
}

type PhotoKey = keyof typeof PHOTO_NAMES;
type Photos = Partial<Record<PhotoKey, THREE.Texture>>;

const photoCache = new Map<string, Photos>();
const photoLoad = new Map<string, Promise<Photos>>();

function loadPhotos(paletteId: string): Promise<Photos> {
  const running = photoLoad.get(paletteId);
  if (running) return running;
  const loader = new THREE.TextureLoader();

  const started = Promise.all(
    (Object.keys(PHOTO_NAMES) as PhotoKey[]).map(
      (key) =>
        new Promise<[PhotoKey, THREE.Texture | null]>((resolve) => {
          loader.load(
            photoPath(paletteId, key),
            (t) => {
              t.wrapS = t.wrapT = THREE.RepeatWrapping;
              t.anisotropy = 16;
              t.colorSpace = THREE.SRGBColorSpace;
              resolve([key, t]);
            },
            undefined,
            // Absent is the default state, not a failure worth logging on
            // every visit.
            () => resolve([key, null]),
          );
        }),
    ),
  ).then((pairs) => {
    const out: Photos = {};
    for (const [key, tex] of pairs) if (tex) out[key] = tex;
    photoCache.set(paletteId, out);
    return out;
  });

  photoLoad.set(paletteId, started);
  return started;
}

export type GardenSurfaces = {
  paving: THREE.Texture;
  pavingBump: THREE.Texture;
  turf: THREE.Texture;
  hedge: THREE.Texture;
  hedgeBump: THREE.Texture;
  /** Which surfaces are coming from a photograph rather than the canvas. */
  photographic: PhotoKey[];
};

/** The drawn surfaces immediately, with any photographs swapped in as they
 * arrive. Never suspends and never throws: the garden renders on the first
 * frame either way, and a photograph landing later is a swap, not a gap. */
export function useGardenSurfaces(
  scale: GardenScale,
  palette: GardenPalette,
): GardenSurfaces | null {
  /* Kept per palette rather than as one set. Two editions are playable and
     a player moves between them in a tap: a single slot would hand the
     second one whatever the first had loaded until its own arrived. Keyed
     state also means nothing has to be cleared on the way in, which is what
     a setState in an effect body would have been. */
  const [loaded, setLoaded] = useState<Record<string, Photos>>(() =>
    Object.fromEntries(photoCache),
  );

  useEffect(() => {
    let live = true;
    // setState in a callback, not in the effect body — this is the
    // "subscribe to an external system" case the hooks rules allow.
    loadPhotos(palette.id).then((p) => {
      if (live && Object.keys(p).length) {
        setLoaded((prev) => (prev[palette.id] ? prev : { ...prev, [palette.id]: p }));
      }
    });
    return () => {
      live = false;
    };
  }, [palette.id]);

  const photos = loaded[palette.id] ?? photoCache.get(palette.id) ?? {};

  const drawn = gardenTextures(scale, palette);
  if (!drawn) return null;

  const turfRepeat = scale.turfExtent / scale.turfTile;
  const pavingRepeat = scale.pavingExtent / scale.pavingTile;
  if (photos.turf) photos.turf.repeat.set(turfRepeat, turfRepeat);
  if (photos.stone) photos.stone.repeat.set(pavingRepeat, pavingRepeat);
  if (photos.hedge) photos.hedge.repeat.set(1.4, 1.4);

  return {
    paving: photos.stone ?? drawn.paving,
    // A photograph doubles as its own height map: read as luminance, the
    // shading already in it is very close to the relief that caused it.
    pavingBump: photos.stone ?? drawn.pavingBump,
    turf: photos.turf ?? drawn.turf,
    hedge: photos.hedge ?? drawn.hedge,
    hedgeBump: photos.hedge ?? drawn.hedgeBump,
    photographic: (Object.keys(photos) as PhotoKey[]).filter((k) => photos[k]),
  };
}
