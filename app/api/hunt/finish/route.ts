import { NextRequest, NextResponse } from "next/server";

import { isOpenBoard } from "@/lib/huntBoards";
import { HUNT_COOKIE, unpackPlayerId, verifyRunToken } from "@/lib/huntSession";
import { board, minimumMs, rankOf, recordRun } from "@/lib/huntStore";
import { MAZE_COUNT } from "@/lib/maze";

/* Records a finished run and answers with the board it landed on.
 *
 * Everything here is a check on a number a browser supplied, so the order
 * matters: identity, then that the maze was really issued to this identity,
 * then that the time is physically possible, and only then the write. The
 * write itself is still the last line of defence — the unique key is what
 * actually holds when two requests race.
 */

export const runtime = "nodejs";

type FinishBody = { token?: string; ms?: number };

/** Allow for the round trip and a little clock drift between the browser's
 * `performance.now()` and the server's wall clock. */
const CLOCK_SLOP_MS = 4000;

export async function POST(req: NextRequest) {
  const body: FinishBody = await req.json().catch(() => ({}));

  const playerId = unpackPlayerId(req.cookies.get(HUNT_COOKIE)?.value);
  if (!playerId) {
    return NextResponse.json({ error: "No run in progress." }, { status: 401 });
  }

  const token = verifyRunToken(body.token);
  if (!token) {
    return NextResponse.json(
      { error: "That run has expired. Start another." },
      { status: 400 },
    );
  }

  // The token names its player, so a token cannot be carried to another
  // browser and submitted there.
  if (token.playerId !== playerId) {
    return NextResponse.json({ error: "No run in progress." }, { status: 401 });
  }

  /* And its edition. Open ones are written to and closed ones are not —
   * that is the whole of what keeps a finished board as it finished — so a
   * run dealt from an edition that has closed since has nowhere to land.
   * The token names the edition, so this cannot be argued with by a
   * client. */
  if (!isOpenBoard(token.board)) {
    return NextResponse.json(
      { error: "That run has expired. Start another." },
      { status: 400 },
    );
  }

  const { seedIndex } = token;
  if (!Number.isInteger(seedIndex) || seedIndex < 0 || seedIndex >= MAZE_COUNT) {
    return NextResponse.json({ error: "Unknown maze." }, { status: 400 });
  }

  const ms = Number(body.ms);
  if (!Number.isFinite(ms) || ms <= 0) {
    return NextResponse.json({ error: "Invalid time." }, { status: 400 });
  }

  // Faster than the maze can physically be run, at full speed with no turn
  // ever costing anything.
  if (ms < minimumMs(token.board, seedIndex)) {
    return NextResponse.json({ error: "Impossible time." }, { status: 422 });
  }

  // Longer than the run has existed. Catches a token opened, left, and
  // submitted later with a small number attached.
  if (ms > Date.now() - token.issuedAt + CLOCK_SLOP_MS) {
    return NextResponse.json({ error: "Impossible time." }, { status: 422 });
  }

  const outcome = await recordRun(token.board, playerId, seedIndex, ms);

  if (outcome === "no-database") {
    return NextResponse.json({ mode: "practice" as const, seedIndex, ms });
  }
  if (outcome === "already-run") {
    return NextResponse.json(
      { error: "You have already run this maze." },
      { status: 409 },
    );
  }

  const [placing, rows] = await Promise.all([
    rankOf(token.board, seedIndex, ms),
    board(token.board, seedIndex, playerId),
  ]);

  return NextResponse.json({
    mode: "ranked" as const,
    seedIndex,
    ms,
    rank: placing?.rank ?? null,
    total: placing?.total ?? null,
    board: rows ?? [],
  });
}
