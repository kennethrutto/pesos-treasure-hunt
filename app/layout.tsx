import localFont from "next/font/local";
import type { Metadata } from "next";
import { BackgroundColorProvider } from "@/context/BackgroundColorContext";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

/* The store's own layout carries its navbar, cart and footer. This one
 * carries only what the hunt needs to run on its own. */
const spaceGrotesk = localFont({
  src: "./fonts/SpaceGrotesk-Variable.woff2",
  variable: "--font-space-grotesk",
  weight: "300 700",
});
const permanentMarker = localFont({
  src: "./fonts/PermanentMarker.woff2",
  variable: "--font-marker",
  weight: "400",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = { title: `the hunt | ${SITE_NAME}` };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${permanentMarker.variable} h-full antialiased`}>
      <body className="min-h-full">
        <BackgroundColorProvider>{children}</BackgroundColorProvider>
      </body>
    </html>
  );
}
