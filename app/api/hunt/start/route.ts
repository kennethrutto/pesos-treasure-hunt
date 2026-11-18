import { NextRequest, NextResponse } from "next/server";

import {
  HUNT_COOKIE,
  huntSigningAvailable,
  issueRunToken,
  newPlayerId,
  setPlayerCookie,
  unpackPlayerId,
} from "@/lib/huntSession";
import {
  completedSeeds,
  ensureNamedPlayer,
  nextSeedFor,
  playerRecord,
} from "@/lib/huntStore";
import {
  DEFAULT_BOARD,
  isHuntBoardId,
  isOpenBoard,
  type HuntBoardId,
} from "@/lib/huntBoards";
import { MAZE_COUNT, nextInOrder } from "@/lib/maze";

/* Hands out a maze.
 *
 * The server chooses which one, not the browser. That is the whole
 * enforcement of "you cannot run a maze twice": a client that picks its own
 * maze can always pick one it has already beaten, however carefully the
 * page is written. It also means the run token can name the maze, so the
 * finish can only be submitted for the maze that was actually issued.
 *
 * Which one it chooses is the player's own running order — a permutation of
 * the whole set derived from their id, see nextInOrder. Everybody runs all
 * five, once each, in an order that is theirs.
 *
 * The edition comes from the caller, because more than one is open and the
 * grid on /hunt is where it is chosen. A closed one is never dealt from, and
 * what a player has run on one edition does not count against them on
 * another — the boards are separate all the way down.
 */

export const runtime = "nodejs";

/** The mazes the browser says it has already been dealt.
 *
 * Only practice mode asks. Ranked play reads the runs table and ignores
 * this entirely — a client that names its own history could otherwise name
 * an empty one and re-run the maze it did best on. In practice mode there
 * is no table to read and nothing being recorded, so there is nothing here
 * worth lying about: the only thing a false list can buy is a repeat of a
 * maze in a rehearsal.
 *
 * Sanitised anyway, because it lands in nextInOrder either way and a list
 * of strings would silently match nothing and hand out maze 0 forever. */
function dealtAlready(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const raw of value) {
    const i = Number(raw);
    if (Number.isInteger(i) && i >= 0 && i < MAZE_COUNT) seen.add(i);
  }
  return [...seen];
}

export async function POST(req: NextRequest) {
  const existing = unpackPlayerId(req.cookies.get(HUNT_COOKIE)?.value);
  const playerId = existing ?? newPlayerId();

  /* Read once: a body is a stream, and the practice branch below used to
   * read it a second time. */
  const body: unknown = await req.json().catch(() => null);
  const asked = (body as { board?: unknown } | null)?.board;

  /* Which edition. Absent means the page asking predates editions — a tab
   * left open across a deploy — and gets the newest open one rather than an
   * error it has no way to act on. Present but unknown, or present and
   * closed, is a client asking to be dealt from a board nothing may be
   * written to. */
  let board: HuntBoardId = DEFAULT_BOARD;
  if (typeof asked === "string") {
    if (!isHuntBoardId(asked) || !isOpenBoard(asked)) {
      return NextResponse.json(
        { error: "That edition is not open." },
        { status: 400 },
      );
    }
    board = asked;
  }

  const done = await completedSeeds(board, playerId);
  const ranked = done != null && huntSigningAvailable();

  /* No database, or no secret to sign with: the hunt is still playable, it
   * simply is not recorded.
   *
   * It still runs the set properly. This used to be
   * `Math.floor(Math.random() * MAZE_COUNT)` — a fresh draw every round with
   * nothing remembered, which deals the same maze twice inside five rounds
   * about nine times out of ten. The running order is derived from the
   * player id and needs no storage; all this mode is missing is the list of
   * what has already been dealt, so the browser carries it. */
  if (!ranked) {
    const seen = dealtAlready((body as { done?: unknown } | null)?.done);
    const seedIndex = nextInOrder(playerId, seen);

    const res = NextResponse.json(
      seedIndex === -1
        ? {
            mode: "complete" as const,
            name: null,
            completed: seen,
            remaining: 0,
            record: null,
          }
        : {
            mode: "practice" as const,
            seedIndex,
            token: null,
            completed: seen,
            remaining: MAZE_COUNT - seen.length,
          },
    );
    if (!existing) setPlayerCookie(res, playerId);
    return res;
  }

  /* The name is issued on the way in, before a maze is handed over — the
   * runs table has a foreign key to the player, so they have to exist, and
   * "you are given a name at the gate" is the flow we want anyway. */
  const name = await ensureNamedPlayer(playerId);

  const seedIndex = await nextSeedFor(board, playerId);

  if (seedIndex === -1) {
    return withCookie(
      NextResponse.json({
        mode: "complete" as const,
        name,
        completed: done,
        remaining: 0,
        record: (await playerRecord(board, playerId)) ?? [],
      }),
      existing,
      playerId,
    );
  }

  if (seedIndex == null) {
    return NextResponse.json({ error: "Hunt unavailable." }, { status: 503 });
  }

  return withCookie(
    NextResponse.json({
      mode: "ranked" as const,
      name,
      seedIndex,
      token: issueRunToken(playerId, board, seedIndex),
      completed: done,
      remaining: MAZE_COUNT - done.length,
    }),
    existing,
    playerId,
  );
}

function withCookie(
  res: NextResponse,
  existing: string | null,
  playerId: string,
) {
  if (!existing) setPlayerCookie(res, playerId);
  return res;
}
