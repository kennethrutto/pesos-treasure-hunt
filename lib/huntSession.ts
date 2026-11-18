import "server-only";

import type { NextResponse } from "next/server";
import { createHmac, randomBytes } from "node:crypto";

import { isHuntBoardId, type HuntBoardId } from "@/lib/huntBoards";
import { safeEqual } from "@/lib/timingSafe";

/* Who is running, and proof that a run actually happened.
 *
 * Two separate secrets-backed things live here because they answer two
 * different questions: the cookie says *who you are* across visits, and the
 * run token says *this maze was issued to you, at this moment, by us*.
 *
 * ── What this does and does not stop ────────────────────────────────────
 * A time is reported by a browser, and a browser can lie. The token makes
 * the cheap lies fail: you cannot submit for a maze you were not given,
 * reuse a token, claim a time shorter than the maze can physically be run
 * in, or claim one longer than the wall clock since we handed it to you.
 *
 * It does not stop someone who scripts the game itself — replaying their
 * own inputs faster than a human can. Catching that needs the server to
 * re-simulate the submitted input sequence, which is possible (the runner
 * in lib/mazeRunner.ts is pure and deterministic) and is the thing to build
 * if the boards ever start mattering enough to be worth cheating.
 */

const PLAYER_COOKIE = "pesos_hunt";
const PLAYER_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** A run has to be finished in a sitting. Long enough for a slow, careful
 * player and a phone call; short enough that tokens are not stockpiled. */
const RUN_TTL_MS = 60 * 60 * 1000;

/** HUNT_SECRET, and nothing else. It used to fall back to the site
 * password, which no longer exists anywhere; with no secret at all the hunt
 * stays in practice mode, which is the honest answer for a time nobody can
 * sign. Deliberately not a per-process random: Passenger may run several
 * workers, and a token signed by one would be rejected by the next. */
function secret(): string | null {
  return process.env.HUNT_SECRET?.trim() || null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

export function huntSigningAvailable(): boolean {
  return secret() != null;
}

/* ---------- player identity ---------- */

export const HUNT_COOKIE = PLAYER_COOKIE;
export const HUNT_COOKIE_MAX_AGE = Math.floor(PLAYER_TTL_MS / 1000);

export function newPlayerId(): string {
  return randomBytes(16).toString("hex");
}

/** Writes the identity cookie onto a response.
 *
 * Shared by /api/hunt/enter and /api/hunt/start rather than written out at
 * each: the two disagree-able details here are `httpOnly` and the signing
 * in packPlayerId, and a second copy that quietly drops either is exactly
 * the bug that would not show up until someone forged a handle. */
export function setPlayerCookie(res: NextResponse, playerId: string): void {
  res.cookies.set(PLAYER_COOKIE, packPlayerId(playerId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: HUNT_COOKIE_MAX_AGE,
  });
}

/** `<id>.<hmac>`. Signing does not stop someone clearing their cookies to
 * start over — nothing short of accounts does — but it does stop one
 * visitor wearing another's identity and speaking as their handle. */
export function packPlayerId(id: string): string {
  const key = secret();
  if (!key) return id;
  return `${id}.${sign(id, key)}`;
}

export function unpackPlayerId(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const key = secret();

  const dot = cookie.lastIndexOf(".");
  if (dot < 1) {
    // Unsigned, from a deploy before a secret existed. Accept the raw id
    // only while there is no key to check it against.
    return !key && /^[0-9a-f]{32}$/.test(cookie) ? cookie : null;
  }

  const id = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  if (!key) return null;
  return safeEqual(mac, sign(id, key)) ? id : null;
}

/* ---------- run tokens ---------- */

export type RunToken = {
  playerId: string;
  board: HuntBoardId;
  seedIndex: number;
  issuedAt: number;
};

/** `<playerId>.<board>.<seedIndex>.<issuedAt>.<hmac>` — every field is in
 * the signature, so none of them can be edited on the way back.
 *
 * The board is in it so a run is recorded on the board it was dealt from or
 * not at all. A token issued before an edition closed names a board
 * that has since closed, and is refused rather than filed under the new one.
 * Tokens from before boards existed have four parts and fail the same way,
 * which is the right answer for a run in flight when the season changed. */
export function issueRunToken(
  playerId: string,
  board: HuntBoardId,
  seedIndex: number,
): string | null {
  const key = secret();
  if (!key) return null;
  const body = `${playerId}.${board}.${seedIndex}.${Date.now()}`;
  return `${body}.${sign(body, key)}`;
}

export function verifyRunToken(token: string | undefined): RunToken | null {
  const key = secret();
  if (!key || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [playerId, board, seedRaw, issuedRaw, mac] = parts;

  if (
    !safeEqual(mac, sign(`${playerId}.${board}.${seedRaw}.${issuedRaw}`, key))
  ) {
    return null;
  }

  if (!isHuntBoardId(board)) return null;
  const seedIndex = Number(seedRaw);
  const issuedAt = Number(issuedRaw);
  if (!Number.isInteger(seedIndex) || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > RUN_TTL_MS) return null;
  // A clock that reads in the future means a forged or replayed issue time.
  if (issuedAt > Date.now() + 5000) return null;

  return { playerId, board, seedIndex, issuedAt };
}

