// next/font renames families (e.g. "__Figtree_a1b2c3"), so a literal "Figtree" in a canvas
// font string falls through to the system fallback. Read the generated stack from the CSS
// variables app/layout.tsx defines, once.
let ui: string | undefined;
let display: string | undefined;
let mono: string | undefined;

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

export function uiFont(): string {
  ui ??= cssVar("--font-text", "system-ui, sans-serif");
  return ui;
}

export function displayFont(): string {
  display ??= cssVar("--font-display", "system-ui, sans-serif");
  return display;
}

export function monoFont(): string {
  mono ??= cssVar("--font-mono", "ui-monospace, monospace");
  return mono;
}
