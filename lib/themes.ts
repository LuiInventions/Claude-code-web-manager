/** Calming dark palettes. The id is stored in settings and set on <html data-theme>. */
export const THEMES = [
  {
    id: "ink",
    label: "Ink",
    hint: "Schwarz und Silber",
    swatch: ["#050505", "#1a1a1a", "#d4d4d8"],
  },
  {
    id: "dusk",
    label: "Dusk",
    hint: "Indigo und Flieder",
    swatch: ["#0c0a14", "#1c1730", "#c4b5fd"],
  },
  {
    id: "moss",
    label: "Moss",
    hint: "Wald und Salbei",
    swatch: ["#07110c", "#14241b", "#9dccb0"],
  },
  {
    id: "tide",
    label: "Tide",
    hint: "Nachtblau und Seegrün",
    swatch: ["#071016", "#12202b", "#7ec8c3"],
  },
  {
    id: "clay",
    label: "Clay",
    hint: "Kohle und Sand",
    swatch: ["#100e0c", "#241e18", "#e0c2a2"],
  },
  {
    id: "plum",
    label: "Plum",
    hint: "Pflaume und Rosé",
    swatch: ["#120910", "#26141e", "#e4b3c5"],
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}
