"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { useGardenSurfaces } from "@/lib/gardenTextures";
import type { GardenPalette } from "@/lib/huntBoards";
import { buildLogoGeometry } from "@/lib/logo/geometry";
import { isOpen, type Maze } from "@/lib/maze";
import { logoFillPoints } from "@/lib/logo/fill";
import { position, RUN_SPEED, type Runner } from "@/lib/mazeRunner";

/* The maze becomes a garden, and the garden walks into the mark.
 *
 * One idea holds the whole scene together: **the canopy is the code**. Every
 * dark module of the QR is one clump of foliage, and each clump has two
 * homes — a place in the crown of a tree, and a square on the grid. Tapping
 * the tree moves them from one to the other. Nothing is created or destroyed
 * in the transition because there is only ever one set of leaves.
 *
 * ── Why it still scans ──────────────────────────────────────────────────
 * A beautiful QR code that no phone can read is a failure, so three things
 * here are load-bearing and should not be "improved" without a camera in
 * hand:
 *
 * 1. The camera is ORTHOGRAPHIC and, at rest in code form, looks straight
 *    down. A perspective camera makes off-centre clumps lean outward, so
 *    their tops cover a neighbouring module and the pattern rots from the
 *    edges inward. Orthographic has no lean at any distance.
 *
 * 2. Dark foliage on pale stone. Scanners read inverted codes unreliably, so
 *    the dark modules must be the dark thing. That the ground also has to
 *    wash from near-black to bone during the reveal is a happy accident: it
 *    is the most dramatic moment in the scene.
 *
 * 3. Module footprints touch and never move. Clumps vary in height and in
 *    shade — which is what stops it looking like a printed code — but from
 *    directly overhead a change in height is invisible, and that is the
 *    whole trick. Vary the footprints instead and the code dies.
 *
 * There is deliberately no post-processing. Bloom and chromatic aberration
 * are exactly the effects that would smear module edges into each other.
 */

/* Hedge height. Thickness is no longer a single number — the hedge is grown
 * from overlapping lumps, so its width is whatever they happen to make it,
 * which is the point. */
const WALL_H = 0.9;

/* Which way the runner faces, per Dir (N, E, S, W).
 *
 * Cell y maps to world z, so north is -z. Three.js meshes face +z at rest,
 * hence south is the zero: yaw = atan2(dx, dz) for each of the four. Held
 * as a table rather than computed because there are exactly four answers
 * and one of them is 0. */
const DIR_YAW = [Math.PI, Math.PI / 2, 0, -Math.PI / 2] as const;

/** How wide the finished mark stands, in cells. The contours run -1..1, so
 * this is the full span across. Sized against the maze it grows out of:
 * wider than the hedges it is made from would leave the mark floating in
 * lawn, narrower and the letters close up. */
const LOGO_SPAN = 15;

/** Seconds for the maze to become a garden, and for the tree to scatter
 * into the code. */
/* The finish mark. The geometry is 2 units across, so 0.3 puts it at 0.6 —
 * a shade under a cell, which keeps it clear of the hedges either side while
 * staying the largest thing on the floor. The hover is above the runner's
 * 0.2 radius so the two never read as one blob when you arrive on the cell. */
const FINISH_SCALE = 0.3;
const FINISH_HOVER = 0.42;

const REVEAL_SECONDS = 2.4;

/* Gravel between the hedges — the one surface that does not turn with the
 * season, because gravel is gravel in any garden. Everything that does
 * turn comes from the edition's palette; see lib/huntBoards.ts. */
const PATH_COLOR = new THREE.Color("#c8b68f");

type WallSegment = { x: number; z: number; horizontal: boolean };

/** One lump of hedge. */
type HedgeBlob = {
  x: number;
  z: number;
  y: number;
  sx: number;
  sy: number;
  sz: number;
  rot: number;
};

/** Hedge is grown from overlapping lumps rather than extruded as a box.
 *
 * A box has four hard vertical corners and a dead-straight top, and no
 * amount of leaf texture hides them — a straight edge at this resolution
 * reads as a wall with a picture of a hedge on it. Three overlapping lumps
 * per cell edge, each turned and squashed differently, give the ragged
 * silhouette clipped planting actually has, and the ends overlap into the
 * neighbouring segment so a run of hedge is continuous. */
function hedgeBlobs(segments: WallSegment[]): HedgeBlob[] {
  const out: HedgeBlob[] = [];
  /* Five lumps to a cell edge, not three. Three overlapped just enough to
   * touch, which reads as a string of beads; five at the same width
   * interpenetrate along the run and merge into one ridge. The overlap has
   * to go ALONG the hedge — widening the lumps instead would close the
   * paths the maze is made of. */
  const PER = 5;
  segments.forEach((seg, si) => {
    for (let i = 0; i < PER; i++) {
      // -0.5 .. 0.5 along the segment, so the end lumps sit on the joint
      // with the next segment and the two merge.
      const t = i / (PER - 1) - 0.5;
      const j1 = (hash(si, 11 + i) - 0.5) * 0.16;
      const j2 = (hash(si, 23 + i) - 0.5) * 0.1;
      out.push({
        x: seg.x + (seg.horizontal ? t : j2),
        z: seg.z + (seg.horizontal ? j2 : t),
        y: 0.4 + j1 * 0.7,
        sx: 0.44 + hash(si, 31 + i) * 0.14,
        sy: 0.74 + hash(si, 41 + i) * 0.3,
        sz: 0.44 + hash(si, 47 + i) * 0.14,
        rot: hash(si, 53 + i) * Math.PI * 2,
      });
    }
  });
  return out;
}

/** Every wall the maze needs, deduplicated.
 *
 * Only the north and west side of each cell is emitted, plus the far edge of
 * the last row and column. Emitting all four sides of every cell would draw
 * each interior wall twice — harmless to look at, but it doubles the
 * instance count and makes the sink at reveal time visibly double-darken
 * where two walls overlap. */
function wallSegments(maze: Maze): WallSegment[] {
  const out: WallSegment[] = [];
  const { cols, rows } = maze;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isOpen(maze, x, y, 0)) out.push({ x, z: y - 0.5, horizontal: true });
      if (!isOpen(maze, x, y, 3)) out.push({ x: x - 0.5, z: y, horizontal: false });
    }
  }
  for (let x = 0; x < cols; x++) {
    if (!isOpen(maze, x, rows - 1, 2)) out.push({ x, z: rows - 0.5, horizontal: true });
  }
  for (let y = 0; y < rows; y++) {
    if (!isOpen(maze, cols - 1, y, 1)) out.push({ x: cols - 0.5, z: y, horizontal: false });
  }
  return out;
}

/** Deterministic 0..1 from two integers — the same clump gets the same spot
 * in the crown on every frame, and the same tree comes back for the same
 * `treeSeed` rather than reshuffling on each render. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type HuntSceneProps = {
  maze: Maze;
  /** The edition's colours. The garden is grown from this rather than from
   * constants, because two editions are playable and a player moves between
   * them in a tap. */
  garden: GardenPalette;
  runnerRef: React.RefObject<Runner>;
  /** Flips once when the finish is reached: the maze becomes the mark. */
  solved: boolean;
  reducedMotion: boolean;
};

const scratch = new THREE.Object3D();

export default function HuntScene({
  maze,
  garden,
  runnerRef,
  solved,
  reducedMotion,
}: HuntSceneProps) {
  const revealRef = useRef(0);


  /* The season's tints, built once per palette. These go into instanced
     meshes, where a fresh THREE.Color every render is garbage the GPU never
     sees. */
  const groundLawn = useMemo(() => new THREE.Color(garden.lawn), [garden]);
  const hedgeTones = useMemo(
    () => garden.hedgeTones.map((c) => new THREE.Color(c)),
    [garden],
  );
  const treeTones = useMemo(
    () => garden.treeTones.map((c) => new THREE.Color(c)),
    [garden],
  );

  const walls = useMemo(() => wallSegments(maze), [maze]);
  const hedge = useMemo(() => hedgeBlobs(walls), [walls]);

  /* Where each lump of hedge ends up: a point inside the wordmark.
   *
   * The maze does not dissolve and a logo appear — the same planting walks
   * from one arrangement to the other, which is why the hedge is what draws
   * the mark rather than a model of it. Nothing is created or destroyed.
   *
   * The fill points are shuffled by logoFillPoints, and that matters here:
   * lumps take them in order, so taking the first ~980 of ~1190 still covers
   * the whole mark rather than drawing its top half. The overshoot is
   * deliberate — every lump gets somewhere to go, so the maze is spent on
   * the mark rather than half of it sinking. The sink path in the frame loop
   * is the guard for a maze bigger than the mark can hold, not the norm. */
  const logoTargets = useMemo(() => {
    const half = LOGO_SPAN / 2;
    return logoFillPoints().map((p) => ({
      x: p.x * half,
      /* Contour y is screen-up; the ground plane's z runs the other way, so
       * without the flip the mark lands mirrored top to bottom. */
      z: -p.y * half,
    }));
  }, []);

  /* Canopies on the lawn outside the maze. Placed on a ring wide enough to
   * clear the outer hedge, jittered so they do not read as a planted circle.
   *
   * They belong to the maze, not to the code: by the time the pattern forms
   * they are gone. A dark blob sitting in a code's quiet zone is exactly the
   * thing that stops it being found. */
  const gardenTrees = useMemo(() => {
    const ringR = Math.max(maze.cols, maze.rows) * 0.78;
    return Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2 + hash(i, 61) * 0.34;
      const r = ringR + hash(i, 67) * ringR * 0.42;
      const base = 1.1 + hash(i, 71) * 1.7;
      return {
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        scale: base,
        // Squashed and stretched on each axis and turned to its own angle,
        // so a ring of sixteen reads as sixteen trees rather than one tree
        // stamped sixteen times.
        sx: base * (0.82 + hash(i, 131) * 0.46),
        sy: base * (0.7 + hash(i, 137) * 0.5),
        sz: base * (0.82 + hash(i, 139) * 0.46),
        color: treeTones[Math.floor(hash(i, 73) * treeTones.length)],
      };
    });
  }, [maze.cols, maze.rows, treeTones]);

  /* Both grids are centred on the origin so the camera never has to pan —
   * only the span it must fit changes between phases. */
  const mazeOffsetX = (maze.cols - 1) / 2;
  const mazeOffsetZ = (maze.rows - 1) / 2;

  /* Wider than the maze needs. The lawn, the trees and the outer hedge are
   * the point of the view — a frame cropped to the hedges alone is a
   * diagram, not a garden. */
  const mazeSpan = Math.max(maze.cols, maze.rows) * 1.4;
  /* What the camera has to fit once the logo has formed: the mark plus air
   * so it is not jammed against the frame. */
  const logoSpan = LOGO_SPAN * 1.5;
  /* The lawn only has to outrun the widest thing ever framed, which is now
   * the logo. Eight times it is far past any zoom or tilt, which is the
   * point: a plane that stops in mid-air with black past it is what gives
   * away that it is a plane. */
  const lawnExtent = logoSpan * 8;
  /* Built by hand, so released by hand: R3F only disposes what it created
   * itself, and these would otherwise leak a buffer and a program every
   * time the page is left and returned to. */
  const finishGeo = useMemo(() => buildLogoGeometry(0.5, 0.03), []);
  const finishMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(garden.finish.color),
        roughness: 0.34,
        metalness: 0.08,
        /* Lit from within a little. The garden's key light rakes across the
         * maze, so an unlit gold goes to brown in the hedge shadows — which
         * is exactly where a finish tends to sit. */
        emissive: new THREE.Color(garden.finish.emissive),
        emissiveIntensity: 0.75,
      }),
    [garden],
  );
  useEffect(
    () => () => {
      finishGeo.dispose();
      finishMat.dispose();
    },
    [finishGeo, finishMat],
  );

  const tex = useGardenSurfaces({
    // One mown band roughly every two units, two slabs to a maze cell —
    // which is the ratio the reference photograph reads at.
    turfTile: 9,
    turfExtent: lawnExtent,
    pavingTile: 2.2,
    pavingExtent: maze.cols + 1,
  }, garden);
  /* Fitted with room to spare rather than edge to edge: the result panel
   * sits over the bottom of the canvas, and a code with a button on its
   * corner is a code that does not decode. The extra margin is all quiet
   * zone, which only helps. */

  const wallsRef = useRef<THREE.InstancedMesh>(null);
  const wallGroupRef = useRef<THREE.Group>(null);
  const playerRef = useRef<THREE.Group>(null);
  /* The walk cycle's own clock. Driven by distance travelled rather than by
   * elapsed time, so the legs stop when the runner stops instead of jogging
   * on the spot at a dead end — and so the stride stays in step with the
   * ground at any speed. */
  const walkRef = useRef(0);
  const legLRef = useRef<THREE.Group>(null);
  const legRRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);
  const startRef = useRef<THREE.Mesh>(null);
  const finishRef = useRef<THREE.Group>(null);
  const finishSpinRef = useRef<THREE.Group>(null);
  const pathRef = useRef<THREE.Mesh>(null);
  const gardenRef = useRef<THREE.InstancedMesh>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);

  /* The maze arrangement, written once so the first frame is not empty.
   * From the moment a reveal starts the frame loop takes these over — it is
   * walking every lump to a new place, which cannot be done from an effect. */
  useLayoutEffect(() => {
    const mesh = wallsRef.current;
    if (!mesh) return;
    hedge.forEach((b, i) => {
      scratch.position.set(b.x - mazeOffsetX, b.y, b.z - mazeOffsetZ);
      scratch.scale.set(b.sx, b.sy, b.sz);
      scratch.rotation.set(0, b.rot, 0);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    });
    mesh.count = hedge.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [hedge, mazeOffsetX, mazeOffsetZ]);

  /* Hedge tone varies per segment. Written once — it never animates. */
  useLayoutEffect(() => {
    const mesh = wallsRef.current;
    if (!mesh) return;
    for (let i = 0; i < hedge.length; i++) {
      mesh.setColorAt(i, hedgeTones[i % hedgeTones.length]);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [hedge, hedgeTones]);

  useLayoutEffect(() => {
    const mesh = gardenRef.current;
    if (!mesh) return;
    gardenTrees.forEach((t, i) => {
      scratch.position.set(t.x, t.sy * 0.6, t.z);
      scratch.scale.set(t.sx, t.sy, t.sz);
      scratch.rotation.set(
        (hash(i, 149) - 0.5) * 0.3,
        hash(i, 79) * Math.PI * 2,
        (hash(i, 151) - 0.5) * 0.3,
      );
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
      mesh.setColorAt(i, t.color);
    });
    mesh.count = gardenTrees.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [gardenTrees]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = state.clock.elapsedTime;

    const revealSpan = reducedMotion ? 0.5 : REVEAL_SECONDS;
    revealRef.current = THREE.MathUtils.clamp(
      revealRef.current + ((solved ? 1 : -1) * dt) / revealSpan,
      0,
      1,
    );
    const reveal = revealRef.current;

    /* Camera. Orthographic zoom is what sets the visible extent, so
     * "fitting" is a zoom; the viewpoint is a direction, because distance is
     * irrelevant to an orthographic projection.
     *
     * Azimuth swings to the isometric three-quarter view as the tree grows:
     * The mark is read, so it is read straight. The maze is looked at from
     * a slight angle — a diamond-on plaza is the look, and hedges need some
     * height to be hedges — and the camera rises toward overhead as the
     * planting walks into the letters. Not fully overhead: a mark drawn in
     * shrubs with no visible height is a printed logo, and the point is
     * that it is made of the hedge you just ran through. */
    const camera = state.camera as THREE.OrthographicCamera;
    const span = THREE.MathUtils.lerp(mazeSpan, logoSpan, reveal);
    const targetZoom = Math.min(state.size.width, state.size.height) / span;
    camera.zoom += (targetZoom - camera.zoom) * Math.min(1, dt * 4);

    const tilt = THREE.MathUtils.lerp(0.3, 0.16, reveal);
    /* Square-on at the end. Any azimuth at all turns the wordmark on the
     * screen, and a logo read at an angle is a logo nobody screenshots. */
    const azimuth = (1 - reveal) * 0.22;
    const dist = 60;
    camera.position.set(
      dist * Math.sin(tilt) * Math.sin(azimuth),
      dist * Math.cos(tilt),
      dist * Math.sin(tilt) * Math.cos(azimuth),
    );
    // Both the maze and the mark lie on the ground, so the aim never moves.
    const aimY = 0;
    camera.lookAt(0, aimY, 0);
    camera.updateProjectionMatrix();

    const path = pathRef.current;
    if (path) {
      const mat = path.material as THREE.MeshStandardMaterial;
      mat.opacity = 1 - reveal;
      path.visible = reveal < 0.995;
    }

    /* The lawn's trees are the environment you stepped back to see, so they
     * stay for good now. They used to fade out on the tap, because a canopy
     * standing in a code's quiet zone is what stops the code being found —
     * there is no quiet zone to keep clear any more. */

    /* The maze walks into the mark.
     *
     * The hedge used to sink and fade here and a tree grew in its place.
     * Nothing sinks now except the surplus: every lump that has a target
     * walks from where it stood in the maze to a point inside the letters,
     * so the thing you read at the end is the hedge you just ran through,
     * rearranged. That is the whole idea, and it is why this is a morph and
     * not a model of the logo faded in on top.
     *
     * Staggered by distance from the middle so the mark forms from its
     * centre outward rather than every lump arriving at once — which reads
     * as a shape being drawn rather than a slide being swapped. */
    const group = wallGroupRef.current;
    const wallMesh = wallsRef.current;
    if (group && wallMesh) {
      group.position.y = 0;
      group.visible = true;
      (wallMesh.material as THREE.MeshStandardMaterial).opacity = 1;

      for (let i = 0; i < hedge.length; i++) {
        const b = hedge[i];
        const mx = b.x - mazeOffsetX;
        const mz = b.z - mazeOffsetZ;
        const target = logoTargets[i];

        if (target) {
          const radial = Math.min(
            1,
            Math.hypot(target.x, target.z) / (LOGO_SPAN * 0.5),
          );
          const staged = THREE.MathUtils.clamp(
            (reveal - radial * 0.25) / 0.75,
            0,
            1,
          );
          const e = staged * staged * (3 - 2 * staged);

          scratch.position.set(
            THREE.MathUtils.lerp(mx, target.x, e),
            b.y,
            THREE.MathUtils.lerp(mz, target.z, e),
          );
          scratch.scale.set(b.sx, b.sy, b.sz);
          scratch.rotation.set(0, b.rot, 0);
        } else {
          /* No target: there were more lumps than the mark has room for.
           * These sink and shrink out of the way rather than piling onto
           * an occupied point, which would thicken the strokes unevenly and
           * blur the letterforms. */
          scratch.position.set(mx, b.y - reveal * (WALL_H + 0.6), mz);
          scratch.scale.set(b.sx, Math.max(0.001, b.sy * (1 - reveal)), b.sz);
          scratch.rotation.set(0, b.rot, 0);
        }

        scratch.updateMatrix();
        wallMesh.setMatrixAt(i, scratch.matrix);
      }
      wallMesh.instanceMatrix.needsUpdate = true;
    }

    const runner = runnerRef.current;
    const player = playerRef.current;
    if (runner && player) {
      const p = position(runner);
      player.position.set(p.x - mazeOffsetX, 0, p.y - mazeOffsetZ);
      player.scale.setScalar(Math.max(0.0001, 1 - reveal));
      player.visible = reveal < 0.995;

      /* Turn to face the way you are going, and only while going: at a dead
       * stop `dir` is null and the last heading is kept, because a figure
       * that snaps back to a default direction when it stops reads as a
       * glitch rather than as standing still. */
      if (runner.dir != null) {
        const yaw = DIR_YAW[runner.dir];
        /* Shortest way round. Lerping the raw angles sends a turn from -π/2
         * to π the long way — three quarters of a spin for a left turn. */
        let delta = yaw - player.rotation.y;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        player.rotation.y += delta * Math.min(1, dt * 14);

        walkRef.current += dt * RUN_SPEED;
      }

      /* Stride. Reduced motion gets a standing figure rather than a still
       * one mid-step, which is what freezing the phase would give. */
      const swing = reducedMotion ? 0 : Math.sin(walkRef.current * 2.6) * 0.85;
      if (legLRef.current) legLRef.current.rotation.x = swing;
      if (legRRef.current) legRRef.current.rotation.x = -swing;
      // Arms counter the legs, which is what makes it read as walking
      // rather than as a puppet being shaken.
      if (armLRef.current) armLRef.current.rotation.x = -swing * 0.7;
      if (armRRef.current) armRRef.current.rotation.x = swing * 0.7;
    }

    /* Where you set off from. It leaves with the maze like everything else
     * on the floor — a mark for a start that no longer exists is clutter in
     * a garden. */
    const startMark = startRef.current;
    if (startMark) {
      startMark.position.set(
        maze.start.x - mazeOffsetX,
        0.012,
        maze.start.y - mazeOffsetZ,
      );
      const mat = startMark.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - reveal) * 0.8;
      startMark.visible = reveal < 0.995;
    }

    const finish = finishRef.current;
    if (finish) {
      finish.position.set(
        maze.finish.x - mazeOffsetX,
        0,
        maze.finish.y - mazeOffsetZ,
      );
      finish.scale.setScalar(Math.max(0.0001, 1 - reveal));
      finish.visible = reveal < 0.995;
    }

    /* The mark spins; the shadow under it does not. Separating them is the
     * difference between an object turning above the paving and the paving
     * turning with it. */
    const spin = finishSpinRef.current;
    if (spin) {
      if (reducedMotion) {
        // Still readable stopped: held at a slight angle so it is plainly a
        // solid object and not a decal printed on the ground.
        spin.rotation.y = 0.5;
        spin.position.y = FINISH_HOVER;
      } else {
        spin.rotation.y = t * 1.35;
        spin.position.y = FINISH_HOVER + Math.sin(t * 1.7) * 0.045;
      }
    }

  });

  return (
    <>
      {/* Lit hot and rolled off by ACES tone mapping rather than lit gently
          and left linear. Linear clips: stone bright enough to read as sunlit
          went to flat paper-white and lost every edge and joint in it, which
          is what made the whole thing look drawn rather than photographed.
          Diffuse and off-axis, because a light straight overhead puts a
          specular hotspot on every clump top — the one place the scanner is
          looking. */}
      <ambientLight intensity={1.5} />
      {/* The sun. It casts while there is a garden to cast in and is turned
          off as the code forms — a shadow falling across a light module
          darkens it, and a darkened light module is a decoding error. */}
      <directionalLight
        ref={sunRef}
        position={[14, 26, 10]}
        intensity={3.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={80}
      />
      <directionalLight position={[-8, 6, -6]} intensity={0.7} />

      {/* The lawn runs eight code-widths across — far beyond any frame at
          any zoom or tilt. That is the point: at the tree's viewing angle a
          plane only as big as the scene needs shows its own far edge, and a
          garden that stops in mid-air with black past it is the one thing
          that gives away that this is a plane. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        receiveShadow
      >
        <planeGeometry args={[lawnExtent, lawnExtent]} />
        <meshStandardMaterial
          color={tex ? "#ffffff" : groundLawn}
          map={tex?.turf ?? null}
          roughness={0.92}
          metalness={0}
        />
      </mesh>

      {/* The gravel the maze is walked on, exactly the hedge footprint.
          Separate from the lawn so the two read as different ground, and it
          leaves with the maze rather than tinting the code's plate. */}
      <mesh ref={pathRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[maze.cols + 1, maze.rows + 1]} />
        <meshStandardMaterial
          color={tex ? "#ffffff" : PATH_COLOR}
          map={tex?.paving ?? null}
          bumpMap={tex?.pavingBump ?? null}
          bumpScale={0.35}
          roughness={0.82}
          metalness={0}
          transparent
        />
      </mesh>

      {/* Canopies on the lawn. Spheres only — from this height a tree is a
          blob of leaf and its shadow, which is all the reference shows too. */}
      <instancedMesh
        ref={gardenRef}
        args={[undefined, undefined, 16]}
        castShadow
      >
        <icosahedronGeometry args={[0.62, 3]} />
        <meshStandardMaterial
          map={tex?.hedge ?? null}
          bumpMap={tex?.hedgeBump ?? null}
          bumpScale={0.5}
          color="#ffffff"
          roughness={0.95}
          metalness={0}
          transparent
        />
      </instancedMesh>

      <group ref={wallGroupRef}>
        <instancedMesh
          ref={wallsRef}
          args={[undefined, undefined, Math.max(1, hedge.length)]}
          castShadow
          receiveShadow
        >
          {/* Detail 2: enough facets that the lump has no visible flat, few
              enough that six hundred of them still cost nothing. */}
          <icosahedronGeometry args={[0.62, 2]} />
          <meshStandardMaterial
            map={tex?.hedge ?? null}
            bumpMap={tex?.hedgeBump ?? null}
            bumpScale={0.6}
            color="#ffffff"
            roughness={0.95}
            metalness={0}
            transparent
          />
        </instancedMesh>
      </group>

      {/* Where you are going.
      
          This was a pale stone set into the paving, and it lost — bone on
          gravel, flat to the floor, sitting still. Three ways to be invisible
          at once, and the one thing a finish line cannot be.

          So: the mark, in gold, turning. Gold because nothing else in this
          garden is — it was red until the garden turned red around it;
          turning because the eye finds movement before it finds contrast,
          and an overhead camera reads a flat spin as motion where it would
          read a pulse as flicker. It hovers so it clears the hedges in the
          rows either side rather than being swallowed by them. */}
      <group ref={finishRef}>
        <group ref={finishSpinRef} position={[0, FINISH_HOVER, 0]}>
          <mesh
            geometry={finishGeo}
            material={finishMat}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={FINISH_SCALE}
            castShadow
          />
        </group>
        {/* Drawn, not cast — the same reason the runner's is. It also anchors
            the hover: without something on the floor the mark reads as
            floating at an unknowable height. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]}>
          <circleGeometry args={[0.3, 24]} />
          <meshBasicMaterial color={garden.shadow} transparent opacity={0.3} />
        </mesh>
      </group>

      {/* Where you set off from. A plain ring, not a second logo mark: the
          finish already owns that shape, and two of them on one floor is a
          maze with two goals in it. Flat on the ground so it never competes
          with the runner standing on top of it at the first frame. */}
      <mesh ref={startRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.26, 0.36, 28]} />
        <meshBasicMaterial
          color="#e6ecf2"
          transparent
          opacity={0.8}
          toneMapped={false}
        />
      </mesh>

      {/* You.
      
          This was a dot, and the note here argued for keeping it one: a
          modelled figure at this scale came out a Lego man, legible enough
          to be recognised and too coarse to be believed. What makes it work
          now is that it is not asked to be believed — no face, no hands, no
          detail that invites the comparison. Five boxes and a sphere, with
          legs and arms on opposite phases of one sine.
          
          The motion is the whole thing. A dot moving is a cursor; a figure
          with a stride moving is someone running, and at this zoom the
          stride is the only part the eye can actually resolve. */}
      <group ref={playerRef}>
        {/* Legs and arms hang off empty groups placed at the joint, with
            the box offset half its length below. Rotating the mesh directly
            would pivot it about its own middle — the foot swings forward and
            the thigh swings back by the same amount, which reads as a limb
            rowing rather than a leg stepping. */}
        <group ref={legLRef} position={[-0.075, 0.25, 0]}>
          <mesh position={[0, -0.12, 0]} castShadow>
            <boxGeometry args={[0.075, 0.24, 0.075]} />
            <meshStandardMaterial color="#12171c" roughness={0.6} />
          </mesh>
        </group>
        <group ref={legRRef} position={[0.075, 0.25, 0]}>
          <mesh position={[0, -0.12, 0]} castShadow>
            <boxGeometry args={[0.075, 0.24, 0.075]} />
            <meshStandardMaterial color="#12171c" roughness={0.6} />
          </mesh>
        </group>

        <group ref={armLRef} position={[-0.15, 0.45, 0]}>
          <mesh position={[0, -0.085, 0]} castShadow>
            <boxGeometry args={[0.055, 0.17, 0.055]} />
            <meshStandardMaterial color="#20262c" roughness={0.5} />
          </mesh>
        </group>
        <group ref={armRRef} position={[0.15, 0.45, 0]}>
          <mesh position={[0, -0.085, 0]} castShadow>
            <boxGeometry args={[0.055, 0.17, 0.055]} />
            <meshStandardMaterial color="#20262c" roughness={0.5} />
          </mesh>
        </group>

        <mesh position={[0, 0.37, 0]} castShadow>
          <boxGeometry args={[0.22, 0.24, 0.15]} />
          <meshStandardMaterial
            color="#20262c"
            roughness={0.42}
            metalness={0.05}
          />
        </mesh>

        <mesh position={[0, 0.57, 0]} castShadow>
          <sphereGeometry args={[0.115, 20, 16]} />
          <meshStandardMaterial
            color="#2b333a"
            roughness={0.45}
            metalness={0.05}
          />
        </mesh>

        {/* Contact shadow, drawn rather than cast: at this size the shadow
            map has neither the resolution nor the need. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.07, 0.014, 0.07]}>
          <circleGeometry args={[0.2, 20]} />
          <meshBasicMaterial color={garden.shadow} transparent opacity={0.4} />
        </mesh>
      </group>

    </>
  );
}
