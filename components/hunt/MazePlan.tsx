import { generateMaze, isOpen } from "@/lib/maze";

/* A hunt's face on the rail: its maze, seen from above.
 *
 * The cards on /hunt need a picture, and the honest one is the thing you
 * are about to run — drawn in the edition's own planting, so the green hunt
 * and the red one are told apart before either name is read.
 *
 * The layout drawn here is deliberately NOT one of the five. Times are the
 * whole score, and a plan of maze one on the front page is a route anyone
 * can memorise before they start; the seed comes from the board's name
 * instead, so the picture is of that garden without being of that run.
 *
 * One path element rather than a line per wall: a 13x13 maze is about 350
 * segments, and four cards of those is a lot of DOM for a decoration.
 */

type Props = {
  /** Any number; the same one always draws the same plan. */
  seed: number;
  /** The lawn behind the hedges. */
  lawn: string;
  /** The hedges themselves. */
  wall: string;
  /** The marker that ends a run. */
  finish: string;
  className?: string;
};

export default function MazePlan({ seed, lawn, wall, finish, className }: Props) {
  /* Wider than the square the hunt deals, because the card is: 16 by 13 is
     within two percent of the 5:4 it is drawn into, so both markers survive
     the crop instead of the start being sliced off the top. */
  const maze = generateMaze(seed, 16, 13);
  const { cols, rows } = maze;

  const d: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      /* North and west only. Every wall is the north or west side of
         exactly one cell, so drawing all four sides would draw each of
         them twice. */
      if (!isOpen(maze, x, y, 0)) d.push(`M${x} ${y}h1`);
      if (!isOpen(maze, x, y, 3)) d.push(`M${x} ${y}v1`);
    }
  }
  /* The two sides no cell owns the near edge of. */
  d.push(`M0 ${rows}h${cols}`, `M${cols} 0v${rows}`);
  const walls = d.join("");

  const fx = maze.finish.x + 0.5;
  const fy = maze.finish.y + 0.5;

  return (
    <svg
      viewBox={`0 0 ${cols} ${rows}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width={cols} height={rows} fill={lawn} />

      {/* The hedges sit in their own shadow, which is most of what stops
          this reading as a wiring diagram. */}
      <g
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(0.07 0.1)"
      >
        <path d={walls} stroke="#000" strokeOpacity={0.32} strokeWidth={0.26} />
      </g>
      <path
        d={walls}
        fill="none"
        stroke={wall}
        strokeWidth={0.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx={fx} cy={fy} r={0.62} fill={finish} fillOpacity={0.2} />
      <circle cx={fx} cy={fy} r={0.3} fill={finish} />
      <circle
        cx={0.5}
        cy={0.5}
        r={0.24}
        fill="none"
        stroke="#f4f6f8"
        strokeOpacity={0.75}
        strokeWidth={0.1}
      />
    </svg>
  );
}
