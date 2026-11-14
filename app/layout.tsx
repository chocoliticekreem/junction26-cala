import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Room",
  description: "Say your pitch; London's investors sort themselves around you, ranked by what they actually invested in.",
};

// Runs before hydration so an R pressed while the founder page is still loading is not lost;
// app/page.tsx picks the flag up once its own key handler is attached.
const EARLY_REPLAY_KEY = `window.__roomReplayQueued=false;document.addEventListener("keydown",function(e){if(window.__roomReady||location.pathname!=="/")return;var t=e.target;if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable))return;if(e.metaKey||e.ctrlKey||e.altKey)return;if(e.key==="r"||e.key==="R")window.__roomReplayQueued=true;});`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: EARLY_REPLAY_KEY }} />
        {children}
      </body>
    </html>
  );
}
