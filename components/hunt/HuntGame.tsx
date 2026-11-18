"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { BoardList } from "@/components/hunt/BoardList";
import HuntScene from "@/components/hunt/HuntScene";
import { LeaderboardPanel } from "@/components/hunt/LeaderboardPanel";
import { useLiveBoard } from "@/components/hunt/useLiveBoard";
import { useBackgroundColor } from "@/context/BackgroundColorContext";
import { trackHunt } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import {
  HUNT_BOARD_IDS,
  HUNT_BOARDS,
  mazeSeed,
  resultsPath,
  type HuntBoardId,
} from "@/lib/huntBoards";
import {
  formatTime,
  ordinal,
  tilt,
  type BoardRow,
  type Placing,
} from "@/lib/huntFormat";
import { generateMaze, MAZE_COUNT, type Dir } from "@/lib/maze";
import {
  createRunner,
  RUN_SPEED,
  solved as isSolved,
  step,
} from "@/lib/mazeRunner";

/* The hunt: run the maze, and the maze walks itself into the mark.
 *
 * State lives in three places on purpose. React state holds only what
 * changes the DOM — the phase, the finished time, the board. The runner and
 * the pressed direction live in refs, because input at sixty hertz must not
 * re-render anything. The clock writes its digits straight into a text node
 * for the same reason: a timer in React state is a re-render every frame,
 * and it would be the most expensive thing on the page.
 *
 * Which maze you get is NOT decided here. The server picks it from the ones
 * this player has not run and signs a token naming it, because a client
 * that chooses its own maze can always choose one it has already beaten.
 */

type Phase =
  | "ready"
  | "starting"
  | "dealing"
  | "running"
  | "solved"
  | "complete";

type PlayerRun = { seedIndex: number; ms: number; rank: number };

/* The hunt's reading type, taken from the policy pages.
 *
 * Those are the one part of this site built to be read at length — heavy
 * grotesque, tight negative tracking, body text brighter than the headings
 * above it — and the welcome and the rules are the only screens here that
 * ask for the same. Everything else in the hunt is a HUD glanced at over a
 * moving maze, which is a different job and reads badly at this size.
 *
 * Kept as constants rather than repeated per element so the two screens
 * cannot drift apart, and so the one number anyone will want to change is
 * in one place. */
const HUNT_BODY =
  "font-sans text-[clamp(17px,1.45vw,25px)] font-bold leading-[1.4] tracking-[-0.04em] text-[#fafafa]";
/** The mark and the name are the two things stepped up from the body. The
 * name is the larger of the two: it is what people came for. */
const HUNT_MARK =
  "pesos-text-face text-[clamp(26px,2.6vw,44px)] font-bold uppercase leading-[1] tracking-[-0.04em] text-[#fafafa]";
const HUNT_NAME =
  "pesos-text-face text-[clamp(30px,3.2vw,54px)] font-bold uppercase leading-[1] tracking-[-0.04em] text-[#fafafa]";
/** How the way in's buttons look, apart from where they sit. Rules and Begin
 * stand alone under the text; the leaderboards share a row at the foot. */
const HUNT_BUTTON_FACE =
  "pointer-events-auto rounded-[2px] border border-white/40 bg-white/10 font-sans text-[14px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-md transition-colors hover:border-white hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-1 focus-visible:outline-white disabled:cursor-default disabled:opacity-40 disabled:hover:border-white/40 disabled:hover:bg-white/10 disabled:hover:text-white";
const HUNT_BUTTON = `${HUNT_BUTTON_FACE} mt-2 self-start px-8 py-4`;
/** The way back to the rail, from the two screens that are not a run. Quiet
 * on purpose — it is an exit, not an offer — and its colour is left to the
 * caller, because one of the two screens is white. */
const HUNT_BACK =
  "pointer-events-auto -m-2 inline-flex min-h-[44px] items-center gap-2 p-2 font-sans text-[13px] uppercase tracking-[0.14em]";

const SWIPE_THRESHOLD = 26;
/** Matches REVEAL_SECONDS in the scene — the result panel waits for the
 * mark to finish forming rather than landing on top of the animation. */
const REVEAL_MS = 2400;
/** The beat before a round with no mark standing over it — the first one.
 * Long enough to read which round is starting, short enough that it is not
 * felt as a wait. */
const DEAL_MS = 900;

/* The edition's colour, for the site background behind the navbar, comes
 * from its palette — see lib/huntBoards.ts. Derived into a glow by
 * paletteFromHex, the same as a product page's accent. */

/* matchMedia is an external store, so it is read as one. The alternative —
 * an effect that calls setState on mount — is a second render on every
 * visit and is what the react-hooks lint rule is pointing at. */
function subscribeMotion(onChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const motionSnapshot = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* The server cannot know, and guessing "reduced" would make the first
 * client frame contradict the markup. False matches the common case. */
const motionServerSnapshot = () => false;

const KEY_TO_DIR: Record<string, Dir> = {
  ArrowUp: 0,
  ArrowRight: 1,
  ArrowDown: 2,
  ArrowLeft: 3,
  w: 0,
  d: 1,
  s: 2,
  a: 3,
  W: 0,
  D: 1,
  S: 2,
  A: 3,
};

export type HuntGameProps = {
  /** The edition being played. Everything the game reads, writes or draws
   * hangs off this: its five mazes, its board, and its garden. */
  board: HuntBoardId;
  initial: {
    ranked: boolean;
    name: string | null;
    completed: number[];
    record: PlayerRun[] | null;
    /* The first page of the compiled board, rendered with the page rather
     * than fetched after it. This is what makes a refresh answer the question
     * someone reloads to ask — where do I stand *now* — in the first paint
     * instead of after a round trip. Null until the hunt is finished; there
     * is no standing to show before then.
     *
     * A page, not the board: `count` is every finisher, `rows` is as many of
     * them as are worth building before anyone has scrolled. The rest arrive
     * as the reader asks for them. */
    total: {
      rows: BoardRow[];
      count: number;
      placing: Placing | null;
    } | null;
  };
};

export default function HuntGame({ board, initial }: HuntGameProps) {
  const palette = HUNT_BOARDS[board].garden;
  const [phase, setPhase] = useState<Phase>(
    initial.record ? "complete" : "ready",
  );
  const [seedIndex, setSeedIndex] = useState<number | null>(null);
  const [completed, setCompleted] = useState<number[]>(initial.completed);
  const [name, setName] = useState(initial.name ?? "");
  /* Not `initial.ranked` alone: a first-time visitor has no cookie, so
   * the server cannot know them and renders unranked. Entering the garden is
   * what settles it, a moment later. */
  const [ranked, setRanked] = useState(initial.ranked);
  /* Which half of the way in is showing, or null once it is behind you.
   * Two steps rather than one because they are two different jobs: the
   * welcome is the hook (the name is the thing people came for), and the
   * rules are the part that decides whether an entry counts. On one card
   * nobody reads the rules.
   *
   * Shown once per hunt, not once per round. It used to stand in front of
   * every maze on the grounds that the rules are worth re-reading — but the
   * hunt is five rounds now, and four returns to a screen already read is a
   * toll gate rather than a briefing. Round four is announced by the
   * hand-off plate instead, which is a beat rather than a page.
   *
   * Null from the start for a player who has already finished: they are
   * looking at the standings, not at a way in. */
  const [intro, setIntro] = useState<"welcome" | "rules" | null>(
    initial.record ? null : "welcome",
  );
  /* Which board's panel is open over the game, if any. The way in offers
   * every board; everything after it offers the one being played. */
  const [boardOpen, setBoardOpen] = useState<HuntBoardId | null>(null);
  const [finalMs, setFinalMs] = useState<number | null>(null);
  const [placing, setPlacing] = useState<{ rank: number; total: number } | null>(
    null,
  );
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [record, setRecord] = useState<PlayerRun[] | null>(initial.record);
  const [notice, setNotice] = useState<string | null>(null);
  /* Rounds run when nothing is being recorded. The database is the authority
   * whenever there is one — `completed` — but practice mode has no database
   * to count for it, and a hunt advertised as five rounds that never reaches
   * a fifth is a broken one even in rehearsal. */
  const [practiceDone, setPracticeDone] = useState(0);

  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    motionSnapshot,
    motionServerSnapshot,
  );

  /* Maze 1 stands in behind the start overlay so there is something to look
   * at; a run only ever uses the seed the server handed back. */
  const maze = useMemo(
    () => generateMaze(mazeSeed(board, seedIndex ?? 0)),
    [board, seedIndex],
  );
  const runnerRef = useRef(createRunner(maze));
  const startedAtRef = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);

  /* You are named on arrival, not on your first run.
   *
   * The page is a Server Component and cannot set a cookie, so the visitor
   * is registered by a route handler instead — once, here. The ref is what
   * makes it once: StrictMode deliberately mounts, unmounts and remounts in
   * development, and refs survive that, so the second pass sees the flag and
   * does not ask again.
   *
   * Deliberately no `live` cleanup flag. Pairing one with the ref guard is
   * the obvious-looking thing and it is wrong: the unmount sets live=false,
   * the remount is skipped by the ref, and the single response in flight is
   * then discarded by a component that is very much still on screen. The
   * symptom is a nameless hunt in development and a working one in
   * production, which is the worst way to find out. A resolved fetch setting
   * state on an unmounted component is a no-op in React 18+, so there is
   * nothing here that needed cancelling. */
  const entered = useRef(false);
  useEffect(() => {
    if (entered.current) return;
    entered.current = true;

    fetch("/api/hunt/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Per edition: progress on Launch Day is not progress on Pop Up.
      body: JSON.stringify({ board }),
    })
      .then((r) => r.json())
      .then((d) => {
        setRanked(Boolean(d?.ranked));
        if (d?.name) setName(d.name);
        if (Array.isArray(d?.completed)) setCompleted(d.completed);
      })
      // Silent on purpose: an unreachable gate costs you a handle and a
      // place on the board, not the maze. Practice mode is still a game.
      .catch(() => {});
  }, [board]);

  /* The strip of site background that shows behind the navbar, in this
   * edition's colour — green over the launch day garden, red over the pop
   * up one. Released on the way out, the way a product page releases its
   * accent, so the next edition's glow is not the last one's. */
  const { setPageColor } = useBackgroundColor();
  useEffect(() => {
    setPageColor(palette.accent);
    return () => setPageColor(null);
  }, [setPageColor, palette.accent]);

  /* Whether the mark from the round just run is still standing. It decides
   * how long the hand-off waits: the scene un-forms the logo and walks the
   * camera back over the maze on the same clock it built them with, and a
   * round started under that is a round spent watching hedges grow back
   * instead of running them. */
  const markStandingRef = useRef(false);

  /* The mazes this browser has been dealt, for practice mode only.
   *
   * Ranked play has the runs table and this is ignored; practice has
   * nowhere to remember, and without it the server has to draw blind and
   * deals the same maze twice inside five rounds most of the time. A ref
   * rather than state because nothing renders from it — it is a fact about
   * the session that travels on the next request. */
  const dealtRef = useRef<number[]>([]);

  const start = useCallback(async () => {
    setNotice(null);
    setPhase("starting");
    try {
      const res = await fetch("/api/hunt/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board, done: dealtRef.current }),
      });
      const data = await res.json();

      if (!res.ok) {
        setNotice(data?.error ?? "Could not start a run.");
        setPhase("ready");
        return;
      }
      if (data.mode === "complete") {
        if (data.name) setName(data.name);
        // Practice answers "complete" with nothing to put in its place, and
        // the times it kept locally are the only record there will be.
        if (Array.isArray(data.record) && data.record.length > 0) {
          setRecord(data.record);
        }
        setPhase("complete");
        return;
      }

      if (data.name) setName(data.name);
      setCompleted(data.completed ?? []);
      tokenRef.current = data.token ?? null;
      if (!dealtRef.current.includes(data.seedIndex)) {
        dealtRef.current = [...dealtRef.current, data.seedIndex];
      }
      setSeedIndex(data.seedIndex);
      setFinalMs(null);
      setPlacing(null);
      setRows([]);
      // Read once, at the gate. Nothing after this reopens it.
      setIntro(null);

      /* Put the board on the wall before the run rather than after it.
       * Knowing the time to beat is most of the reason to have one, and it
       * is worthless delivered once the maze is already behind you. Not
       * awaited — a slow board must not hold up the start. */
      void fetch(
        `/api/hunt/board?board=${board}&seed=${data.seedIndex}&limit=20`,
      )
        .then((r) => r.json())
        .then((b) => setRows(b?.rows ?? []))
        .catch(() => {});

      /* The hand-off. The clock starts when the phase does, so this beat is
       * the difference between a fair round and one that opens with the
       * camera somewhere over a logo. Reduced motion collapses the scene's
       * own animation, so the wait collapses with it. */
      setPhase("dealing");
      /* The hunt holds people longer than any other page on the site and
         reported nothing about what they did there. A board and a round
         number — no times against names, nothing that identifies anybody. */
      trackHunt("start", { board, round: dealtRef.current.length + 1 });
      /* The clock is written to directly rather than rendered, so nothing
       * else will clear it — and left alone it shows the last round's final
       * time under a plate announcing the next one. */
      if (clockRef.current) clockRef.current.textContent = formatTime(0);
      const settle = markStandingRef.current
        ? reducedMotion
          ? DEAL_MS
          : REVEAL_MS
        : DEAL_MS;
      window.setTimeout(() => {
        markStandingRef.current = false;
        setPhase("running");
      }, settle);
    } catch {
      setNotice("Network trouble. Try again.");
      setPhase("ready");
    }
  }, [board, reducedMotion]);

  /* Both the runner and the clock are reset once the new maze is in hand,
   * not inside `start` — `start` only learns the seed, and the maze it names
   * does not exist until the render after. Refs only, so this costs no
   * render. */
  useEffect(() => {
    runnerRef.current = createRunner(maze);
    if (phase === "running") startedAtRef.current = performance.now();
  }, [maze, phase]);

  const finish = useCallback(async () => {
    const ms = performance.now() - startedAtRef.current;
    setPhase("solved");
    markStandingRef.current = true;
    window.setTimeout(() => setFinalMs(ms), REVEAL_MS);

    /* Practice mode — no database or no signing secret, so nothing to send.
     * The round still has to count and the time still has to be kept, or the
     * rehearsal neither reaches a fifth round nor ever shows the screen the
     * five rounds are run for. Rank 0 stands for "unplaced": there is no
     * board to be placed on. */
    if (!tokenRef.current) {
      setPracticeDone((n) => Math.min(n + 1, MAZE_COUNT));
      if (seedIndex != null) {
        setRecord((prev) => [...(prev ?? []), { seedIndex, ms, rank: 0 }]);
      }
      return;
    }

    try {
      const res = await fetch("/api/hunt/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, ms: Math.round(ms) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data?.error ?? "That run was not recorded.");
        return;
      }
      if (data.mode === "ranked") {
        trackHunt("round", { board, ms: Math.round(ms) });
        setPlacing(
          data.rank != null ? { rank: data.rank, total: data.total } : null,
        );
        setRows(data.board ?? []);
        setCompleted((prev) =>
          prev.includes(data.seedIndex) ? prev : [...prev, data.seedIndex],
        );
      }
    } catch {
      setNotice("That run was not recorded; no connection.");
    } finally {
      tokenRef.current = null;
    }
  }, [seedIndex, board]);

  /* The standings on the finished screen: seeded by the server, then kept
   * live for as long as that screen is up.
   *
   * A refresh already arrives with the first page rendered — the page is
   * dynamic and hands it over in `initial` — so the seeding is what stops a
   * reload flashing an empty board. The hook is for everything after that:
   * the run that has just ended, where the board delivered with the page was
   * read before the fifth time was on it, and the ten minutes someone leaves
   * the screen open while other people finish underneath them.
   *
   * `placing` matters as much as the rows. The board is a page at a time, and
   * a player below the last row loaded still has a standing to be told. */
  const finalBoard = useLiveBoard(
    board,
    "total",
    phase === "complete",
    initial.total,
  );

  /* Keyboard. Held keys are not tracked: a direction is a commitment the
   * runner keeps until a wall or another direction, so a tap is the whole
   * input and there is nothing to release. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_TO_DIR[e.key];
      if (dir === undefined || phase !== "running") return;
      e.preventDefault();
      runnerRef.current.want = dir;
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  /* Touch. A drag steers: once the finger has travelled far enough in one
   * axis the direction fires and the origin resets, so one continuous
   * gesture can turn several corners without lifting off. */
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchOrigin.current = { x: t.clientX, y: t.clientY };
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const origin = touchOrigin.current;
      if (!origin || phase !== "running") return;
      const t = e.touches[0];
      const dx = t.clientX - origin.x;
      const dy = t.clientY - origin.y;
      if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
        return;
      }

      runnerRef.current.want =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      touchOrigin.current = { x: t.clientX, y: t.clientY };
    },
    [phase],
  );

  const onTouchEnd = useCallback(() => {
    touchOrigin.current = null;
  }, []);

  const running = phase === "running";
  /* Whether the mark is standing: from the moment the code starts rising
   * until the next maze is dealt. It drives the scene's reveal and the plate
   * behind the Leaderboard button.
   *
   * It used to flip every HUD colour dark as well, for a floor that washed
   * white under the mark. The mark rises out of the red lawn now, and dark
   * type on red is the one pairing that does not read, so the HUD's text
   * stays light in every phase.
   *
   * "starting" is on the light side only when a result is standing — that is
   * the moment between Next being pressed and the next maze arriving, and
   * the mark is still on the floor throughout it. Pressing Begin from the
   * rules is the same phase over a dark board, hence the second clause. */
  const onLight =
    phase === "solved" ||
    phase === "complete" ||
    (phase === "starting" && finalMs != null);
  const canBegin = phase === "ready";
  /* Rounds behind you, from whichever side is keeping count. */
  const roundsDone = ranked ? completed.length : practiceDone;
  /* Every round is counted the moment it is recorded, so this is read after
   * the fact: five rounds behind you is a finished hunt, not a last one
   * about to start. Off by one here puts "Final standings" on the button at
   * the end of round four. */
  const huntOver = roundsDone >= MAZE_COUNT;
  /* The round the screen is about — which is not always the next one. A
   * finished round is counted the instant it is recorded, so `roundsDone`
   * has already moved on while the result for the round just run is still
   * standing; the HUD reading "round 2" over a panel reading "round 1" is
   * the whole reason this is not just `roundsDone + 1`. */
  const showingResult =
    finalMs != null && (phase === "solved" || phase === "starting");
  const roundShown = showingResult
    ? Math.min(Math.max(roundsDone, 1), MAZE_COUNT)
    : Math.min(roundsDone + 1, MAZE_COUNT);
  /* Practice has no server to tell it the hunt is over, so it tells itself.
   * Ranked play is settled by /api/hunt/start answering "complete". */
  const practiceOver = !ranked && practiceDone >= MAZE_COUNT;

  /* The compiled score. The server's sum is preferred over adding the rows
   * up here — it is the number the ranking was computed from, and the two
   * disagreeing on screen would be worse than either being slightly off. */
  /* How many people have run the whole thing. The counted figure, not the
   * row count: the rows on screen are one page of a board that is scrolled,
   * so counting them would report how far the reader has got rather than how
   * many people are on it. */
  const finisherCount = finalBoard.count || (finalBoard.placing?.total ?? 0);

  const finalTotalMs =
    finalBoard.placing?.ms ??
    (record && record.length > 0
      ? record.reduce((sum, r) => sum + r.ms, 0)
      : null);

  /* All five run. The one hunt event worth counting as an outcome: 417
     people have reached this screen across the two boards and none of it
     reached analytics. Fired once per mount — the screen re-renders as the
     board pages in behind it. */
  const finishReported = useRef(false);
  useEffect(() => {
    if (phase !== "complete" || finishReported.current) return;
    finishReported.current = true;
    trackHunt("complete", {
      board,
      ranked,
      ...(finalTotalMs != null ? { ms: Math.round(finalTotalMs) } : {}),
      ...(finalBoard.placing ? { rank: finalBoard.placing.rank } : {}),
    });
  }, [phase, board, ranked, finalTotalMs, finalBoard.placing]);

  /* Opening a board is the other thing people do here, and the only signal
     for "came to look at the standings rather than to run". */
  const openBoard = useCallback((id: HuntBoardId) => {
    trackHunt("leaderboard", { board: id });
    setBoardOpen(id);
  }, []);
  /* In tree form the whole canvas is the target. A 3D crown is a fiddly
   * thing to hit with a thumb, and there is nothing else on screen to click
   * by accident. */

  return (
    <div
      /* z-[1] for the same reason HomeScene carries one: the class is
         `position: fixed`, so this leaves the flow and the footer below it
         in the document would otherwise paint on top. */
      className="pesos-below-navbar-fixed z-[1] w-full overflow-hidden bg-black select-none"
      style={{ touchAction: "none" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <Canvas
        orthographic
        camera={{ position: [0, 40, 12], zoom: 30, near: 0.1, far: 200 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        shadows
      >
        <HuntScene
          maze={maze}
          garden={palette}
          runnerRef={runnerRef}
          solved={onLight}
          reducedMotion={reducedMotion}
        />
        <Ticker
          running={running}
          maze={maze}
          runnerRef={runnerRef}
          onFinish={finish}
          startedAtRef={startedAtRef}
          clockRef={clockRef}
        />
      </Canvas>

      {/* ---- Lap times, down the right ----

          Strips of magnetic tape on a workshop board, which is what a board
          of times has looked like since long before anyone put one on a
          screen. The tilt is the whole tell: perfectly aligned rectangles
          read as a table, and a table is the thing this is trying not to be.
          Held out of the HUD's flex column for the same reason the name rail
          is — it centres against the full height, not against a row. */}
      {seedIndex != null && rows.length > 0 && phase !== "ready" && (
        <div className="pesos-lapboard pointer-events-none absolute right-0 top-1/2 w-[min(20rem,46vw)] -translate-y-1/2 pr-3 sm:pr-4">
          <span className="pesos-lapboard__title">Lap times</span>
          <span className="pesos-lapboard__sub">Maze {seedIndex + 1}</span>

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

          {/* A run outside the listed strips still gets told where it landed. */}
          {placing && placing.rank > rows.length && (
            <div className="pesos-lapboard__strip is-you" style={tilt(rows.length)}>
              <span className="pesos-lapboard__rank">{placing.rank}</span>
              <span className="pesos-lapboard__name">You</span>
              <span className="pesos-lapboard__time">
                {finalMs != null ? formatTime(finalMs) : ""}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ---- The name, down the left edge ----

          Once it is yours it stays on screen: through the run, through the
          reveal, through the board. The HUD's copy of it sits under the
          clock and is gone the moment you are looking at the maze instead,
          which is exactly when it should be there.

          Held out of the HUD's flex column so it can centre against the
          full height rather than against whichever row it landed in. */}
      {name && phase !== "ready" && (
        <span
          className="pesos-hunt-rail pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 pl-3 text-[#c3ccd6]/85 sm:pl-4"
        >
          {name}
        </span>
      )}

      {/* ---- HUD ---- */}
      <div className="pesos-hunt-hud pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="font-sans text-[13px] uppercase tracking-[0.16em] text-[#c3ccd6]">
            <span className="block text-[#f4f6f8]">Treasure hunt</span>
            {seedIndex != null && phase !== "ready" && (
              <span className="mt-1 block">
                Maze {seedIndex + 1} · {maze.solutionLength} steps min
              </span>
            )}
            {/* Which round, not which maze. The maze number is the layout
                you were dealt; the round is where you are in the five, and
                it is the one people are counting. */}
            {phase !== "ready" && phase !== "complete" && (
              <span className="mt-1 block">
                Round {roundShown} of {MAZE_COUNT}
              </span>
            )}
          </div>

          <div className="text-right">
            <span
              ref={clockRef}
              className="block font-sans text-2xl tabular-nums tracking-[0.08em] text-[#f4f6f8] sm:text-3xl"
            >
              00.00
            </span>
            {name && (
              <span
                className="mt-1 block font-sans text-[13px] uppercase tracking-[0.13em] text-[#c3ccd6]"
              >
                {name}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-end justify-between gap-4">
          <p
            className={cn(
              "max-w-[18rem] font-sans text-[13px] uppercase leading-[1.9] tracking-[0.12em] transition-opacity",
              running ? "text-[#c3ccd6] opacity-100" : "opacity-0",
            )}
          >
            Arrows, WASD, or drag. You keep going until a wall stops you.
          </p>

          {/* Not while the result is up. The result panel is centred on the
              same bottom edge this button is pinned to the right of, and on a
              phone the two are simply the same 60 pixels of screen — they
              overlapped, and the half of Leaderboard that was still visible
              opened Next round when it was tapped. The result panel carries
              its own way to the board instead, so there is one row of
              controls at the bottom rather than two overlapping ones. */}
          {ranked && !running && !showingResult && (
            <button
              type="button"
              onClick={(e) => {
                // The canvas behind this flips the tree; a click on the
                // button must not do both.
                e.stopPropagation();
                openBoard(board);
              }}
              className={cn(
                "pesos-hunt-btn pointer-events-auto shrink-0 rounded-[2px] border px-5 font-sans text-[13px] font-semibold uppercase tracking-[0.14em] transition-colors",
                onLight
                  ? "border-black/45 bg-white/80 text-[#0a0b0d] hover:border-black"
                  : "border-white/45 bg-black/55 text-[#e6ecf2] hover:border-white hover:text-[#ffffff]",
              )}
            >
              Leaderboard
            </button>
          )}
        </div>
      </div>

      {/* ---- The way in: welcome, then the rules, then Begin ----

          Once each, at the gate. The welcome and the rules used to be a
          separate intro shown on the visit the name was handed over, with
          the start screen repeating it underneath; then the rules stood in
          front of every maze. Both were the same mistake at different
          scales — five rounds means five readings of a page written to be
          read once, and a briefing re-served is a toll gate.

          Set in the policy pages' type rather than the HUD's: the same
          clamped body size, the same bold weight and -0.04em tracking, the
          same near-white. Those pages are the one place on this site built
          to be read at length, and these two screens are the only ones here
          that ask for the same. The name and the mark are stepped up from
          it; nothing else is.

          Rules first and Begin second is deliberate — rule 2 has to be read
          BEFORE the run, because a screenshot cannot be taken after it, and
          the name is repeated over the rules for the same reason: that is
          the screen someone is looking at when they are told the shot has
          to carry their name.

          The leaderboards stand at the foot of both screens, one button per
          board, in Begin's face. Seeing what you are up against before you
          start is half the point of a board, and this is where people
          start. The text is centred in the space above them, so on a tall
          screen they sit at the bottom edge, and on a short one they follow
          the rules rather than covering them. */}
      {intro != null && (phase === "ready" || phase === "starting") && (
        <div className="absolute inset-0 z-[3] overflow-y-auto bg-black/80 px-6 py-12 backdrop-blur-2xl">
          <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col gap-7">
            {/* Back to the rail. /hunt offers a choice now, so the screen
                that choice lands on has to offer it back — the navbar's own
                links leave the hunt entirely. Held at the top of the
                overlay, above the block that centres itself. */}
            <Link href="/hunt" className={`${HUNT_BACK} group self-start`}>
              <span aria-hidden="true" className="text-[#9aa6b3]">
                &larr;
              </span>
              <span className="text-[#c3ccd6] underline-offset-4 transition-colors group-hover:text-white group-hover:underline">
                All hunts
              </span>
            </Link>

            <div className="my-auto flex flex-col gap-7">
            {intro === "welcome" ? (
              <>
                <div className="flex flex-col gap-2">
                  <span className={HUNT_BODY}>Welcome to the</span>
                  <span className={HUNT_MARK}>
                    PE$OS HUNT: {HUNT_BOARDS[board].label.toUpperCase()}{" "}
                    EDITION
                  </span>
                </div>

                <p className={HUNT_BODY}>
                  Your PE$OS community name from now on will be:
                </p>

                {name && <p className={HUNT_NAME}>{name}</p>}

                <p className={HUNT_BODY}>
                  This is the only time we ask you to come first. Be sure to
                  treat yourself with a piece from the BLUEPRINT collection.
                </p>

                <button
                  type="button"
                  onClick={() => setIntro("rules")}
                  className={HUNT_BUTTON}
                >
                  Rules
                </button>
              </>
            ) : (
              <>
                {/* The name over the rules, not only over the welcome. Rule
                    2 asks for a screenshot carrying it, and this is the
                    screen being read when that is asked — so the shot it
                    asks for can be taken from where the asking happens. */}
                {name && (
                  <div className="flex flex-col gap-2">
                    <span className={HUNT_BODY}>Welcome,</span>
                    <span className={HUNT_NAME}>{name}</span>
                  </div>
                )}

                <p className={HUNT_BODY}>
                  One attempt. No replays, no second runs. Your first result
                  is your result
                </p>

                <ol className="flex flex-col gap-5">
                  <li className={`${HUNT_BODY} flex gap-4`}>
                    <span className="shrink-0 tabular-nums text-white/40">1.</span>
                    <span>Speed is the only score. Fastest completion wins</span>
                  </li>
                  <li className={`${HUNT_BODY} flex gap-4`}>
                    <span className="shrink-0 tabular-nums text-white/40">2.</span>
                    <span>
                      Screenshot the game screen. It must show both your
                      community name and your recorded time
                    </span>
                  </li>
                  <li className={`${HUNT_BODY} flex gap-4`}>
                    <span className="shrink-0 tabular-nums text-white/40">3.</span>
                    <span>
                      DM your screenshot on Instagram to @pesosnairobi
                    </span>
                  </li>
                  <li className={`${HUNT_BODY} flex gap-4`}>
                    <span className="shrink-0 tabular-nums text-white/40">4.</span>
                    <span>
                      There are {MAZE_COUNT} rounds. Press Next after each
                      round to play the next maze. All your times will be
                      compiled into a final score
                    </span>
                  </li>
                </ol>

                {/* How much is left, for a player already partway through —
                    this screen is now only ever seen once, but a player who
                    left after round two comes back to it. */}
                {ranked && roundsDone > 0 && (
                  <p className="font-sans text-[13px] uppercase tracking-[0.13em] text-white/55">
                    {roundsDone} of {MAZE_COUNT} already run · each counts once
                  </p>
                )}

                <button
                  type="button"
                  onClick={start}
                  disabled={!canBegin}
                  className={HUNT_BUTTON}
                >
                  {phase === "starting" ? "Dealing a maze…" : "Begin"}
                </button>
              </>
            )}

            {notice && (
              <p className="font-sans text-[13px] uppercase tracking-[0.13em] text-[#e3574c]">
                {notice}
              </p>
            )}
            </div>

            {/* Side by side at every width. Equal halves, so on a phone each
                title breaks onto two lines instead of pushing the other
                button off the row. Under 360 pixels even that is not enough
                — LEADERBOARD is wider than half a 320 screen in Begin's
                type — so the smallest phones get a notch less size, tracking
                and padding rather than a word spilling past its border. Off
                while a maze is being dealt: the round's clock starts the
                moment it lands, and a board opened over it would be run
                behind. */}
            <div className="flex gap-3">
              {HUNT_BOARD_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => openBoard(id)}
                  disabled={!canBegin}
                  className={`${HUNT_BUTTON_FACE} min-w-0 flex-1 basis-0 px-3 py-4 leading-[1.3] max-[359px]:px-2 max-[359px]:text-[13px] max-[359px]:tracking-[0.1em] sm:px-8`}
                >
                  {HUNT_BOARDS[id].title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- The hand-off between rounds ----

          A beat, not a page. It is what replaced re-serving the rules: the
          only thing anyone needed from that screen between rounds was which
          round they were on, and that fits on a plate.

          It is also load-bearing rather than decorative. The clock starts
          when the running phase does, so this is the window the scene uses
          to un-form the mark and walk the camera back over the maze — start
          without it and a round opens on hedges still growing. Its own plate
          because the floor is mid-wash underneath it, from white back to
          black, and no single text colour survives that. */}
      {phase === "dealing" && (
        <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 rounded-[2px] bg-black/65 px-9 py-7 backdrop-blur-md">
            <span className={HUNT_MARK}>
              Round {Math.min(roundsDone + 1, MAZE_COUNT)}
            </span>
            <span className="font-sans text-[13px] uppercase tracking-[0.16em] text-[#c3ccd6]">
              of {MAZE_COUNT}
            </span>
          </div>
        </div>
      )}

      {/* ---- Result ----

          Held up through "starting" as well as "solved". Next fires a fetch
          before it can deal anything, and a panel that vanishes for those
          few hundred milliseconds reads as a dropped click — so it stays,
          with the button saying what it is doing. */}
      {showingResult && finalMs != null && (
        <div className="pesos-hunt-result pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-5 sm:gap-4 sm:p-8">
          <p className="pesos-hunt-result-text text-center font-sans text-[13px] uppercase tracking-[0.16em] text-[#f4f6f8]">
            Round {roundShown} of {MAZE_COUNT} · {formatTime(finalMs)}
            {placing ? ` · ${ordinal(placing.rank)} of ${placing.total}` : ""}
          </p>
          {notice && (
            <p className="pesos-hunt-result-text font-sans text-[12px] uppercase tracking-[0.13em] text-[#f2c14e]">
              {notice}
            </p>
          )}
          {/* Wraps rather than squeezes. Two of these side by side is 300
              points of button, which fits a phone and does not fit a phone
              with the text scaled up — and a row that overflows is how the
              overlap this replaced happened in the first place. */}
          <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                // Practice keeps its own count, so it also has to decide for
                // itself that there is nothing left to deal.
                if (practiceOver) setPhase("complete");
                else void start();
              }}
              disabled={phase === "starting"}
              className="pesos-hunt-btn rounded-[2px] border border-black/45 bg-white px-6 font-sans text-[13px] font-semibold uppercase tracking-[0.14em] text-[#0a0b0d] transition-colors hover:border-black hover:bg-white disabled:opacity-50"
            >
              {phase === "starting"
                ? "Dealing…"
                : huntOver
                  ? "Final standings"
                  : "Next round"}
            </button>
            {ranked && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openBoard(board);
                }}
                className="pesos-hunt-btn rounded-[2px] border border-white/45 bg-black/55 px-6 font-sans text-[13px] font-semibold uppercase tracking-[0.14em] text-[#e6ecf2] transition-colors hover:border-white hover:text-[#ffffff]"
              >
                Leaderboard
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- The end of the hunt ----

          Your five rounds, then everybody's.

          The rounds are a table because they are the detail — five rows read
          down a column, which is what a table is for. The standings are
          strips, because they are the result: the same marker-on-tape board
          the lap times are hung on, which is the only object in this hunt
          anyone is meant to look for themselves on. A second table under the
          first would read as an appendix to it.

          The strips survive the white ground under them. They are cream, not
          white, and that was already the requirement — they have to hold up
          when the floor washes out for the mark, which is exactly the wall
          they are hanging on here. */}
      {phase === "complete" && (
        <div className="absolute inset-0 z-[2] overflow-y-auto bg-white/92 px-6 py-10 backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-7">
            <Link href="/hunt" className={`${HUNT_BACK} group self-start`}>
              <span aria-hidden="true" className="text-[#5b646e]">
                &larr;
              </span>
              <span className="text-[#0a0b0d] underline-offset-4 group-hover:underline">
                All hunts
              </span>
            </Link>

            <div className="flex flex-col gap-1">
              <span className="font-sans text-[13px] uppercase tracking-[0.16em] text-[#5b646e]">
                All {MAZE_COUNT} rounds run
              </span>
              {name && (
                <span className="pesos-text-face text-[clamp(26px,2.6vw,44px)] font-bold uppercase leading-[1] tracking-[-0.04em] text-[#0a0b0d]">
                  {name}
                </span>
              )}
            </div>

            {/* The compiled score. One number is what the hunt is won on, so
                it is the largest thing on the screen after the name. */}
            {finalTotalMs != null && (
              <div className="flex flex-col gap-1">
                <span className="font-sans text-[13px] uppercase tracking-[0.16em] text-[#5b646e]">
                  Final score · {MAZE_COUNT} rounds compiled
                </span>
                <span className="font-sans text-[clamp(34px,5vw,56px)] font-bold leading-[1] tracking-[-0.04em] tabular-nums text-[#0a0b0d]">
                  {formatTime(finalTotalMs)}
                </span>
                {finalBoard.placing && (
                  <span className="font-sans text-[13px] uppercase tracking-[0.14em] text-[#0a0b0d]">
                    {ordinal(finalBoard.placing.rank)} of{" "}
                    {finalBoard.placing.total}{" "}
                    {finalBoard.placing.total === 1 ? "finisher" : "finishers"}
                  </span>
                )}
              </div>
            )}

            {record && record.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="font-sans text-[13px] uppercase tracking-[0.16em] text-[#5b646e]">
                  Your rounds
                </span>
                <table className="w-full font-sans text-[13px] uppercase tracking-[0.12em] text-[#0a0b0d]">
                  <tbody>
                    {record.map((r, i) => (
                      /* Keyed by round, not by maze. Ranked play cannot
                         deal the same maze twice, but practice can and does
                         — and two rows sharing a key is React quietly
                         dropping one of them. */
                      <tr
                        key={`${i}-${r.seedIndex}`}
                        className="border-t border-black/10"
                      >
                        <td className="py-1.5">
                          Round {i + 1} · maze {r.seedIndex + 1}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatTime(r.ms)}
                        </td>
                        <td className="py-1.5 pl-4 text-right text-[#5b646e]">
                          {r.rank > 0 ? ordinal(r.rank) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Everyone who has run the whole thing — the whole list, not a
                top twenty. A finisher who placed fortieth ran the same five
                rounds the winner did, and the board is the only place they
                can go and look for themselves.

                Everyone, and one page at a time. Those are not in tension:
                the board holds every finisher and the screen builds as many
                strips as have been scrolled to. A thousand tilted, shadowed
                strips laid out at once is a second of frozen phone before the
                first one can be read.

                Only complete sets are here — see totalBoard — because a
                player two rounds in has a smaller sum than one who ran five,
                and ranking those together would put every unfinished player
                at the top. */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-x-4">
                <span className="font-sans text-[13px] uppercase tracking-[0.16em] text-[#5b646e]">
                  {HUNT_BOARDS[board].title} ·{" "}
                  {finisherCount > 0
                    ? `all ${finisherCount} ${finisherCount === 1 ? "finisher" : "finishers"}`
                    : `everyone who has run all ${MAZE_COUNT}`}
                </span>
                {/* The boards that closed before this one, beside the one
                    that replaced them. Up here and not under the list, which
                    pages in as it is scrolled: anything below it is out of
                    reach once enough people have finished. The Leaderboard
                    button is underneath this screen, so this is the only way
                    to them from here.

                    Coloured on the nav, not on the links. The site's global
                    `a { color: inherit }` sits outside Tailwind's layers, so
                    it beats any text utility put on an anchor directly — the
                    link came out in the page's near-white and vanished into
                    this screen. The contact page colours its link's spans for
                    the same reason. */}
                <nav
                  aria-label="Other leaderboards"
                  className="flex flex-wrap gap-x-4 text-[#0a0b0d]"
                >
                  {HUNT_BOARD_IDS.filter((id) => id !== board).map((id) => (
                    <Link
                      key={id}
                      href={resultsPath(id)}
                      className="group inline-flex min-h-[44px] items-center gap-2 font-sans text-[13px] uppercase tracking-[0.13em]"
                    >
                      <span className="underline-offset-4 group-hover:underline">
                        {HUNT_BOARDS[id].title}
                      </span>
                      <span aria-hidden="true">&rarr;</span>
                    </Link>
                  ))}
                </nav>
              </div>

              <BoardList
                surface="light"
                rows={finalBoard.rows}
                hasMore={finalBoard.hasMore}
                loadingMore={finalBoard.loadingMore}
                onLoadMore={finalBoard.loadMore}
                emptyLabel={
                  ranked
                    ? `Nobody has finished all ${MAZE_COUNT} yet.`
                    : "Practice run; nothing was recorded."
                }
                /* A player below the last strip loaded still gets one of
                   their own, so the screen always answers "where am I". */
                ownRow={
                  finalBoard.placing
                    ? {
                        rank: finalBoard.placing.rank,
                        name: name || "You",
                        ms: finalBoard.placing.ms,
                      }
                    : null
                }
              />
            </div>

            <p className="font-sans text-[13px] uppercase leading-[1.7] tracking-[0.13em] text-[#5b646e]">
              Screenshot this and DM it on Instagram to @pesosnairobi.
              Refresh for the standings as they are now.
            </p>
          </div>
        </div>
      )}

      {/* ---- Leaderboard ---- */}
      {boardOpen && (
        <LeaderboardPanel
          /* Keyed by board so switching boards starts on Total rather than
             carrying the other board's tab and rows across. */
          key={boardOpen}
          board={boardOpen}
          completed={boardOpen === board ? completed : null}
          onClose={() => setBoardOpen(null)}
          onSelectBoard={openBoard}
          className="absolute inset-0 z-[3] bg-[#0a0b0d]/95 backdrop-blur-sm"
        />
      )}

    </div>
  );
}

/** Drives the runner and the clock from inside the Canvas, where there is
 * already a frame loop. A second requestAnimationFrame outside it would
 * step the physics on a different schedule than the frame that draws it. */
function Ticker({
  running,
  maze,
  runnerRef,
  onFinish,
  startedAtRef,
  clockRef,
}: {
  running: boolean;
  maze: ReturnType<typeof generateMaze>;
  runnerRef: React.RefObject<ReturnType<typeof createRunner>>;
  onFinish: () => void;
  startedAtRef: React.RefObject<number>;
  clockRef: React.RefObject<HTMLSpanElement | null>;
}) {
  const done = useRef(false);
  useEffect(() => {
    if (running) done.current = false;
  }, [running, maze]);

  useFrame((_, delta) => {
    if (!running || done.current) return;
    const runner = runnerRef.current;
    step(maze, runner, Math.min(delta, 0.1), RUN_SPEED);

    const el = clockRef.current;
    if (el) el.textContent = formatTime(performance.now() - startedAtRef.current);

    if (isSolved(maze, runner)) {
      done.current = true;
      onFinish();
    }
  });

  return null;
}
