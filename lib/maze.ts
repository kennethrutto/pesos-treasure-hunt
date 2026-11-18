import { hash32 } from "@/lib/hash32";

/* Maze generation for the treasure hunt.
 *
 * Deliberately seeded rather than random: the same seed always produces
 * the same maze, so the layouts are reproducible — a time is
 * comparable against the same maze someone else ran, and a bug in a
 * specific layout can be reproduced by number instead of by luck.
 *
 * Pure and dependency-free on purpose. The scene imports this, but so
 * could a test or a script, and nothing here touches the DOM.
 */

/** N, E, S, W. Index into DX/DY; the open-sides bitmask uses 1 << dir. */
export type Dir = 0 | 1 | 2 | 3;

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export function opposite(dir: Dir): Dir {
  return ((dir + 2) % 4) as Dir;
}

export type Cell = { x: number; y: number };

export type Maze = {
  seed: number;
  cols: number;
  rows: number;
  /** One byte per cell, row-major. Bit `1 << dir` set means that side is
   * open. Walls are the absence of a bit, so there is no separate wall
   * list to keep in step with this one. */
  open: Uint8Array;
  start: Cell;
  finish: Cell;
  /** Steps along the unique corridor from start to finish. Shown after a
   * run so a time means something — a 40-step maze and a 90-step maze are
   * not the same achievement. */
  solutionLength: number;
};

/** How many mazes make a hunt: five rounds, one compiled time.
 *
 * Was twenty. Five is a run someone finishes in one sitting, which is what
 * the hunt now has to be: it is the qualifier for a prize rather than a
 * thing to pick at over a week, and a prize nobody reaches is not a prize.
 *
 * Which five is not decided here. Each board brings its own set — `seeds`
 * in lib/huntBoards.ts — because a new season is new mazes as well as a new
 * board, and a board's per-maze standings only mean something against the
 * layouts they were run on. Every set is exactly this long: the MazeSet type
 * there holds them to it, and the compiled board's HAVING COUNT(*) =
 * MAZE_COUNT is what would quietly empty if one were not. */
export const MAZE_COUNT = 5;

/** The order one player meets the set in: every maze exactly once, in a
 * sequence shuffled by their id.
 *
 * A running order rather than a draw. Picking at random from whatever is
 * left is *also* repeat-free, but it re-rolls on every request — so a run
 * started and abandoned comes back as a different maze, and a player who
 * does not like the one they were dealt can reload until they are dealt
 * another. A permutation settles the whole hunt the moment the id exists:
 * which maze is next is a fact about the player, not about the request.
 *
 * Derived from the id for the same reasons the handle is (see
 * lib/huntNames.ts): it survives a restart, it survives a wiped
 * leaderboard, and it can be computed with no database at all — which is
 * what lets practice mode run the set without repeating one, having nowhere
 * to record what it has already dealt.
 *
 * Everyone gets a different order, which is the point: 120 of them for five
 * mazes, drawn against a 128-bit random id. Two players sharing one is
 * unremarkable and costs nothing — they still each run all five once.
 */
export function mazeOrder(playerId: string): number[] {
  const rand = rng(hash32(`order:${playerId}`));
  const order = Array.from({ length: MAZE_COUNT }, (_, i) => i);
  /* Fisher-Yates, walking down. The version that picks j from the whole
   * range on every step is the one everybody writes and it is not uniform —
   * it can reach n^n sequences over n! permutations, which do not divide. */
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** The next maze in this player's order that they have not run, or -1 once
 * the whole set is behind them.
 *
 * `done` is read from the runs table for a ranked player and supplied by
 * the browser in practice mode, and this does not care which: it is the
 * single place that decides "no maze twice", so both paths get it. Entries
 * outside the current set simply never match, which is what keeps a retired
 * maze from blocking a live one. */
export function nextInOrder(playerId: string, done: readonly number[]): number {
  for (const i of mazeOrder(playerId)) if (!done.includes(i)) return i;
  return -1;
}

/** mulberry32: small, fast, and good enough that adjacent seeds produce
 * unrelated mazes — which `Math.sin`-style hashes do not. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recursive backtracker, iterative so a large grid cannot blow the stack.
 *
 * It produces a *perfect* maze — every cell reachable, exactly one route
 * between any two — which is what makes the finish always reachable
 * without a solvability check, and what makes the solution length below
 * a single well-defined number. Its long, winding corridors are also what
 * make it feel like a maze rather than a room with pillars in it. */
function carve(cols: number, rows: number, seed: number): Uint8Array {
  const rand = rng(seed);
  const open = new Uint8Array(cols * rows);
  const seen = new Uint8Array(cols * rows);
  const at = (x: number, y: number) => y * cols + x;

  const stack: Cell[] = [{ x: 0, y: 0 }];
  seen[0] = 1;

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options: Dir[] = [];
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      const nx = cur.x + DX[d];
      const ny = cur.y + DY[d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (seen[at(nx, ny)]) continue;
      options.push(d);
    }

    if (!options.length) {
      stack.pop();
      continue;
    }

    const d = options[Math.floor(rand() * options.length)];
    const nx = cur.x + DX[d];
    const ny = cur.y + DY[d];
    // Both sides, or the wall would be open one way and solid the other.
    open[at(cur.x, cur.y)] |= 1 << d;
    open[at(nx, ny)] |= 1 << opposite(d);
    seen[at(nx, ny)] = 1;
    stack.push({ x: nx, y: ny });
  }

  return open;
}

/** Breadth-first from `start`, returning the step count to every cell.
 * The maze is perfect, so the first time BFS reaches a cell is also the
 * only way there — these are exact path lengths, not estimates. */
function distances(maze: Omit<Maze, "start" | "finish" | "solutionLength">, start: Cell) {
  const { cols, rows, open } = maze;
  const dist = new Int32Array(cols * rows).fill(-1);
  const at = (x: number, y: number) => y * cols + x;
  const queue: Cell[] = [start];
  dist[at(start.x, start.y)] = 0;

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const here = at(cur.x, cur.y);
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      if (!(open[here] & (1 << d))) continue;
      const nx = cur.x + DX[d];
      const ny = cur.y + DY[d];
      const next = at(nx, ny);
      if (dist[next] !== -1) continue;
      dist[next] = dist[here] + 1;
      queue.push({ x: nx, y: ny });
    }
  }

  return dist;
}

/** Builds the maze for one seed.
 *
 * The finish is the cell *furthest* from the start rather than a fixed
 * corner. A fixed corner is often only a few turns away in a perfect
 * maze — this guarantees the longest journey the layout can offer, and
 * moves the goal around between seeds so they do not all read as
 * "run to the bottom right". */
export function generateMaze(seed: number, cols = 13, rows = 13): Maze {
  const open = carve(cols, rows, seed);
  const base = { seed, cols, rows, open };

  const start: Cell = { x: 0, y: 0 };
  const dist = distances(base, start);

  let finish = start;
  let best = -1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const d = dist[y * cols + x];
      if (d > best) {
        best = d;
        finish = { x, y };
      }
    }
  }

  return { ...base, start, finish, solutionLength: best };
}

/** Whether a step out of (x, y) in `dir` is possible. Out-of-bounds is
 * closed, so the grid edge needs no special-casing by the caller. */
export function isOpen(maze: Maze, x: number, y: number, dir: Dir): boolean {
  if (x < 0 || y < 0 || x >= maze.cols || y >= maze.rows) return false;
  return (maze.open[y * maze.cols + x] & (1 << dir)) !== 0;
}
