"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* The rail the hunts sit on.
 *
 * Sideways on a desktop, a column on a phone — one list either way, so the
 * cards themselves are written once. The list is the only client piece of
 * /hunt: the cards are server-rendered and handed in as children, because
 * everything on them (who you are, what you have run, how many have
 * finished) is read from the database on the way out.
 *
 * The arrows are rendered only when there is somewhere to go, which is also
 * how they disappear on a phone: a column has no horizontal overflow, so
 * both ends read as reached and neither button is built.
 *
 * Lenis is not fought here. It ignores a gesture with no vertical component
 * and, with allowNestedScroll on, hands a mostly-sideways one to whatever
 * under the cursor can take it — so a trackpad swipe scrolls this and a
 * wheel still scrolls the page. See components/SmoothScroll.tsx.
 */

const ARROW =
  "pointer-events-auto absolute top-[36%] z-[2] hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-black shadow-[0_2px_14px_rgba(0,0,0,0.4)] transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:flex";

export default function HuntRail({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    /* A few pixels of slack: browsers land a smooth scroll a fraction short
       of the end often enough that an exact comparison leaves a button
       standing with nothing behind it. */
    setMore({ left: el.scrollLeft > 8, right: el.scrollLeft < max - 8 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [measure]);

  const page = useCallback((dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    /* One card at a time, gap included, so a press lands on a card edge
       rather than halfway through one. */
    const card = el.firstElementChild as HTMLElement | null;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const step = card ? card.offsetWidth + gap : el.clientWidth * 0.8;
    el.scrollBy({
      left: dir * step,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, []);

  return (
    <div className="pointer-events-none relative">
      <ul
        ref={ref}
        onScroll={measure}
        className={`pesos-hunt-cards pointer-events-auto m-0 flex list-none flex-col gap-4 p-0 sm:snap-x sm:snap-mandatory sm:flex-row sm:gap-5 sm:overflow-x-auto ${className ?? ""}`}
      >
        {children}
      </ul>

      {more.left && (
        <button
          type="button"
          onClick={() => page(-1)}
          aria-label="Previous hunts"
          className={`${ARROW} left-4`}
        >
          <span aria-hidden="true" className="text-[17px] leading-none">
            &larr;
          </span>
        </button>
      )}
      {more.right && (
        <button
          type="button"
          onClick={() => page(1)}
          aria-label="More hunts"
          className={`${ARROW} right-4`}
        >
          <span aria-hidden="true" className="text-[17px] leading-none">
            &rarr;
          </span>
        </button>
      )}
    </div>
  );
}
