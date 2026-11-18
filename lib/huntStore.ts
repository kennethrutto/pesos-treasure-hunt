import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { mazeSeed, type HuntBoardId } from "@/lib/huntBoards";
import { getHuntPool, runsTable } from "@/lib/huntDb";
import { assignName } from "@/lib/huntNames";
import {
  generateMaze,
  MAZE_COUNT,
  nextInOrder,
} from "@/lib/maze";
import { RUN_SPEED } from "@/lib/mazeRunner";

/* Every read and write the hunt makes.
 *
 * Each function returns null when there is no database, rather than
 * throwing — see the note in huntDb.ts. Callers treat null as "practice
 * mode", which is a real state the page renders, not an error path.
 *
 * Everything about a run takes the board it is on. Players are shared across
 * boards and runs are not, so the functions about who someone is take no
 * board and the ones about what they did always do. Writes are only ever
 * made to an open edition; a closed one is read and never written, which is
 * what keeps its results as they finished.
 */

export type BoardRow = { rank: number; name: string; ms: number; you: boolean };

export type PlayerRun = { seedIndex: number; ms: number; rank: number };

async function nameTaken(name: string): Promise<boolean> {
  const pool = await getHuntPool();
  if (!pool) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM hunt_players WHERE name = ? LIMIT 1`,
    [name],
  );
  return rows.length > 0;
}

/** The player's name, issuing one the first time they arrive.
 *
 * Nothing the visitor sends is involved: a name is drawn from the pool and
 * checked against the unique index, which is why no part of the pipeline
 * needs to sanitise, moderate or de-duplicate free text. */
export async function ensureNamedPlayer(id: string): Promise<string | null> {
  const pool = await getHuntPool();
  if (!pool) return null;

  const existing = await getPlayerName(id);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const name = await assignName(id, nameTaken);
    try {
      await pool.query(
        `INSERT INTO hunt_players (id, name) VALUES (?, ?)`,
        [id, name],
      );
      return name;
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Someone else took the name between the check and the insert. Draw
      // again — the index is the arbiter, not the lookup.
      if (code === "ER_DUP_ENTRY") {
        const now = await getPlayerName(id);
        if (now) return now;
        continue;
      }
      throw err;
    }
  }
  return null;
}

/** The fastest a maze can be run, in milliseconds: its solution length at
 * full speed, with no time lost to a single turn. Nothing human beats it,
 * so a submission under it is a lie and is rejected. The 3% margin is for
 * frame quantisation, not for generosity. */
export function minimumMs(boardId: HuntBoardId, seedIndex: number): number {
  const maze = generateMaze(mazeSeed(boardId, seedIndex));
  return Math.floor(((maze.solutionLength / RUN_SPEED) * 1000) * 0.97);
}

export async function getPlayerName(id: string): Promise<string | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT name FROM hunt_players WHERE id = ? LIMIT 1`,
    [id],
  );
  return (rows[0]?.name as string | undefined) ?? null;
}

/** Which of the current set this player has already finished.
 *
 * Filtered to the mazes that still exist, not merely returned as stored.
 * The run table keeps every row ever written, including runs of mazes that
 * have since been retired from a board's set, and callers ask two things of
 * this list: which numbers to skip, and — via its length against
 * MAZE_COUNT — whether the hunt is done. The second is what breaks on raw
 * rows: a player holding eight finishes from a twenty-maze set counts as
 * having completed a five-maze one without having run any of the five.
 *
 * Old rows are kept rather than deleted; they simply stop counting. */
export async function completedSeeds(
  boardId: HuntBoardId,
  id: string,
): Promise<number[] | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT seed_index FROM ${runsTable(boardId)} WHERE player_id = ?`,
    [id],
  );
  return rows
    .map((r) => Number(r.seed_index))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < MAZE_COUNT);
}

/** The next maze this player has not run. Returns null when the hunt has no
 * database — the caller falls back to the same running order with the list
 * the browser supplies — and -1 when every maze in the set is done.
 *
 * The choice itself is nextInOrder's, not this function's. It used to draw
 * at random from whatever was left, which is repeat-free but re-rolls on
 * every request: an abandoned start came back as a different maze, so the
 * order was never settled and a player could reload their way past one.
 * The unique key on (player_id, seed_index) is still what makes "no maze
 * twice" true under a race; this is what makes it true by construction. */
export async function nextSeedFor(
  boardId: HuntBoardId,
  id: string,
): Promise<number | null | -1> {
  const done = await completedSeeds(boardId, id);
  if (done == null) return null;
  return nextInOrder(id, done);
}

export type RecordOutcome = "recorded" | "already-run" | "no-database";

/** Writes a time. The unique key on (player_id, seed_index) is what makes
 * this safe against two requests arriving together, so a duplicate is
 * caught from the error rather than by looking first and hoping. */
export async function recordRun(
  boardId: HuntBoardId,
  playerId: string,
  seedIndex: number,
  ms: number,
): Promise<RecordOutcome> {
  const pool = await getHuntPool();
  if (!pool) return "no-database";
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO ${runsTable(boardId)} (player_id, seed_index, ms) VALUES (?, ?, ?)`,
      [playerId, seedIndex, Math.round(ms)],
    );
    return "recorded";
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") return "already-run";
    throw err;
  }
}

/** One maze's board, a window at a time.
 *
 * Paged rather than topped-out, because the board is now scrolled rather
 * than glanced at: `offset` is how far down the list the reader has got, and
 * the rank is counted from it rather than from the returned array — row one
 * of page three is 101st, not 1st. */
export async function board(
  boardId: HuntBoardId,
  seedIndex: number,
  playerId: string | null,
  limit = 10,
  offset = 0,
): Promise<BoardRow[] | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.player_id, r.ms, p.name
       FROM ${runsTable(boardId)} r
       JOIN hunt_players p ON p.id = r.player_id
      WHERE r.seed_index = ?
      ORDER BY r.ms ASC, r.created_at ASC
      LIMIT ? OFFSET ?`,
    [seedIndex, limit, offset],
  );
  return rows.map((r, i) => ({
    rank: offset + i + 1,
    name: String(r.name),
    ms: Number(r.ms),
    you: playerId != null && r.player_id === playerId,
  }));
}

/** How many people have run this maze at all.
 *
 * Sent with every page so the board can say how long it is before the reader
 * has scrolled to the end of it, and so "load more" knows when to stop
 * asking. */
export async function boardCount(
  boardId: HuntBoardId,
  seedIndex: number,
): Promise<number | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ${runsTable(boardId)} WHERE seed_index = ?`,
    [seedIndex],
  );
  return Number(rows[0]?.n ?? 0);
}

/** The overall board: total time across every maze in the set.
 *
 * The per-maze boards stay — they are what you check between runs — but the
 * hunt is won on the compiled time, so this is the one that decides a prize.
 *
 * HAVING COUNT(*) = MAZE_COUNT is doing the real work. A player who has run
 * two mazes has a smaller SUM than one who has run five, so ranking the raw
 * totals would put every unfinished player above every finished one. Only
 * complete sets are comparable, so only complete sets appear.
 *
 * MAZE_COUNT is interpolated rather than bound because it is a constant from
 * this codebase, never anything a request carries. The seed filter matters
 * as much as the count: without it, runs of retired mazes would both inflate
 * a total and let a player reach the required count without having run the
 * current five.
 *
 * The tiebreak is not decoration. Two people can finish on the same total —
 * they do, and it is one of the better things about the board — and ordering
 * on total_ms alone leaves MySQL free to return them in either order, so a
 * drawn pair visibly swap places between refreshes. Whoever got there first
 * is listed first, which is both stable and the fair way to read a draw.
 */
export async function totalBoard(
  boardId: HuntBoardId,
  playerId: string | null,
  limit = 20,
  offset = 0,
): Promise<BoardRow[] | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.player_id, p.name, SUM(r.ms) AS total_ms,
            MAX(r.created_at) AS finished_at
       FROM ${runsTable(boardId)} r
       JOIN hunt_players p ON p.id = r.player_id
      WHERE r.seed_index >= 0 AND r.seed_index < ?
      GROUP BY r.player_id, p.name
     HAVING COUNT(*) = ?
      ORDER BY total_ms ASC, finished_at ASC, p.name ASC
      LIMIT ? OFFSET ?`,
    [MAZE_COUNT, MAZE_COUNT, limit, offset],
  );
  return rows.map((r, i) => ({
    rank: offset + i + 1,
    name: String(r.name),
    ms: Number(r.total_ms),
    you: playerId != null && r.player_id === playerId,
  }));
}

/** How many people have finished the whole set.
 *
 * The same HAVING COUNT(*) = MAZE_COUNT filter as the board itself, and for
 * the same reason — a partial total is not a standing, so a partial player is
 * not a finisher and must not be counted as one. Wrapped in a subquery
 * because HAVING filters groups, so counting the groups means counting the
 * rows the grouped query returns. */
export async function totalBoardCount(
  boardId: HuntBoardId,
): Promise<number | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM (
       SELECT player_id
         FROM ${runsTable(boardId)}
        WHERE seed_index >= 0 AND seed_index < ?
        GROUP BY player_id
       HAVING COUNT(*) = ?
     ) t`,
    [MAZE_COUNT, MAZE_COUNT],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Where a player's completed set sits overall, counted rather than read off
 * the board so it is still right outside the top twenty. Null when they have
 * not finished every maze — there is nothing to rank yet. */
export async function totalRankOf(
  boardId: HuntBoardId,
  playerId: string,
): Promise<{ rank: number; total: number; ms: number } | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const table = runsTable(boardId);
  const [mine] = await pool.query<RowDataPacket[]>(
    `SELECT SUM(ms) AS total_ms, COUNT(*) AS runs
       FROM ${table}
      WHERE player_id = ? AND seed_index >= 0 AND seed_index < ?`,
    [playerId, MAZE_COUNT],
  );
  const runs = Number(mine[0]?.runs ?? 0);
  if (runs !== MAZE_COUNT) return null;
  const ms = Number(mine[0].total_ms);

  const [agg] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(t.total_ms < ?) AS faster,
       COUNT(*)            AS total
     FROM (
       SELECT player_id, SUM(ms) AS total_ms
         FROM ${table}
        WHERE seed_index >= 0 AND seed_index < ?
        GROUP BY player_id
       HAVING COUNT(*) = ?
     ) t`,
    [ms, MAZE_COUNT, MAZE_COUNT],
  );
  return {
    rank: Number(agg[0]?.faster ?? 0) + 1,
    total: Number(agg[0]?.total ?? 1),
    ms,
  };
}

/** Where a time sits on a board. Counted rather than read off the board, so
 * it is still right for a run that finished outside the top ten. */
export async function rankOf(
  boardId: HuntBoardId,
  seedIndex: number,
  ms: number,
): Promise<{ rank: number; total: number } | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const table = runsTable(boardId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM ${table} WHERE seed_index = ? AND ms < ?) AS faster,
       (SELECT COUNT(*) FROM ${table} WHERE seed_index = ?)            AS total`,
    [seedIndex, Math.round(ms), seedIndex],
  );
  return { rank: Number(rows[0].faster) + 1, total: Number(rows[0].total) };
}

/** Everything one player has done, for the finished-the-hunt screen. */
export async function playerRecord(
  boardId: HuntBoardId,
  id: string,
): Promise<PlayerRun[] | null> {
  const pool = await getHuntPool();
  if (!pool) return null;
  const table = runsTable(boardId);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT r.seed_index, r.ms,
            (SELECT COUNT(*) FROM ${table} f
              WHERE f.seed_index = r.seed_index AND f.ms < r.ms) + 1 AS rank_
       FROM ${table} r
      WHERE r.player_id = ?
      ORDER BY r.seed_index ASC`,
    [id],
  );
  return rows.map((r) => ({
    seedIndex: Number(r.seed_index),
    ms: Number(r.ms),
    rank: Number(r.rank_),
  }));
}
