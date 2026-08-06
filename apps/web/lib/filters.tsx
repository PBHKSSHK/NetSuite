"use client";

// Global filter state: subsidiary (or consolidated) + period (month/quarter/YTD)
// + pro-forma allocation toggle. Shared by every report page via context.

import { createContext, useContext, useMemo, useState } from "react";
import { ACTUAL_MONTHS } from "./fy";
import { monthsInPeriod } from "./fy";
import type { PeriodMode } from "./types";

interface FilterState {
  /** -1 = consolidated, otherwise subsidiary id */
  subsidiary: number;
  mode: PeriodMode;
  /** anchor FY month (1–12), limited to closed months for actuals */
  month: number;
  allocated: boolean;
  months: number[];
  setSubsidiary: (id: number) => void;
  setMode: (m: PeriodMode) => void;
  setMonth: (m: number) => void;
  setAllocated: (b: boolean) => void;
}

const FilterContext = createContext<FilterState | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [subsidiary, setSubsidiary] = useState(-1);
  const [mode, setMode] = useState<PeriodMode>("ytd");
  const [month, setMonth] = useState(ACTUAL_MONTHS);
  const [allocated, setAllocated] = useState(false);
  const months = useMemo(() => monthsInPeriod(mode, month), [mode, month]);
  const value = useMemo(
    () => ({ subsidiary, mode, month, allocated, months, setSubsidiary, setMode, setMonth, setAllocated }),
    [subsidiary, mode, month, allocated, months]
  );
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterState {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters outside FilterProvider");
  return ctx;
}
