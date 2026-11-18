import { timingSafeEqual } from "node:crypto";

/* Constant-time comparison for secrets that arrive from outside.
 *
 * Deliberately not `server-only`: proxy.ts is compiled outside the
 * react-server graph and that guard throws there. The node:crypto import
 * is itself enough to keep this off the client — the same reasoning that
 * governs lib/gate.ts, which is one of the two callers. */

/** Constant-time string compare that also tolerates a length mismatch —
 * node's timingSafeEqual throws rather than returning false when the two
 * buffers differ in size.
 *
 * The length check itself is not constant-time, which is fine for both
 * callers: they compare fixed-width HMAC digests, so a difference in
 * length is not a secret. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
