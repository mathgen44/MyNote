// Apparence de l'interface, propre à chaque appareil (non synchronisée) :
// les choix sont posés en attributs data-* sur <html>, que styles.css exploite.

export type Theme = "system" | "light" | "dark";
export type Accent = "teal" | "blue" | "violet" | "green" | "orange" | "rose" | "graphite";
export type NoteFont = "sans" | "serif" | "mono";
export type NoteSize = "s" | "m" | "l" | "xl";
export type CanvasBackground = "none" | "dots" | "lines" | "grid";

export interface Appearance {
  theme: Theme;
  accent: Accent;
  font: NoteFont;
  size: NoteSize;
  canvasBg: CanvasBackground;
}

const KEY = "mynote.appearance";
const DEFAULTS: Appearance = { theme: "system", accent: "teal", font: "sans", size: "m", canvasBg: "none" };

export function loadAppearance(): Appearance {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function applyAppearance(a: Appearance) {
  const root = document.documentElement.dataset;
  root.theme = a.theme === "system" ? (darkQuery.matches ? "dark" : "light") : a.theme;
  root.accent = a.accent;
  root.font = a.font;
  root.size = a.size;
  root.canvasBg = a.canvasBg;
}

export function saveAppearance(a: Appearance) {
  localStorage.setItem(KEY, JSON.stringify(a));
  applyAppearance(a);
}

// Thème « système » : on suit les changements de Windows en direct.
darkQuery.addEventListener("change", () => applyAppearance(loadAppearance()));
applyAppearance(loadAppearance());
