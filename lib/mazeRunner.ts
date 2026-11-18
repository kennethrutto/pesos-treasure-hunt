import { DX, DY, isOpen, opposite, type Dir, type Maze } from "@/lib/maze";

/* How the runner moves through a maze.
 *
 * Kept out of the scene component and free of three.js so the rule set can
 * be reasoned about — and tested — on its own. The renderer's only job is
 * to draw `position()` each frame.
 *
 * The model is a glide, not a step: a direction is a *commitment*, and the
 * runner keeps going that way until a wall stops it or another direction
 * is chosen. That is what makes one flick of a thumb cross a whole
 * corridor, which is the difference between a maze that is fun to run on a
 * phone and one that needs forty separate swipes.
 */

/** Cells per second. A flow-field bot solves the twenty layouts in 15-20s
 * at 6; this is a shade quicker so a good human run lands near a minute.
 *
 * Lives here rather than in the scene because the server needs it too: the
 * fastest a maze can physically be run is its solution length divided by
 * this, and that number is what makes an impossible time rejectable. */
export const RUN_SPEED = 7.5;

export type Runner = {
  /** The cell the runner is leaving. Together with `frac` this is an exact
   * position, which a floating-point world coordinate rounded back to a
   * cell is not — at a cell boundary that rounding is a coin toss, and it
   * decides which walls apply. */
  cell: { x: number; y: number };
  /** Progress toward `cell + dir`, 0 to 1. Always 0 when `dir` is null. */
  frac: number;
  dir: Dir | null;
  /** The direction asked for, kept until a cell is reached where it is
   * possible. Holding a turn against a wall so it fires at the junction is
   * what stops a slightly-early input from being swallowed. */
  want: Dir | null;
};

export function createRunner(maze: Maze): Runner {
  return { cell: { ...maze.start }, frac: 0, dir: null, want: null };
}

/** Cell-space position, for the renderer. */
export function position(r: Runner): { x: number; y: number } {
  if (r.dir == null) return { x: r.cell.x, y: r.cell.y };
  return {
    x: r.cell.x + DX[r.dir] * r.frac,
    y: r.cell.y + DY[r.dir] * r.frac,
  };
}

/** The cell the runner is closest to — what the finish test compares. */
function nearestCell(r: Runner): { x: number; y: number } {
  if (r.dir == null || r.frac < 0.5) return { x: r.cell.x, y: r.cell.y };
  return { x: r.cell.x + DX[r.dir], y: r.cell.y + DY[r.dir] };
}

/** Advances by `dt` seconds at `speed` cells per second. */
export function step(maze: Maze, r: Runner, dt: number, speed: number): void {
  /* A reversal is the one turn that needs no junction — the corridor
   * behind is by definition open, since the runner just came down it.
   * Reflecting mid-corridor rather than waiting for the next centre is
   * what stops a wrong turn from costing a full cell of travel. */
  if (r.dir != null && r.want != null && r.frac > 0 && r.want === opposite(r.dir)) {
    r.cell = { x: r.cell.x + DX[r.dir], y: r.cell.y + DY[r.dir] };
    r.frac = 1 - r.frac;
    r.dir = r.want;
    r.want = null;
  }

  let budget = Math.max(0, speed * dt);
  // A frame long enough to cross several cells is resolved one cell at a
  // time so no wall is passed through; the guard is against a pathological
  // dt (a backgrounded tab resuming) spinning here.
  let guard = 0;

  while (budget > 0 && guard++ < 256) {
    if (r.frac === 0) {
      const want = r.want;
      if (want != null && isOpen(maze, r.cell.x, r.cell.y, want)) {
        r.dir = want;
        r.want = null;
      } else if (r.dir == null || !isOpen(maze, r.cell.x, r.cell.y, r.dir)) {
        // Nose against a wall with nowhere queued that helps. Stop dead on
        // the centre and wait for input rather than creeping into it.
        r.dir = null;
        return;
      }
    }

    const move = Math.min(budget, 1 - r.frac);
    r.frac += move;
    budget -= move;

    if (r.frac >= 1 - 1e-9) {
      r.cell = { x: r.cell.x + DX[r.dir!], y: r.cell.y + DY[r.dir!] };
      r.frac = 0;
    }
  }
}

export function solved(maze: Maze, r: Runner): boolean {
  const c = nearestCell(r);
  return c.x === maze.finish.x && c.y === maze.finish.y;
}
