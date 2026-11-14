import type { CSSProperties } from "react";
import { DM_Mono, DM_Sans, IBM_Plex_Mono, Instrument_Sans, Instrument_Serif, JetBrains_Mono, Manrope, Space_Grotesk, Space_Mono, Syne, Unbounded } from "next/font/google";

// Hidden preview: four candidate pairings on the same mini hero + results card. The default
// pairing lives in app/layout.tsx; every page reads the same three CSS variables.

const syne = Syne({ subsets: ["latin"] });
const manrope = Manrope({ subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ subsets: ["latin"] });
const unbounded = Unbounded({ subsets: ["latin"] });
const dmSans = DM_Sans({ subsets: ["latin"] });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"] });
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400" });
const instrumentSans = Instrument_Sans({ subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"] });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"] });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"] });

const PAIRINGS = [
  { id: "A", name: "Syne + Manrope + JetBrains Mono", note: "default", display: syne, text: manrope, mono: jetbrains, weight: 700 },
  { id: "B", name: "Unbounded + DM Sans + DM Mono", note: "", display: unbounded, text: dmSans, mono: dmMono, weight: 600 },
  { id: "C", name: "Instrument Serif + Instrument Sans + IBM Plex Mono", note: "", display: instrumentSerif, text: instrumentSans, mono: plexMono, weight: 400 },
  { id: "D", name: "Space Grotesk + Manrope + Space Mono", note: "", display: spaceGrotesk, text: manrope, mono: spaceMono, weight: 700 },
];

export default function FontsPage() {
  return (
    <main className="fonts-page shell" data-testid="fonts-page">
      <ol className="fonts-grid">
        {PAIRINGS.map((p) => (
          <li
            key={p.id}
            className="font-card"
            style={{ "--font-display": p.display.style.fontFamily, "--font-text": p.text.style.fontFamily, "--font-mono": p.mono.style.fontFamily, "--display-weight": p.weight } as CSSProperties}
            data-testid="font-card"
          >
            <header className="font-card-head font-mono">
              <b>{p.id}</b> {p.name}
              {p.note && <span className="tag tag-accent">{p.note}</span>}
            </header>
            <section className="font-hero">
              <span className="brand-name" aria-hidden>
                s<span className="brand-cala">CALA</span>xy
              </span>
              <h1 className="path-title">Where does Cala go from here?</h1>
              <div className="font-cta glass">
                <div className="fx-seg" aria-hidden>
                  <span className="is-active">Existing company</span>
                  <span>New idea</span>
                </div>
                <div className="path-input font-fake-input">Cala</div>
                <p className="path-line">
                  <span className="muted">Read as</span> Seed · Data infra · raising $5M
                </p>
                <span className="hero-btn hero-btn-primary font-fake-btn">Simulate</span>
              </div>
            </section>
            <section className="font-results glass">
              <header className="path-section-head">
                <span>Possible realities</span>
              </header>
              <div className="font-reality">
                <b className="font-mono">34%</b>
                <span>Unicorn by year 4</span>
                <b className="path-outcome-chip">$1B+ by Y4</b>
              </div>
              <div className="font-reality">
                <b className="font-mono">21%</b>
                <span>Series B, below $1B</span>
                <b className="path-outcome-chip">$400M by Y5</b>
              </div>
              <div className="font-reality">
                <b className="font-mono">18%</b>
                <span>Stalls after Series A</span>
                <b className="path-outcome-chip">stalls · Series A</b>
              </div>
              <p className="path-line muted">Sequoia · Index Ventures · Lightspeed Venture Partners</p>
            </section>
          </li>
        ))}
      </ol>
    </main>
  );
}
