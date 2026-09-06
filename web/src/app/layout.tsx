/**
 * Root layout for the Elapse web app (landing, hosted checkout, dashboard).
 *
 * Loads the two faces of the Strip-Chart world (Archivo for prose and
 * placards, Martian Mono for instrument numerals), applies the theme class
 * before first paint, and carries the design direction contract as the
 * first child of <body> so it survives the production build.
 *
 * Maps to: design brief "Design direction"; detailed doc §7–§8.
 */
import type { Metadata, Viewport } from "next";
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const martian = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Elapse — You only pay what elapsed",
    template: "%s · Elapse",
  },
  description:
    "Per-second subscriptions for APIs, GPUs, streams and SaaS. Cancel at 83 seconds, pay 83 seconds. Your server finds out via webhook.",
  metadataBase: new URL("https://elapse.finance"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies `.dark` before hydration so the ground never flashes.
 * Dark is the default; a stored 'light' preference opts out.
 */
const themeScript = `(function(){try{var s=localStorage.getItem('elapse-theme');var d=s?s==='dark':true;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${martian.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/*
          DIRECTION CONTRACT — seed d3eb4e9d
          THESIS: Time is a strip of chart paper pulled at constant speed; the pen only draws while the meter runs, and cancel lifts the pen. Refuses the dev-tool landing of headline-left, code-block-right on a dark glow.
          OWN-WORLD: Neutral near-black by default (Vercel register), off-white ink, white primary actions, amber reserved for the live meter, red pen for the trace and Cancel; the close is a plate: inverted to ink on light paper, a raised near-black panel in the dark. The strip is the only ruled surface. Archivo (width axis) for prose and placard caps, Martian Mono for tabular numerals. Light mode is neutral white with the same roles. (Revised 2026-09-03 at the human's direction: warm/cream read as off-niche.)
          STORY: A merchant engineer sees a meter accrue, presses Cancel, watches the pen lift and the readout lock at 83 seconds / $0.33, and understands the product before reading. They copy npm install.
          FIRST VIEWPORT: Headline top-left with "Read the docs" beneath; a full-width strip runs under it, scrolling left, red trace accruing from load; the live readout sits huge at right with a Cancel control; the install placard closes the viewport.
          FORM: Strip-chart recorder, candidate 3 of 7 on the grounded list, assigned by seed d3eb4e9d.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
