// next/font renames families (e.g. "__Inter_a1b2c3"), so a literal "Inter" in a canvas
// font string falls through to the system fallback. Read the generated stack from the CSS
// variables app/layout.tsx defines, once.
let ui: string | undefined;
let mono: string | undefined;

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

export function uiFont(): string {
  ui ??= cssVar("--font-inter", "system-ui, sans-serif");
  return ui;
}

export function monoFont(): string {
  mono ??= cssVar("--font-jetbrains", "ui-monospace, monospace");
  return mono;
}
