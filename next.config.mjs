/* Deliberately .mjs and not .ts.
 *
 * Next transpiles a TypeScript config on every boot, and that path calls
 * loadBindings() to reach the native SWC binary — see
 * next/dist/build/next-config-ts/transpile-config.js. The production host's
 * glibc is older than @next/swc-linux-x64-gnu is linked against, so that
 * load fails and Next falls back, logging this on every single start:
 *
 *   @next/swc-linux-x64-gnu: /lib64/libm.so.6: version `GLIBC_2.29' not found
 *
 * A .js/.mjs config is read with a plain dynamic import() instead, so SWC is
 * never reached and there is nothing to fall back from. The JSDoc type below
 * keeps the editor's autocomplete and typechecking that `NextConfig` gave us.
 *
 * If this is ever moved back to .ts, that warning returns.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "wp.pesosworldwide.com",
        pathname: "/wp-content/uploads/**",
      },
    ],
    // Every distinct (width, quality) combination the app requests is a
    // separate live fetch to the WordPress origin the first time it's
    // asked for — the store's shared hosting is the actual bottleneck,
    // not Next itself, so cutting Next's default 8x8 size grid down to
    // just what this site's `sizes` props actually use shrinks how many
    // of those origin round-trips ever have to happen at all.
    deviceSizes: [640, 828, 1200, 1920],
    imageSizes: [64, 128, 256, 384],
    // Every quality the app asks for has to be listed here or the
    // optimizer answers 400. Next defaults this to [75] alone, and the
    // dev server does not enforce it — so a `q` that is missing from this
    // list works all the way through development and only fails once the
    // build is on a server, which is exactly how the carousel's 70 got
    // out: /shop asks for it on all 19 textures (lib/piece.ts), every one
    // came back 400, and the scene had nothing to draw.
    // 75 is Next's default, used by every plain <Image> on the site.
    qualities: [70, 75],
    // The origin already sends Cache-Control: max-age=604800 (7 days),
    // and Next caches for whichever of this or the upstream header is
    // longer — this is a floor for the (rare) response that arrives
    // without one, not a change to the effective 7-day cache today.
    minimumCacheTTL: 2678400,
    // Dev-only: some sandboxed/CI dev environments run a DNS64 resolver
    // that synthesizes a NAT64 address for any hostname lacking a real
    // AAAA record (this one has none — it's plain IPv4). Next's image
    // optimizer correctly refuses to fetch what looks like a private IP.
    // Production keeps the guard: real hosting doesn't hit this, and if
    // it ever does, failing loudly is the right call, not silently
    // relaxing SSRF protection for real visitors.
    ...(process.env.NODE_ENV !== "production"
      ? { dangerouslyAllowLocalIP: true }
      : {}),
  },

  /* The URLs the old WordPress store left behind, all answered permanently.
   *
   * Search Console is carrying about 531,000 of them. Most are spam: the old
   * install was hit with the hiroshi.php/item.php sitemap injection, which is
   * where the `?products/<digits>` space came from. Those are dead and will
   * drain on their own. The ones below are the URLs worth catching, because
   * they were real pages with real links before the move to Next.
   *
   * Note the ceiling on the www rule: Passenger serves everything under
   * public/ from disk without reaching Node, so a file under /catalogue keeps
   * answering on www. Every HTML route redirects, which is what search sees;
   * fixing the rest means an Apache rule in public_html/.htaccess, and that
   * file carries the Passenger config, so it is not worth the risk for a
   * handful of images. */
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.pesosworldwide.com" }],
        destination: "https://pesosworldwide.com/:path*",
        permanent: true,
      },
      /* WooCommerce product permalinks. The slugs came through the migration
       * unchanged, so these land on the actual piece rather than dumping
       * every one of them on a generic page. */
      {
        source: "/product/:slug",
        destination: "/shop/:slug",
        permanent: true,
      },
      /* The category archives, whose slugs did NOT come through — the old
       * store sorted by `women`/`men`, this one by drop. There is no honest
       * one-to-one target, so they go to the shop front. */
      {
        source: "/product-category/:path*",
        destination: "/shop",
        permanent: true,
      },
      { source: "/privacy-policy", destination: "/privacy", permanent: true },
    ];
  },

  /* No headers() block, deliberately — see public/.htaccess.
   *
   * There was one here, with a /catalogue rule and a /vendor rule and a long
   * comment about launch-day load. It never applied to a single request.
   * Passenger serves everything under public/ from disk itself, so those URLs
   * are answered by Apache and never reach Node, and a Next `headers()` rule
   * for a path Next does not serve is a rule that does nothing quietly.
   *
   * The tell, for anyone tempted to add one back: /hunt returns
   * `x-powered-by: Next.js`, a catalogue photo returns no Next header at all.
   * Anything under public/ belongs in public/.htaccess; headers() here still
   * works normally for routes Node actually handles.
   */
};

export default nextConfig;
