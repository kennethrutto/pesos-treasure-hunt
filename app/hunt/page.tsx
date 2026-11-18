import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import HuntRail from "@/components/hunt/HuntRail";
import MazePlan from "@/components/hunt/MazePlan";
import { hash32 } from "@/lib/hash32";
import {
  HUNT_BOARDS,
  HUNT_SOON,
  OPEN_BOARDS,
  playPath,
  resultsPath,
} from "@/lib/huntBoards";
import { HUNT_COOKIE, unpackPlayerId } from "@/lib/huntSession";
import {
  completedSeeds,
  getPlayerName,
  totalBoardCount,
} from "@/lib/huntStore";
import { MAZE_COUNT } from "@/lib/maze";
import { SITE_NAME } from "@/lib/site";

/* The way in: which hunt you are playing.
 *
 * The hunt used to be one season at a time, and /hunt was the game. It is a
 * rail of them now — Launch Day is green, Pop Up is red, each with five
 * mazes and standings of its own, and more are coming. The game itself
 * moved to /hunt/play/<edition>.
 *
 * A card is one target: anywhere on it starts that hunt, and the only thing
 * that steals the click is the link to its standings. That is why the card
 * is an <article> with an absolutely positioned link over it rather than an
 * anchor wrapping everything — an anchor cannot hold another anchor.
 *
 * Progress is per edition and per player, read here rather than in the
 * browser: a card that says "3 of 5 run" before the first paint is the whole
 * reason this page is rendered per request.
 *
 * Colours come from the edition rather than from a class, so a new season is
 * an entry in lib/huntBoards.ts and nothing here changes.
 */

export const metadata: Metadata = {
  title: "Treasure hunt",
  description: `Stamp your mark on ${SITE_NAME} by registering a time. Five mazes, one compiled result.`,
  alternates: { canonical: "/hunt" },
};

export const dynamic = "force-dynamic";

/** The page's own margin, and the rail's left edge. The rail runs off the
 * right of the screen rather than stopping at the container, so its padding
 * is the container's margin worked out in place: half of whatever is left
 * over once the content has taken its width, never less than the gutter. */
const GUTTER = "mx-auto w-full max-w-[76rem] px-6 sm:px-10";
const RAIL_PAD =
  "px-6 sm:px-[max(2.5rem,calc((100%_-_76rem)/2_+_2.5rem))] sm:scroll-pl-[max(2.5rem,calc((100%_-_76rem)/2_+_2.5rem))]";

/** One card's width. Full width in the phone's column; on the rail, wide
 * enough to read and narrow enough that the next one is clipped at the right
 * edge — which is what says the row moves. */
const CARD = "sm:w-[min(78vw,23rem)] sm:shrink-0 lg:w-[25rem]";

/** The small uppercase line under a card, in the face the reference uses for
 * VIEW GALLERY. */
const CARD_LINK =
  "font-sans text-[12px] font-semibold uppercase tracking-[0.16em]";

export default async function HuntPage() {
  const jar = await cookies();
  const playerId = unpackPlayerId(jar.get(HUNT_COOKIE)?.value);
  const name = playerId ? await getPlayerName(playerId) : null;

  const hunts = await Promise.all(
    OPEN_BOARDS.map(async (id) => {
      const done = playerId ? ((await completedSeeds(id, playerId)) ?? []) : [];
      return {
        id,
        name: HUNT_BOARDS[id].name,
        garden: HUNT_BOARDS[id].garden,
        run: done.length,
        finishers: (await totalBoardCount(id)) ?? 0,
      };
    }),
  );

  return (
    <main className="pesos-below-navbar relative w-full overflow-x-clip bg-[#0a0b0d] py-12 text-white sm:py-16">
      <div className={`${GUTTER} flex flex-col gap-3`}>
        <span className="font-sans text-[13px] uppercase tracking-[0.16em] text-[#9aa6b3]">
          {name ? `You run as ${name}` : `${SITE_NAME} treasure hunt`}
        </span>
        <h1 className="pesos-text-face max-w-[16ch] text-[clamp(30px,3.4vw,54px)] font-bold uppercase leading-[1.02] tracking-[-0.04em] text-[#fafafa]">
          Hunts ready to play
        </h1>
        <p className="max-w-[38rem] font-sans text-[15px] leading-[1.6] text-[#c3ccd6]">
          Stamp your mark on the PE$OS online presence forever by registering
          a time, with more mazes and different challenges coming soon. Each
          hunt is five mazes with a board of its own, and a maze you have run
          is run for good.
        </p>
      </div>

      <div className="mt-8 sm:mt-10">
        <HuntRail className={RAIL_PAD}>
          {hunts.map((h) => {
            const verb =
              h.run >= MAZE_COUNT
                ? "Your result"
                : h.run > 0
                  ? "Continue"
                  : "Play";
            return (
              <li key={h.id} className={`snap-start ${CARD}`}>
                <article className="group relative flex h-full flex-col overflow-hidden rounded-[3px] border border-white/12 bg-white/[0.035] transition-colors duration-300 hover:border-white/35">
                  <div
                    className="relative aspect-[5/4] overflow-hidden"
                    style={{ background: h.garden.lawn }}
                  >
                    <MazePlan
                      /* Not one of the five it deals. See MazePlan. */
                      seed={hash32(h.id)}
                      lawn={h.garden.lawn}
                      wall={h.garden.hedge.base}
                      finish={h.garden.finish.color}
                      className="absolute inset-0 h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                    />
                    {/* What the card does, said on the picture. Standing on a
                        phone, where there is no hover to reveal it, and
                        fading in under a pointer. */}
                    <span className="pointer-events-none absolute bottom-4 left-4 inline-flex items-center rounded-[2px] bg-black/70 px-3 py-2 font-sans text-[12px] font-semibold uppercase tracking-[0.16em] text-white backdrop-blur-md transition-opacity duration-300 sm:opacity-0 sm:group-hover:opacity-100">
                      {verb}
                      <span aria-hidden="true" className="ml-2">
                        &#8599;
                      </span>
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <span className="flex items-center gap-2 font-sans text-[12px] uppercase tracking-[0.16em] text-[#9aa6b3]">
                      <span
                        aria-hidden="true"
                        className="inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                        style={{ background: h.garden.accent }}
                      />
                      {h.run >= MAZE_COUNT
                        ? "All five run"
                        : h.run > 0
                          ? `${h.run} of ${MAZE_COUNT} run`
                          : "Not started"}
                    </span>

                    <h2 className="pesos-text-face text-[clamp(21px,1.9vw,29px)] font-bold uppercase leading-[1.08] tracking-[-0.03em] text-[#fafafa]">
                      {h.name}
                    </h2>

                    <div className="mt-auto flex items-end justify-between gap-3 pt-2">
                      {/* Over the card's own link, and the only thing on the
                          card that is. Its colour sits on the span: the
                          site's global `a { color: inherit }` is unlayered
                          and beats any text utility on the anchor itself. */}
                      <Link
                        href={resultsPath(h.id)}
                        className={`${CARD_LINK} group/link relative z-[2] -m-2 inline-flex min-h-[44px] items-center gap-2 p-2`}
                      >
                        <span className="text-[#fafafa] underline-offset-4 group-hover/link:underline">
                          View standings
                        </span>
                        <span aria-hidden="true" className="text-[#9aa6b3]">
                          &#8599;
                        </span>
                      </Link>
                      <span className="pb-2 text-right font-sans text-[12px] uppercase tracking-[0.13em] text-[#6f7983]">
                        {h.finishers === 0
                          ? "No finishers yet"
                          : `${h.finishers} ${h.finishers === 1 ? "finisher" : "finishers"}`}
                      </span>
                    </div>
                  </div>

                  {/* The card itself, as a target. Last in the DOM and under
                      the standings link, so the one takes its own clicks and
                      everything else on the card starts the hunt. */}
                  <Link
                    href={playPath(h.id)}
                    aria-label={`${verb}: ${h.name}`}
                    className="absolute inset-0 z-[1]"
                  />
                </article>
              </li>
            );
          })}

          {/* What is coming, shown rather than described. A hunt that is not
              built yet still tells you the rail goes on past this one. */}
          {HUNT_SOON.map((s) => (
            <li key={s.name} className={`snap-start ${CARD}`}>
              <article className="relative flex h-full flex-col overflow-hidden rounded-[3px] border border-dashed border-white/15">
                <div className="relative aspect-[5/4] overflow-hidden bg-[#111418]">
                  <MazePlan
                    seed={hash32(s.name)}
                    lawn="#111418"
                    wall="#080a0c"
                    finish="#39414a"
                    className="absolute inset-0 h-full w-full opacity-70"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <span className="font-sans text-[12px] uppercase tracking-[0.16em] text-[#5b646e]">
                    {s.hint}
                  </span>
                  <h2 className="pesos-text-face text-[clamp(21px,1.9vw,29px)] font-bold uppercase leading-[1.08] tracking-[-0.03em] text-[#3f474f]">
                    {s.name}
                  </h2>
                  <span className={`${CARD_LINK} mt-auto pt-2 text-[#3f474f]`}>
                    Not open yet
                  </span>
                </div>
              </article>
            </li>
          ))}
        </HuntRail>
      </div>
    </main>
  );
}
