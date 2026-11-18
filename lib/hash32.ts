/* FNV-1a, then an avalanche.
 *
 * Not for security — it picks words out of short lists and shuffles five
 * mazes — but it is stable across processes and Node versions, which
 * Math.random and any per-run seed are not. A name or a running order that
 * changed when the server restarted would be the whole point thrown away.
 *
 * The avalanche is not optional decoration, and leaving it off cost half
 * the name pool the first time this was written. FNV-1a ends on a multiply
 * by an odd constant, which preserves the low bit, so bit 0 of the digest is
 * just the XOR of bit 0 of every input character. Two prefixes differing
 * only in an even byte — `d` (0x64) against `r` (0x72) — therefore always
 * produced digests of the *same* parity, and `h % n` for even n keeps h's
 * parity, so with even-length lists the two indices were welded together and
 * only half the pairings could ever appear. The shift-xor-multiply rounds
 * fold high bits down into the low ones, which breaks that.
 *
 * Keep the avalanche. Without it the next word added to a list, or the next
 * maze added to the set, can silently halve what is reachable.
 *
 * Lives on its own because two features depend on it now — see
 * lib/huntNames.ts for the handles and lib/maze.ts for the running order —
 * and a second copy that quietly dropped the avalanche would fail in the
 * same invisible way in both.
 */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
