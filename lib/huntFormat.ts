import type { CSSProperties } from "react";

/* The hunt's shared vocabulary: the shape of a board row, and the three
 * pure functions that turn one into something on a screen.
 *
 * Pulled out of HuntGame when the leaderboard became its own component. Both
 * files need all three, and the board importing them back out of the game
 * would be a cycle — the game renders the board.
 */

export type BoardRow = { rank: number; name: string; ms: number; you: boolean };

/** Where a player's completed set sits overall. */
export type Placing = { rank: number; total: number; ms: number };

export function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const cents = Math.floor((total % 1000) / 10);
  const ss = String(seconds).padStart(2, "0");
  const cc = String(cents).padStart(2, "0");
  return minutes > 0 ? `${minutes}:${ss}.${cc}` : `${ss}.${cc}`;
}

/* A settled angle per row, not a random one.
 *
 * Math.random would re-roll on every render and the board would twitch each
 * time a result came in, so this is derived from the row index and a strip
 * keeps the angle it was hung at.
 *
 * It has to be *hashed*, not just arithmetic on the index. `(i * 37) % 9`
 * looks scattered and is not: 37 ≡ 1 (mod 9), so it reduces to `i` and the
 * angles come out as an even ramp — every strip a fixed step further round
 * than the one above it, which reads as a fan rather than as five things
 * stuck on a wall by hand. Knuth's multiplicative constant scatters it, and
 * the shift is taken from high bits of the same hash because the low bits
 * of a single multiply stay correlated with the ones the angle used. */
export function tilt(i: number): CSSProperties {
  const h = Math.imul(i + 1, 2654435761) >>> 0;
  const deg = ((h % 9) - 4) * 0.42;
  const shift = (((h >>> 13) % 7) - 3) * 2;
  return { "--tilt": `${deg}deg`, "--shift": `${shift}px` } as CSSProperties;
}

export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
