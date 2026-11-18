/** Canonical public origin. Every absolute URL in metadata, sitemaps
 * and structured data derives from this, so search engines only ever
 * see one spelling of the site. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://pesosworldwide.com";

export const SITE_NAME = "PE$OS Worldwide";

export const SITE_DESCRIPTION =
  "PE$OS Worldwide: independent streetwear out of Nairobi. Limited drops, jackets, tees, belts and accessories, shipped worldwide.";

export function absoluteUrl(path = "/") {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
