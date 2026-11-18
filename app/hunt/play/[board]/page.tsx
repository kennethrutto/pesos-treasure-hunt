import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import HuntGame from "@/components/hunt/HuntGame";
import {
  HUNT_BOARDS,
  isHuntBoardId,
  isOpenBoard,
  type HuntBoardId,
} from "@/lib/huntBoards";
import {
  HUNT_COOKIE,
  huntSigningAvailable,
  unpackPlayerId,
} from "@/lib/huntSession";
import {
  completedSeeds,
  getPlayerName,
  playerRecord,
  totalBoard,
  totalBoardCount,
  totalRankOf,
} from "@/lib/huntStore";
import { MAZE_COUNT } from "@/lib/maze";
import { SITE_NAME } from "@/lib/site";

/* One edition of the hunt, played.
 *
 * The edition is in the URL rather than in the code. Both are dealt from,
 * both are written to, and which one a run belongs to is settled here and
 * carried through the run token — see /api/hunt/start.
 *
 * A closed edition 404s rather than rendering read-only: its results page is
 * where a board nobody is running lives, and a maze you cannot submit a time
 * for is a worse thing to hand someone than a link that says no.
 */

export const dynamic = "force-dynamic";

/** Rows of the compiled board sent with the HTML; matches DEFAULT_LIMIT in
 * app/api/hunt/board/route.ts, so there is no seam where the server's page
 * ends and the client's first fetch begins. */
const FIRST_PAGE = 50;

type Params = { params: Promise<{ board: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { board } = await params;
  if (!isHuntBoardId(board) || !isOpenBoard(board)) return {};
  return {
    title: `${HUNT_BOARDS[board].label} hunt`,
    description: `Run the maze. Five rounds, one compiled time. ${SITE_NAME}.`,
    alternates: { canonical: `/hunt/play/${board}` },
  };
}

export default async function HuntPlayPage({ params }: Params) {
  const { board: raw } = await params;
  if (!isHuntBoardId(raw) || !isOpenBoard(raw)) notFound();
  const board: HuntBoardId = raw;

  const jar = await cookies();
  const playerId = unpackPlayerId(jar.get(HUNT_COOKIE)?.value);

  const completed = playerId ? await completedSeeds(board, playerId) : null;
  const name = playerId ? await getPlayerName(playerId) : null;
  const done = completed ?? [];
  const finished = done.length >= MAZE_COUNT;

  /* The compiled board's first page, read here rather than fetched after
   * mount, so a reload answers "where do I stand now" in the first paint.
   * Only for a finished player; there is nothing to stand in before then. */
  const total =
    finished && playerId
      ? {
          rows: (await totalBoard(board, playerId, FIRST_PAGE)) ?? [],
          count: (await totalBoardCount(board)) ?? 0,
          placing: await totalRankOf(board, playerId),
        }
      : null;

  return (
    <HuntGame
      board={board}
      initial={{
        // Ranked needs both halves: somewhere to write, and a secret to sign
        // runs with. Missing either and the hunt is still playable, just not
        // recorded — see huntDb.ts.
        ranked: completed != null && huntSigningAvailable(),
        name,
        completed: done,
        record:
          finished && playerId
            ? ((await playerRecord(board, playerId)) ?? [])
            : null,
        total,
      }}
    />
  );
}
