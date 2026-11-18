"use client";

import Link from "next/link";
import { useState } from "react";

import { BoardList } from "@/components/hunt/BoardList";
import { useLiveBoard } from "@/components/hunt/useLiveBoard";
import { cn } from "@/lib/cn";
import {
  HUNT_BOARD_IDS,
  HUNT_BOARDS,
  isOpenBoard,
  playPath,
  resultsPath,
  type HuntBoardId,
} from "@/lib/huntBoards";
import type { BoardRow, Placing } from "@/lib/huntFormat";
import { MAZE_COUNT } from "@/lib/maze";

/** Side padding that turns into margin on a wide screen, so every row of the
 * panel — header, tabs, strips, the links at the foot — shares one centred
 * column no wider than the finish screen's, while the rules between them and
 * the scrollport itself still run edge to edge (a wheel anywhere over the
 * board scrolls it). The strips are why: tilted by the same angle across a
 * full desktop width, their ends rose and fell by forty pixels and ran into
 * one another. */
const BOARD_GUTTER =
  "px-[max(1rem,calc((100%_-_30rem)/2))] sm:px-[max(1.25rem,calc((100%_-_30rem)/2))]";

/** The boards, browsable at any time — live, and as long as they need to be.
 *
 * One board per maze, because nobody can run a maze twice — so each row is a
 * different person's single attempt, and being second is a real result
 * rather than a note that someone had more free time.
 *
 * Everyone is on it. It used to be a top twenty, which is the right size for
 * a thing glanced at between rounds and the wrong size for the only place a
 * player can go and look themselves up. Rows arrive as they are scrolled to
 * and the loaded ones are re-read on a timer, so a board left open while
 * other people are running keeps up with them — see useLiveBoard.
 *
 * Laid out as a phone screen that a desktop also gets: one column, a header
 * and a strip of tabs that stay put, and the rows scrolling under them. Its
 * own scroller is the only thing that moves — the page behind it cannot be
 * pulled around by accident.
 *
 * Two places, one panel. Over the game it is the current board, dismissed
 * with Close. On /hunt/results/<board> it is the whole page, for a board that
 * may have closed long ago, and the way into the hunt stands where Close
 * would. Both end on links to the other boards, so a season that has closed
 * is one tap from the one that replaced it.
 */
export function LeaderboardPanel({
  board,
  completed = null,
  seeded = null,
  onClose,
  onSelectBoard,
  className,
}: {
  board: HuntBoardId;
  /** The mazes this player has run on this board, which lights their tabs.
   * Only the game knows; the results page passes nothing and every tab reads
   * the same. */
  completed?: number[] | null;
  /** The compiled board's first page, when the server has already read it. */
  seeded?: { rows: BoardRow[]; count: number; placing: Placing | null } | null;
  /** Present over the game, where the panel closes back to the maze. Absent
   * on the results page, where the panel is the page. */
  onClose?: () => void;
  /** Present over the game: the other boards open in this panel rather than
   * leaving the page for their results links, so a board looked at from the
   * way in closes back to the way in. */
  onSelectBoard?: (board: HuntBoardId) => void;
  className?: string;
}) {
  /* "total" is the compiled board — every maze added together, which is
   * what the hunt is won on. It opens on that rather than on whichever maze
   * you just ran: the per-maze boards are the detail, the total is the
   * result. */
  const [seed, setSeed] = useState<number | "total">("total");
  const standings = useLiveBoard(board, seed, true, seeded);

  /* Only the board being played can still change. A closed one is labelled
   * final instead — a pulsing light over standings that cannot move would be
   * a claim the board is not making. */
  const live = isOpenBoard(board);
  const others = HUNT_BOARD_IDS.filter((id) => id !== board);

  const heading =
    seed === "total"
      ? standings.count === 1
        ? "1 finisher"
        : `${standings.count} finishers`
      : standings.count === 1
        ? "1 run"
        : `${standings.count} runs`;

  return (
    <div
      className={cn("flex flex-col", className)}
      onClick={(e) => e.stopPropagation()}
      /* The panel is a list; the game frame under it has touch-action none so
         a drag steers the runner. Handing scrolling back is what makes the
         board scrollable with a thumb at all. */
      style={{ touchAction: "pan-y" }}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b border-white/10 py-3 sm:py-4",
          BOARD_GUTTER,
        )}
      >
        <div className="min-w-0">
          <span className="block font-sans text-[13px] uppercase tracking-[0.16em] text-[#f4f6f8]">
            {HUNT_BOARDS[board].title}
          </span>
          {/* What it is showing and whether it is still watching. The dot is
              the whole "live" claim, so it only appears once a board has
              actually been read — a pulse over "Reading…" is a promise, not a
              state. */}
          {standings.status === "ready" && !standings.practice && (
            <span className="mt-0.5 flex items-center gap-1.5 font-sans text-[11px] uppercase tracking-[0.14em] text-[#9aa6b3]">
              {live && (
                <span
                  aria-hidden
                  className="pesos-live-dot inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-[#e03127]"
                />
              )}
              {live ? "Live" : "Final"} · {heading}
            </span>
          )}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="pesos-hunt-btn shrink-0 rounded-[2px] border border-white/45 px-5 font-sans text-[13px] font-semibold uppercase tracking-[0.14em] text-[#e6ecf2] transition-colors hover:border-white hover:text-[#ffffff]"
          >
            Close
          </button>
        ) : (
          /* Standings read on their own page, rather than over the game.
             Play goes to THIS hunt — the one whose times are being read —
             and a hunt that has closed has nothing to play, so its button
             offers the rail of the ones that do. */
          <Link
            href={live ? playPath(board) : "/hunt"}
            className="group pesos-hunt-btn shrink-0 rounded-[2px] border border-white/45 px-5 font-sans text-[13px] font-semibold uppercase tracking-[0.14em] transition-colors hover:border-white"
          >
            {/* The colour is on the span because a text utility on the
                anchor itself loses to the site's global `a { color: inherit }`
                — see the links at the foot. */}
            <span className="text-[#e6ecf2] transition-colors group-hover:text-[#ffffff]">
              {live ? "Play" : "All hunts"}
            </span>
          </Link>
        )}
      </div>

      {/* Total first, then every maze, run or not — seeing what you are up
          against before you start is half the point of a board.

          Scrolls sideways on a narrow screen rather than wrapping onto a
          second line, because a wrapped row of tabs pushes the board itself
          off the bottom of a phone. */}
      <div
        className={cn(
          "pesos-board-tabs flex shrink-0 gap-1.5 overflow-x-auto py-2.5 sm:py-3",
          BOARD_GUTTER,
        )}
      >
        <button
          type="button"
          onClick={() => setSeed("total")}
          className={cn(
            "pesos-hunt-tab shrink-0 rounded-[2px] border px-3 font-sans text-[13px] uppercase tracking-[0.10em] transition-colors",
            seed === "total"
              ? "border-white/60 text-[#f4f6f8]"
              : "border-white/20 text-[#c3ccd6]",
          )}
        >
          Total
        </button>
        {Array.from({ length: MAZE_COUNT }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setSeed(i)}
            className={cn(
              "pesos-hunt-tab shrink-0 rounded-[2px] border px-3 font-sans text-[13px] tabular-nums tracking-[0.10em] transition-colors",
              i === seed
                ? "border-white/60 text-[#f4f6f8]"
                : !completed || completed.includes(i)
                  ? "border-white/20 text-[#c3ccd6]"
                  : "border-white/10 text-[#9aa6b3]",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* The scrollport. `overscroll-contain` is what stops a flick at the
          end of the board from scrolling the page behind it, and the room on
          top is for the first strip's tilt, which the scrollport's edge would
          otherwise shave off. */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pb-6",
          BOARD_GUTTER,
        )}
      >
        {standings.status === "failed" && (
          <p className="py-8 text-center font-sans text-[13px] uppercase tracking-[0.13em] text-[#e3574c]">
            Could not load that board.
          </p>
        )}
        {standings.status === "loading" && (
          <p className="py-8 text-center font-sans text-[13px] uppercase tracking-[0.13em] text-[#9aa6b3]">
            Reading…
          </p>
        )}
        {standings.status === "ready" && (
          <BoardList
            surface="dark"
            rows={standings.rows}
            hasMore={standings.hasMore}
            loadingMore={standings.loadingMore}
            onLoadMore={standings.loadMore}
            emptyLabel={
              standings.practice
                ? /* No database. Over the game, on the board being played,
                     that is practice mode; anywhere else there is no run to
                     practise, only a board that could not be read. */
                  onClose && live
                  ? "Practice run; nothing is being recorded."
                  : "This board cannot be read right now."
                : seed === "total"
                  ? live
                    ? `Nobody has finished all ${MAZE_COUNT} yet.`
                    : `Nobody finished all ${MAZE_COUNT}.`
                  : live
                    ? `Nobody has run maze ${seed + 1} yet.`
                    : `Nobody ran maze ${seed + 1}.`
            }
            /* Only the compiled board has a standing to report; a per-maze
               row is either in the list or the maze has not been run. */
            ownRow={
              seed === "total" && standings.placing
                ? {
                    rank: standings.placing.rank,
                    name: "You",
                    ms: standings.placing.ms,
                  }
                : null
            }
          />
        )}
      </div>

      {/* The other boards. Pinned under the list rather than at the end of
          it, where a board of four hundred finishers would bury them. The
          padding under it is the home indicator on a modern phone.

          Coloured on the nav and on spans inside the links, never on the
          links themselves: the site's global `a { color: inherit }` sits
          outside Tailwind's layers and beats any text utility on an anchor,
          hover ones included. */}
      {others.length > 0 && (
        <nav
          aria-label="Other leaderboards"
          className={cn(
            "pesos-board-foot flex shrink-0 flex-wrap gap-x-6 border-t border-white/10 text-[#9aa6b3]",
            BOARD_GUTTER,
          )}
        >
          {others.map((id) => {
            const face = (
              <>
                <span className="transition-colors group-hover:text-[#f4f6f8]">
                  {HUNT_BOARDS[id].title}
                </span>
                <span
                  aria-hidden="true"
                  className="transition-colors group-hover:text-[#f4f6f8]"
                >
                  &rarr;
                </span>
              </>
            );
            const look =
              "group inline-flex min-h-[44px] items-center gap-2 font-sans text-[12px] uppercase tracking-[0.16em]";
            return onSelectBoard ? (
              <button
                key={id}
                type="button"
                onClick={() => onSelectBoard(id)}
                className={look}
              >
                {face}
              </button>
            ) : (
              <Link key={id} href={resultsPath(id)} className={look}>
                {face}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
