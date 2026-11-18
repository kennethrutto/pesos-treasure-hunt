import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { LeaderboardPanel } from "@/components/hunt/LeaderboardPanel";
import {
  isOpenBoard,
  HUNT_BOARDS,
  isHuntBoardId,
  resultsPath,
} from "@/lib/huntBoards";
import { HUNT_COOKIE, unpackPlayerId } from "@/lib/huntSession";
import { totalBoard, totalBoardCount, totalRankOf } from "@/lib/huntStore";
import { MAZE_COUNT } from "@/lib/maze";
import { SITE_NAME } from "@/lib/site";

/* A board's results, as a link.
 *
 * Launch Day's is why this exists. The hunt moved on to a new board, and the
 * standings it finished with had to stay somewhere anyone could be sent to —
 * as they were, not re-run or re-ranked. Every edition gets one: an open
 * edition's is its live standings with no maze in front of them.
 *
 * Read-only. Nothing here writes, and nothing the game writes can reach an
 * edition that has closed — see /api/hunt/finish.
 */

/* Reads the cookie to mark the visitor's own row, so it renders per request. */
export const dynamic = "force-dynamic";

/** Matches DEFAULT_LIMIT in app/api/hunt/board/route.ts, for the reason
 * app/hunt/page.tsx gives: two page sizes would show a seam. */
const FIRST_PAGE = 50;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ board: string }>;
}): Promise<Metadata> {
  const { board } = await params;
  if (!isHuntBoardId(board)) return { title: "Leaderboard not found" };

  const standings = isOpenBoard(board) ? "Live" : "Final";
  return {
    title: HUNT_BOARDS[board].title,
    description: `${standings} standings from the treasure hunt: ${MAZE_COUNT} rounds, one compiled time. ${SITE_NAME}.`,
    alternates: { canonical: resultsPath(board) },
  };
}

export default async function HuntResultsPage({
  params,
}: {
  params: Promise<{ board: string }>;
}) {
  const { board } = await params;
  if (!isHuntBoardId(board)) notFound();

  const jar = await cookies();
  const playerId = unpackPlayerId(jar.get(HUNT_COOKIE)?.value);

  /* The compiled board's first page, in the HTML — a results link that
   * opens on "Reading…" is a worse thing to hand someone than one that opens
   * on the results. */
  const [rows, count, placing] = await Promise.all([
    totalBoard(board, playerId, FIRST_PAGE),
    totalBoardCount(board),
    playerId ? totalRankOf(board, playerId) : null,
  ]);

  return (
    /* z-[1] and the fixed frame for the same reasons as the game: see
       FooterGate, which keeps the site footer off this route. */
    <main className="pesos-below-navbar-fixed z-[1] w-full overflow-hidden bg-[#0a0b0d]">
      <LeaderboardPanel
        board={board}
        className="h-full"
        /* No database, no first page: the panel reads again and says the
           board cannot be read, rather than rendering an empty one as though
           nobody had finished. */
        seeded={rows != null && count != null ? { rows, count, placing } : null}
      />
    </main>
  );
}
