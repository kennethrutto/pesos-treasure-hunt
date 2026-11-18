import { NextRequest, NextResponse } from "next/server";

import { DEFAULT_BOARD, isHuntBoardId } from "@/lib/huntBoards";
import { HUNT_COOKIE, unpackPlayerId } from "@/lib/huntSession";
import {
  board,
  boardCount,
  totalBoard,
  totalBoardCount,
  totalRankOf,
} from "@/lib/huntStore";
import { MAZE_COUNT } from "@/lib/maze";

/* Reads a board: one maze's, or the compiled total, on any leaderboard.
 *
 * `board` names the leaderboard — launch-day, pop-up, whatever is in
 * lib/huntBoards.ts — and defaults to the current one, so the game never
 * has to say. It is checked against that list before anything else, because
 * it ends up choosing a table.
 *
 * Separate from the finish route so the leaderboard can be opened at any
 * time, including before a single maze has been run — half the appeal of a
 * board is seeing what you are up against before you start.
 *
 * Read-only and public: the times and the issued names on it are already
 * shown to everyone who opens the page. The cookie is consulted only to
 * mark which row is yours.
 *
 * Served as a window rather than a whole board. `offset` and `limit` are
 * what let the leaderboard be scrolled instead of topped out, and `count` is
 * what lets it say how far there is left to go. One page is also what makes
 * re-reading it every few seconds cheap enough to do while someone watches
 * — a live board is a board that is fetched again, and fetching the whole of
 * it on a timer is how you turn a leaderboard into a load test.
 */

export const runtime = "nodejs";

/* No caching anywhere between here and the phone. This endpoint is polled
 * precisely because its answer changes, and a proxy that holds it for even
 * thirty seconds turns a live board into a stale one that lies convincingly. */
export const dynamic = "force-dynamic";

/** Rows per page.
 *
 * DEFAULT_LIMIT is one screenful and a bit — enough that the first paint
 * fills a phone and the second page is fetched while the reader is still
 * reading the first. MAX_LIMIT is the real protection: it is what stops a
 * crafted `limit` from asking for every row the table will ever hold. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Clamps a query-string integer, falling back when it is absent or junk.
 * Everything here arrives from the URL, so nothing is trusted: `Number` is
 * happy to return NaN, Infinity and -0, and all three go straight into a
 * LIMIT clause if they are not caught. */
function intParam(raw: string | null, fallback: number, min: number, max: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("seed");
  const playerId = unpackPlayerId(req.cookies.get(HUNT_COOKIE)?.value);

  const boardId = req.nextUrl.searchParams.get("board") ?? DEFAULT_BOARD;
  if (!isHuntBoardId(boardId)) {
    return NextResponse.json({ error: "Unknown board." }, { status: 400 });
  }

  const limit = intParam(
    req.nextUrl.searchParams.get("limit"),
    DEFAULT_LIMIT,
    1,
    MAX_LIMIT,
  );
  /* Capped rather than merely floored. An offset is a promise to skip that
   * many rows before reading, and MySQL keeps that promise literally — a
   * ten-million offset is a ten-million row scan for an empty page. */
  const offset = intParam(
    req.nextUrl.searchParams.get("offset"),
    0,
    0,
    1_000_000,
  );

  /* `seed=total` is the compiled board — every maze added together, which
   * is what the hunt is actually won on. The per-maze boards remain because
   * they are what you check between runs, but only complete sets appear
   * here: a player two mazes in has a smaller sum than one who has run all
   * five, so partial totals are not comparable and are left out entirely. */
  if (raw === "total") {
    const [rows, count] = await Promise.all([
      totalBoard(boardId, playerId, limit, offset),
      totalBoardCount(boardId),
    ]);
    if (rows == null || count == null) {
      return NextResponse.json({
        mode: "practice" as const,
        board: boardId,
        seed: "total",
        rows: [],
        offset,
        limit,
        count: 0,
        hasMore: false,
        placing: null,
      });
    }
    /* Counted rather than read off the rows, so it is still right for a
     * finisher far down the list — which is most of them, once the hunt has
     * run for a while. Null until a player has run all five: there is no
     * comparable standing before that. */
    const placing = playerId ? await totalRankOf(boardId, playerId) : null;
    return NextResponse.json({
      mode: "ranked" as const,
      board: boardId,
      seed: "total",
      rows,
      offset,
      limit,
      count,
      hasMore: offset + rows.length < count,
      placing,
    });
  }

  const seedIndex = Number(raw);

  if (!Number.isInteger(seedIndex) || seedIndex < 0 || seedIndex >= MAZE_COUNT) {
    return NextResponse.json({ error: "Unknown maze." }, { status: 400 });
  }

  const [rows, count] = await Promise.all([
    board(boardId, seedIndex, playerId, limit, offset),
    boardCount(boardId, seedIndex),
  ]);

  if (rows == null || count == null) {
    // Practice mode. An empty board would read as "nobody has run this",
    // which is a different and misleading thing.
    return NextResponse.json({
      mode: "practice" as const,
      board: boardId,
      seedIndex,
      rows: [],
      offset,
      limit,
      count: 0,
      hasMore: false,
    });
  }

  return NextResponse.json({
    mode: "ranked" as const,
    board: boardId,
    seedIndex,
    rows,
    offset,
    limit,
    count,
    hasMore: offset + rows.length < count,
  });
}
