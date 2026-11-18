"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import { formatTime, tilt, type BoardRow } from "@/lib/huntFormat";

/* The rows of a board, and the thing at the bottom of them that asks for
 * more.
 *
 * One look wherever a board is shown: marker on strips of tape, each hung a
 * little crooked, as on the lap-times board beside the maze. The panel used
 * to get a plain dense table instead, and a board that read as a spreadsheet
 * in one place and a workshop wall in another was two objects pretending to
 * be one.
 *
 * What still differs is the surface. The panel and the results pages are
 * dark; the finish screen is the washed-out floor the mark rose through. The
 * strips carry their own background, so only the notes under them change.
 *
 * Strips are not cheap — a rotate and two shadows per row — and that is
 * exactly why they are paged rather than rendered all at once.
 */

/** Pulls the next page in when the reader gets near the end of this one.
 *
 * rootMargin, not a scroll handler. The sentinel is watched a screen and a
 * half early so the next page is usually already there by the time the last
 * loaded row goes past, which is the difference between an endless list and
 * a list that stops to think every fifty rows.
 *
 * `root: null` deliberately: it watches the nearest scrollport automatically,
 * so the same component works inside the panel's own scroller and inside the
 * finish screen's, without either having to say which it is. */
function Sentinel({
  onVisible,
  children,
}: {
  onVisible: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /* The callback identity changes whenever the hook re-renders, and
   * re-subscribing an observer on every appended row is how an infinite list
   * ends up asking for the same page twice. The effect watches the element,
   * never the function — and the latest callback is parked after the commit
   * rather than during the render, which React does not allow. */
  const cb = useRef(onVisible);
  useEffect(() => {
    cb.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: "150% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <div ref={ref}>{children}</div>;
}

export function BoardList({
  rows,
  surface,
  hasMore,
  loadingMore,
  onLoadMore,
  emptyLabel,
  /** A row for the reader themselves when they are further down than the
   * rows loaded. Dropped once their real row is on screen — two of the same
   * person on one board reads as a bug, because it is one. */
  ownRow,
}: {
  rows: BoardRow[];
  /** What the board is laid on. Only the notes under the strips care. */
  surface: "dark" | "light";
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  emptyLabel: string;
  ownRow?: { rank: number; name: string; ms: number } | null;
}) {
  const showOwn = ownRow != null && !rows.some((r) => r.you);

  if (rows.length === 0) {
    return (
      <p
        className={cn(
          "py-8 text-center font-sans text-[13px] uppercase tracking-[0.13em]",
          surface === "dark" ? "text-[#9aa6b3]" : "text-[#5b646e]",
        )}
      >
        {emptyLabel}
      </p>
    );
  }

  const more = (
    <Sentinel onVisible={onLoadMore}>
      {hasMore ? (
        <p
          className={cn(
            "py-5 text-center font-sans text-[12px] uppercase tracking-[0.16em]",
            surface === "dark" ? "text-[#9aa6b3]" : "text-[#5b646e]",
          )}
        >
          {loadingMore ? "Reading…" : "More below"}
        </p>
      ) : (
        <p
          className={cn(
            "py-5 text-center font-sans text-[12px] uppercase tracking-[0.16em]",
            surface === "dark" ? "text-[#5b646e]" : "text-[#98a1ab]",
          )}
        >
          End of the board
        </p>
      )}
    </Sentinel>
  );

  return (
    <>
      <div className="pesos-finalboard">
        {rows.map((r, i) => (
          <div
            key={`${r.rank}-${r.name}`}
            className={cn("pesos-lapboard__strip", r.you && "is-you")}
            style={tilt(i)}
          >
            <span className="pesos-lapboard__rank">{r.rank}</span>
            <span className="pesos-lapboard__name">{r.name}</span>
            <span className="pesos-lapboard__time">{formatTime(r.ms)}</span>
          </div>
        ))}

        {showOwn && (
          <div
            className="pesos-lapboard__strip is-you"
            style={tilt(rows.length)}
          >
            <span className="pesos-lapboard__rank">{ownRow.rank}</span>
            <span className="pesos-lapboard__name">{ownRow.name}</span>
            <span className="pesos-lapboard__time">
              {formatTime(ownRow.ms)}
            </span>
          </div>
        )}
      </div>
      {more}
    </>
  );
}
