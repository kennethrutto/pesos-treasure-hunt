/* The hunt's editions, one per season of it.
 *
 * An edition is five mazes with standings of its own. Launch Day ran on the
 * green garden; Pop Up runs on the red one. Both are open: the grid on /hunt
 * is where you pick, and a maze you have finished on an edition is finished
 * there for good, so the two boards never mix.
 *
 * Launch Day spent a while closed — kept exactly as it finished, read-only at
 * its results page — and it is dealt from again now. Its seeds have not
 * moved, which is the only reason that is safe: runs are stored by position,
 * so a time on maze three belongs to the same layout the first 378 finishers
 * ran. Never change a board's seeds once it has runs; new mazes are a new
 * edition.
 *
 * Not server-only: the grid, the game and the results pages all read the
 * titles and the palettes, and nothing here says where anything is stored.
 */

/** A board's five mazes, as seeds for generateMaze. Five because MAZE_COUNT
 * is; change one and the other has to follow. */
type MazeSet = readonly [number, number, number, number, number];

/** One channel of the hedge's leaf colour, as `brightness * mul + add`
 * clamped to 255. The generator draws leaves by brightness alone; this is
 * what makes the same drawing come out green on one edition and red on the
 * other. */
type Channel = readonly [mul: number, add: number];

/** Everything about an edition that is a colour. These were constants in
 * HuntScene and gardenTextures until two gardens had to stand at once. */
export type GardenPalette = {
  /** Keys the texture cache: two editions on one page must not share a
   * drawn turf. */
  id: string;
  /** The glow the navbar lerps to while this edition is on screen, and the
   * tile's own colour in the grid. */
  accent: string;
  /** The lawn under everything, and what shows before the drawn turf has
   * been built on the first client frame. */
  lawn: string;
  /** The turf canvas: ground, then the two strokes of grass over it. */
  turf: { base: string; bladeDark: string; bladeLight: string };
  /** The hedge canvas: the dark behind the leaves, the leaf colour per
   * channel, and the shading dropped on top as "r,g,b". */
  hedge: { base: string; leaf: { r: Channel; g: Channel; b: Channel }; shade: string };
  /** Per-lump and per-tree tints, cycled over the instances. */
  hedgeTones: readonly string[];
  treeTones: readonly string[];
  /** The finish marker, and the light it throws. */
  finish: { color: string; emissive: string };
  /** The contact shadow the planting sits in. */
  shadow: string;
};

export type HuntBoard = {
  title: string;
  /** What the card on /hunt calls it — the edition's public name, in full.
   * The title above is its board's name, and the label below is the short
   * form the game and the page titles use. */
  name: string;
  /** The edition in two words, for anywhere the full name would not fit or
   * would repeat itself: the browser tab, and the heading over the rules. */
  label: string;
  /** Open editions are dealt from and written to. A closed one keeps its
   * results page and refuses new runs — see /api/hunt/finish. */
  status: "open" | "closed";
  seeds: MazeSet;
  garden: GardenPalette;
};

const GREEN_GARDEN: GardenPalette = {
  id: "green",
  /* The green era had no navbar glow — it arrived with the red season — so
     this is the lawn's own colour rather than a restored constant. */
  accent: "#4b7a33",
  lawn: "#4b7a33",
  turf: { base: "#3f6b28", bladeDark: "rgba(28,58,20,0.35)", bladeLight: "rgba(150,190,105,0.3)" },
  hedge: {
    base: "#0d1c08",
    leaf: { r: [0.46, 0], g: [1, 0], b: [0.28, 0] },
    shade: "6,20,4",
  },
  hedgeTones: ["#e8f2e0", "#dfeed6", "#f0f6ea", "#d8e8ce"],
  treeTones: ["#e2efd8", "#d2e6c6", "#eef6e8"],
  /* Brand red on green planting: the one thing in the garden that is not
     of it, which is what a finish has to be. */
  finish: { color: "#e03127", emissive: "#5e0d06" },
  shadow: "#141c0e",
};

const RED_GARDEN: GardenPalette = {
  id: "red",
  accent: "#e03127",
  lawn: "#9c2622",
  turf: { base: "#861c1a", bladeDark: "rgba(60,10,10,0.35)", bladeLight: "rgba(222,86,74,0.3)" },
  hedge: {
    /* Red carries under a third of green's luminance, so the leaf's red
       channel is lifted rather than scaled — drawn at green's values the
       planting came out near black. */
    base: "#1c0907",
    leaf: { r: [1.3, 22], g: [0.26, 0], b: [0.2, 0] },
    shade: "22,5,4",
  },
  hedgeTones: ["#f2e2e0", "#eed8d6", "#f6eae8", "#e8d0ce"],
  treeTones: ["#efd8d4", "#e6c6c2", "#f6e8e6"],
  /* Gold, not the brand red: a red marker over red planting is a marker
     nobody finds. */
  finish: { color: "#f2c14e", emissive: "#5e3d06" },
  shadow: "#1a0e0c",
};

export const HUNT_BOARDS = {
  "launch-day": {
    title: "Launch Day Leaderboard",
    name: "Blueprint Launch Day Hunt",
    label: "Launch Day",
    status: "open",
    /* The five launch day was run on, kept with its board. */
    seeds: [0x1f35c, 0x2a71b, 0x3c0d9, 0x4e8a2, 0x5b16f],
    garden: GREEN_GARDEN,
  },
  "pop-up": {
    title: "Pop Up Leaderboard",
    name: "Blueprint Pop-Up Hunt",
    label: "Pop Up",
    status: "open",
    /* Five layouts standing in for the launch day mazes position by
       position: the same solution length to within a step, the same turns
       and wrong-turn junctions to within one, and every finish somewhere
       new. The mazes are new and the difficulty is not. */
    seeds: [0x63fc4, 0x778b2, 0x8d430, 0x94e8f, 0xaa7b3],
    garden: RED_GARDEN,
  },
} as const satisfies Record<string, HuntBoard>;

export type HuntBoardId = keyof typeof HUNT_BOARDS;

/** Oldest first, which is the order they ran in. */
export const HUNT_BOARD_IDS = Object.keys(HUNT_BOARDS) as HuntBoardId[];

/** The editions being dealt from. The grid offers these and nothing else,
 * and /api/hunt/finish will not record a run for anything outside it. */
export const OPEN_BOARDS = HUNT_BOARD_IDS.filter(
  (id) => HUNT_BOARDS[id].status === "open",
);

export function isOpenBoard(id: HuntBoardId): boolean {
  return HUNT_BOARDS[id].status === "open";
}

/** The newest open edition. For callers that need *a* board rather than the
 * one someone chose — the name a player is given on arrival belongs to the
 * player, not to an edition, so /api/hunt/enter reports progress against
 * this one and the grid reads the rest itself. */
export const DEFAULT_BOARD: HuntBoardId = OPEN_BOARDS[OPEN_BOARDS.length - 1];

/** Editions with nothing behind them yet: the rail renders one card each,
 * inert, so the shape of what is coming is visible from the first screen.
 * `name` rather than `label` because these are cards, and that is what a
 * card reads off a board. */
export const HUNT_SOON = [
  { name: "Hunt Three", hint: "Coming soon" },
  { name: "Hunt Four", hint: "Coming soon" },
] as const;

/** For a value off a URL. An own-property check rather than `in`, which is
 * also true of "constructor" and "toString" and would wave either through
 * to a table lookup. */
export function isHuntBoardId(
  value: string | null | undefined,
): value is HuntBoardId {
  return (
    value != null && Object.prototype.hasOwnProperty.call(HUNT_BOARDS, value)
  );
}

/** The seed for maze `index` of `board`. The server deals and checks a run
 * with this and the game draws it with this, so the two cannot disagree
 * about which layout a number is. */
export function mazeSeed(board: HuntBoardId, index: number): number {
  return HUNT_BOARDS[board].seeds[index];
}

export function garden(board: HuntBoardId): GardenPalette {
  return HUNT_BOARDS[board].garden;
}

export function resultsPath(board: HuntBoardId): string {
  return `/hunt/results/${board}`;
}

export function playPath(board: HuntBoardId): string {
  return `/hunt/play/${board}`;
}
