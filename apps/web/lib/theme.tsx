"use client";

// Chart palette hook — resolves the design tokens (defined in globals.css per
// the dataviz reference palette) to concrete hex for Recharts, and re-resolves
// when the OS colour scheme flips.

import { createContext, useContext, useEffect, useState } from "react";

export interface Palette {
  mode: "light" | "dark";
  series: string[]; // categorical slots 1–8, fixed order
  surface: string;
  grid: string;
  axis: string;
  inkPrimary: string;
  inkSecondary: string;
  inkMuted: string;
  good: string;
  warning: string;
  serious: string;
  critical: string;
  deltaGood: string;
  areaOpacity: number;
}

const LIGHT: Palette = {
  mode: "light",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  surface: "#fcfcfb",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  inkPrimary: "#0b0b0b",
  inkSecondary: "#52514e",
  inkMuted: "#898781",
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  deltaGood: "#006300",
  areaOpacity: 0.1,
};

const DARK: Palette = {
  ...LIGHT,
  mode: "dark",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  surface: "#1a1a19",
  grid: "#2c2c2a",
  axis: "#383835",
  inkPrimary: "#ffffff",
  inkSecondary: "#c3c2b7",
  inkMuted: "#898781",
  deltaGood: "#0ca30c",
};

const PaletteContext = createContext<Palette>(LIGHT);

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPalette] = useState<Palette>(LIGHT);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setPalette(mq.matches ? DARK : LIGHT);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return <PaletteContext.Provider value={palette}>{children}</PaletteContext.Provider>;
}

export function usePalette(): Palette {
  return useContext(PaletteContext);
}
