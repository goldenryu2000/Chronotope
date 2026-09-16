import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DEFAULT_THEME, THEMES } from "@/src/theme/themes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The root fallback, inherited by any route that does not set its own.
 *
 * `title.template` means a route only has to say what it is — "Philosophy" —
 * and gets the suffix for free, while `default` covers the landing page.
 */
export const metadata: Metadata = {
  title: {
    default: "Chronotope — an atlas of time and place",
    template: "%s — Chronotope",
  },
  description:
    "A historical atlas that redraws the map to match the year, with pins for the people, gods and creatures attested there at that moment.",
};

/**
 * Put the reader's theme on <html> before anything paints.
 *
 * Every token lives under `[data-theme='...']` and none under a bare `:root`,
 * so a document with no `data-theme` has no colours at all. Pages used to
 * cover that by hardcoding one on a wrapper div, which pinned them to a theme
 * and meant a choice made on one screen was ignored by the next.
 *
 * The attribute is server-rendered as the default and corrected here from
 * storage. It has to be inline and in <head>: a module would run after first
 * paint, and the reader would watch a light page turn dark. Written against
 * the same key `applyTheme` writes, and it validates before using it, because
 * localStorage is arbitrary text from the reader's own machine.
 */
const THEME_BOOTSTRAP = `try{
  var t = localStorage.getItem('chronotope:theme');
  if (${JSON.stringify(THEMES)}.indexOf(t) !== -1) document.documentElement.dataset.theme = t;
}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {/* Shown only on narrow screens; see `.screen-note` in globals.css. */}
        <p className="screen-note" role="note">
          Chronotope is made for desktop screens. Phones are not supported yet.
        </p>
        {children}
      </body>
    </html>
  );
}
