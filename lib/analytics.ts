/* The store's analytics, cut down to the one call the hunt makes. With
 * Google Analytics on the page it sends the event; without it, nothing. */
type Params = Record<string, string | number | boolean | undefined>;
type Gtag = (command: string, event: string, params?: Params) => void;

export function track(event: string, params: Params = {}): void {
  if (typeof window === "undefined") return;
  const g = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof g !== "function") return;
  try {
    g("event", event, params);
  } catch {
    /* analytics must never be the reason a page breaks */
  }
}

export function trackHunt(
  action: "start" | "round" | "complete" | "leaderboard",
  params: Params = {},
): void {
  track(`hunt_${action}`, params);
}
