"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isOpenBoard, type HuntBoardId } from "@/lib/huntBoards";
import type { BoardRow, Placing } from "@/lib/huntFormat";

/* A leaderboard that is read rather than glanced at.
 *
 * Two things the old one could not do, and both are the same requirement
 * from different ends: the board has to hold everybody, and it has to be
 * true *now*.
 *
 * Endless. Rows arrive a page at a time and are appended, so the list on
 * screen is only ever as long as the reader has scrolled. The alternative —
 * ask for every finisher on open — is a query with no ceiling and, on a
 * phone, a thousand DOM nodes built before the first one can be read.
 *
 * Live. The loaded window is re-read on a timer, so a time that lands while
 * the board is open appears on it. Three rules keep that from being
 * obnoxious:
 *
 *   1. It stops when the tab is hidden. A backgrounded phone polling a
 *      database every few seconds is a battery complaint, not a feature.
 *   2. It refreshes the head, never the tail. Someone reading row four
 *      hundred must not have the list resorted under their thumb; the rows
 *      above them are re-read, the ones they are looking at are left alone
 *      until they scroll and pull more.
 *   3. It skips a beat while a page is already in flight, so scrolling fast
 *      never has a refresh and an append racing to write the same array.
 *   4. It only polls an edition still being dealt from. A closed board
 *      cannot change, and re-reading one every ten seconds is a query per
 *      viewer for a page that comes back identical.
 */

export type BoardState = {
  rows: BoardRow[];
  /** Everyone on this board, including the rows not fetched yet. */
  count: number;
  hasMore: boolean;
  /** Where you stand, counted server-side so it is right even when your row
   * is a long way past the last one loaded. Only the compiled board has one. */
  placing: Placing | null;
  /** Practice mode: there is no database, so there is no board — which is a
   * different thing from a board nobody has reached yet. */
  practice: boolean;
  status: "loading" | "ready" | "failed";
  /** A page is being appended right now, as opposed to the first load. */
  loadingMore: boolean;
};

const PAGE = 50;
/** How much of the list a live refresh re-reads. The server caps a page at
 * 200; asking for more would be silently truncated and the rows past the cut
 * would look like they had vanished. */
const REFRESH_MAX = 200;
const POLL_MS = 10_000;

const EMPTY: BoardState = {
  rows: [],
  count: 0,
  hasMore: false,
  placing: null,
  practice: false,
  status: "loading",
  loadingMore: false,
};

type Fetched = {
  rows?: BoardRow[];
  count?: number;
  hasMore?: boolean;
  placing?: Placing | null;
  mode?: "ranked" | "practice";
};

async function fetchPage(
  board: HuntBoardId,
  seed: number | "total",
  offset: number,
  limit: number,
  signal: AbortSignal,
): Promise<Fetched> {
  const res = await fetch(
    `/api/hunt/board?board=${board}&seed=${seed}&offset=${offset}&limit=${limit}`,
    { signal, cache: "no-store" },
  );
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Fetched;
}

export function useLiveBoard(
  /** Which leaderboard. Only an open edition is polled — see rule 4. */
  board: HuntBoardId,
  seed: number | "total",
  /** The board only works while it is on screen. A panel that is closed, or
   * a screen that has not been reached, must not be polling. */
  active: boolean,
  /** Rows the server already rendered. Passing them in is what stops the
   * finished-the-hunt screen from flashing an empty board over standings it
   * was handed with the page. */
  seeded?: { rows: BoardRow[]; count: number; placing: Placing | null } | null,
): BoardState & { loadMore: () => void; refresh: () => void } {
  const [state, setState] = useState<BoardState>(() =>
    seeded
      ? {
          ...EMPTY,
          rows: seeded.rows,
          count: seeded.count,
          hasMore: seeded.rows.length < seeded.count,
          placing: seeded.placing,
          status: "ready",
        }
      : EMPTY,
  );

  /* The board and seed the state on screen belongs to. Switching tabs must
   * not show maze three's times under maze four's heading for the moment
   * before the new page lands, and a request that finishes after the switch
   * must not write itself over the board that replaced it. */
  const view = `${board}:${seed}`;
  const shownView = useRef(view);
  /* Read inside callbacks that must not be re-created on every row that
   * arrives — an effect keyed on `loadMore` would re-subscribe the scroll
   * observer each time a page appended, which is the classic way to make an
   * infinite list fetch the same page twice.
   *
   * Written in an effect rather than during render. Assigning to a ref while
   * rendering is the shorter spelling and React does not allow it: a render
   * can be thrown away or replayed, and a ref written during one that never
   * commits is a lie about what is on screen. After the commit is both legal
   * and sufficient here, because nothing reads these during a render — only
   * the fetch callbacks do, and those run long after paint. */
  const rowsRef = useRef(state.rows);
  const hasMoreRef = useRef(state.hasMore);
  const busy = useRef(false);

  useEffect(() => {
    rowsRef.current = state.rows;
    hasMoreRef.current = state.hasMore;
  }, [state.rows, state.hasMore]);

  /* One controller for the whole hook. Every request it starts is abandoned
   * when the board closes or the seed changes, so nothing that arrives late
   * can write to a board that has moved on. */
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    busy.current = false;
    abort.current?.abort();
    abort.current = null;
    setState(EMPTY);
  }, [view]);

  /* First page. Also the reset: any time the board becomes active again it
   * re-reads from the top rather than showing however stale a list it was
   * closed on. */
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    let live = true;

    fetchPage(board, seed, 0, PAGE, ctrl.signal)
      .then((d) => {
        if (!live) return;
        const rows = d.rows ?? [];
        setState({
          rows,
          count: d.count ?? rows.length,
          hasMore: d.hasMore ?? false,
          placing: d.placing ?? null,
          practice: d.mode === "practice",
          status: "ready",
          loadingMore: false,
        });
      })
      .catch((err) => {
        if (!live || (err as Error).name === "AbortError") return;
        setState((s) => ({ ...s, status: "failed", loadingMore: false }));
      });

    return () => {
      live = false;
      ctrl.abort();
    };
  }, [board, seed, active]);

  /** The next page, appended. Guarded rather than debounced: an infinite
   * list fires its sentinel several times as it settles, and the guard is
   * what makes those extra firings free. */
  const loadMore = useCallback(() => {
    if (busy.current || !hasMoreRef.current) return;
    const offset = rowsRef.current.length;
    busy.current = true;
    setState((s) => ({ ...s, loadingMore: true }));

    const ctrl = abort.current ?? new AbortController();
    fetchPage(board, seed, offset, PAGE, ctrl.signal)
      .then((d) => {
        if (shownView.current !== view) return;
        const more = d.rows ?? [];
        setState((s) => {
          /* Position, not identity. Two requests for the same offset can
             only be the same rows, so appending on a stale offset would
             duplicate them; comparing against the length we asked from is
             what makes a double-fire a no-op rather than a double entry. */
          if (s.rows.length !== offset) return { ...s, loadingMore: false };
          return {
            ...s,
            rows: [...s.rows, ...more],
            count: d.count ?? s.count,
            hasMore: d.hasMore ?? false,
            loadingMore: false,
          };
        });
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setState((s) => ({ ...s, loadingMore: false }));
      })
      .finally(() => {
        busy.current = false;
      });
  }, [board, seed, view]);

  /** Re-read what is already on screen, up to the server's page cap. Rows
   * past the cap keep the order they were fetched in until the reader pulls
   * more — see rule 2 at the top. */
  const refresh = useCallback(() => {
    if (busy.current) return;
    const loaded = rowsRef.current.length;
    if (loaded === 0) return;
    const limit = Math.min(loaded, REFRESH_MAX);
    busy.current = true;

    const ctrl = abort.current ?? new AbortController();
    fetchPage(board, seed, 0, limit, ctrl.signal)
      .then((d) => {
        if (shownView.current !== view) return;
        const head = d.rows ?? [];
        setState((s) => ({
          ...s,
          rows: [...head, ...s.rows.slice(head.length)],
          count: d.count ?? s.count,
          hasMore: (d.count ?? s.count) > s.rows.length,
          placing: d.placing ?? s.placing,
          status: "ready",
        }));
      })
      .catch(() => {})
      .finally(() => {
        busy.current = false;
      });
  }, [board, seed, view]);

  /* The timer. Paused with the tab, and given a refresh the moment the tab
   * comes back rather than waiting out whatever was left of the interval —
   * the first thing someone does on returning to a live board is look at it. */
  useEffect(() => {
    if (!active || !isOpenBoard(board)) return;

    let timer: number | null = null;
    const stop = () => {
      if (timer != null) window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = window.setInterval(refresh, POLL_MS);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, board, refresh]);

  return { ...state, loadMore, refresh };
}
