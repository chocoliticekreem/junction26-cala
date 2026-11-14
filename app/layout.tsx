import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";
import Starfield from "@/components/Starfield";
import "./globals.css";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

const text = Figtree({
  variable: "--font-text",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Scalaxy",
  description: "Say your pitch and your five-year vision. Scalaxy simulates thousands of futures through real rounds in Cala's graph.",
};

// Runs before hydration so an R pressed while the matching page is still loading is not lost;
// app/match/page.tsx picks the flag up once its own key handler is attached.
const EARLY_REPLAY_KEY = `window.__roomReplayQueued=false;document.addEventListener("keydown",function(e){if(window.__roomReady||location.pathname!=="/match")return;var t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable))return;if(e.metaKey||e.ctrlKey||e.altKey)return;if(e.key==="r"||e.key==="R")window.__roomReplayQueued=true;});`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: EARLY_REPLAY_KEY }} />
        <Starfield />
        {children}
      </body>
    </html>
  );
}
