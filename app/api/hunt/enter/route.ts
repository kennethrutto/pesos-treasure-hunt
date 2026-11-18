import { NextRequest, NextResponse } from "next/server";

import {
  HUNT_COOKIE,
  huntSigningAvailable,
  newPlayerId,
  setPlayerCookie,
  unpackPlayerId,
} from "@/lib/huntSession";
import { nameFor } from "@/lib/huntNames";
import { DEFAULT_BOARD, isHuntBoardId, isOpenBoard } from "@/lib/huntBoards";
import { completedSeeds, ensureNamedPlayer } from "@/lib/huntStore";
import { MAZE_COUNT } from "@/lib/maze";

/* Entering the garden.
 *
 * Arriving is what earns you a name — not pressing Begin. That ordering is
 * the whole point of the flow: you are met at the gate and told who you are,
 * and only then offered a maze.
 *
 * It needs its own route because the page is a Server Component, and a
 * Server Component cannot set a cookie. Identity has to be minted somewhere
 * that owns a response, so it is minted here, once, on mount.
 *
 * Idempotent by construction: a returning visitor's cookie resolves to the
 * same id, ensureNamedPlayer finds the row already there, and the same name
 * comes back. Calling it twice costs two SELECTs and changes nothing.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const existing = unpackPlayerId(req.cookies.get(HUNT_COOKIE)?.value);
  const playerId = existing ?? newPlayerId();

  /* Ranked needs both halves: somewhere to write, and a secret to sign runs
   * with. Missing either, the hunt is still playable — just not recorded. */
  const stored = huntSigningAvailable()
    ? await ensureNamedPlayer(playerId)
    : null;
  const ranked = stored != null;

  /* Progress is per edition, so the caller says which one it is showing.
   * Anything else — an older page, a malformed body — is answered for the
   * newest open edition rather than refused: a name is worth handing over
   * either way. */
  const asked = (await req.json().catch(() => null)) as { board?: unknown } | null;
  const wanted =
    typeof asked?.board === "string" &&
    isHuntBoardId(asked.board) &&
    isOpenBoard(asked.board)
      ? asked.board
      : DEFAULT_BOARD;

  const done = ranked ? ((await completedSeeds(wanted, playerId)) ?? []) : [];

  const res = NextResponse.json({
    ranked,
    /* Whether this visit is where the name was handed over. The full
     * proclamation is worth watching once; on the ninth visit it is a
     * splash screen standing between you and a maze. */
    issued: existing == null,
    /* Named either way. The stored name and the derived one are the same
     * string for all but the handful of players who lost a collision, so
     * this is a fallback in the literal sense rather than a second scheme:
     * without a database there is no index to arbitrate with, and with no
     * one else to collide against there is nothing to arbitrate. */
    name: stored ?? nameFor(playerId),
    completed: done,
    remaining: MAZE_COUNT - done.length,
  });

  // Only for a visitor who did not arrive with one. Re-setting an existing
  // cookie would push its year-long expiry out on every page view, which is
  // a different and sneakier thing than remembering someone.
  if (!existing) setPlayerCookie(res, playerId);
  return res;
}
