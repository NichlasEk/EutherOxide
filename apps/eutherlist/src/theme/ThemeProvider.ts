import { ThemeName } from "../types";

export const themes: Array<{ id: ThemeName; label: string }> = [
  { id: "joanna-light", label: "Joanna Light" },
  { id: "euther", label: "Euther" },
  { id: "apothecary-dark", label: "Apothecary Dark" },
];

export function applyTheme(theme: ThemeName): void {
  document.body.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
  if (meta) {
    meta.content = theme === "apothecary-dark" ? "#111812" : theme === "euther" ? "#101714" : "#f8f6f0";
  }
}
