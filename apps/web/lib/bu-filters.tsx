"use client";

// BU 還原模組專用 filter：財年、期間（月/季/YTD/全年/累積）、檢視（法定/管理/集團）、
// Layer（純業務/分攤後）、分攤 key、associates admin fee 抵減。
// 同 lib/filters.tsx（原有五頁）分開——BU 頁可以睇歷史財年。

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AllocKey, Period } from "./bu";
import { availableFys, lastMonthWithData, ymOf, ymRange } from "./bu";
import { ALLOC_RULES, BU_META } from "./bu-store";

export type BuView = "legal" | "mgmt";
export type BuMode = "month" | "quarter" | "ytd" | "full" | "cumulative";

interface BuFilterState {
  fy: string;
  fys: string[];
  mode: BuMode;
  month: number;
  lastMonth: number;
  layer: 1 | 2;
  allocKey: AllocKey;
  netAssocFee: boolean;
  period: Period;
  setFy: (fy: string) => void;
  setMode: (m: BuMode) => void;
  setMonth: (m: number) => void;
  setLayer: (l: 1 | 2) => void;
  setAllocKey: (k: AllocKey) => void;
  setNetAssocFee: (b: boolean) => void;
}

const Ctx = createContext<BuFilterState | null>(null);

export function monthsFor(mode: BuMode, month: number): number[] {
  if (mode === "month") return [month];
  if (mode === "quarter") {
    const q = Math.floor((month - 1) / 3);
    return [q * 3 + 1, q * 3 + 2, q * 3 + 3].filter((m) => m <= month);
  }
  if (mode === "full") return Array.from({ length: 12 }, (_, i) => i + 1);
  // ytd / cumulative：本財年內 4 月至揀選月份（cumulative 另加跨財年 yms）
  return Array.from({ length: month }, (_, i) => i + 1);
}

/** 累積 = 由最早有 BU 數據嘅月份（BU_META.minYm）到揀選月份，跨財年 */
export function cumulativeYms(fy: string, month: number, fys: string[]): string[] {
  const from = BU_META.minYm || (fys[0] ? ymOf(fys[0], 1) : "");
  return ymRange(from, ymOf(fy, month));
}

export function BuFilterProvider({ children }: { children: React.ReactNode }) {
  const fys = availableFys();
  const defaultFy = fys[fys.length - 1] ?? "FY2025/26";
  const [fy, setFyRaw] = useState(defaultFy);
  const [mode, setMode] = useState<BuMode>("ytd");
  const [month, setMonth] = useState(() => lastMonthWithData(defaultFy));
  const [layer, setLayer] = useState<1 | 2>(2);
  const [allocKey, setAllocKey] = useState<AllocKey>(() => (ALLOC_RULES.find((r) => r.isDefault)?.keyType ?? "headcount") as AllocKey);
  const [netAssocFee, setNetAssocFee] = useState(true);

  // hydrate 完成後（fys 由空變有）同步預設值
  useEffect(() => {
    if (fys.length && !fys.includes(fy)) {
      const last = fys[fys.length - 1];
      setFyRaw(last);
      setMonth(lastMonthWithData(last));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [BU_META.rows]);

  const lastMonth = lastMonthWithData(fy);
  const setFy = (f: string) => {
    setFyRaw(f);
    const lm = lastMonthWithData(f);
    setMonth((m) => Math.min(m, lm));
  };
  const period = useMemo<Period>(
    () =>
      mode === "cumulative"
        ? { fy, months: monthsFor(mode, month), yms: cumulativeYms(fy, month, fys) }
        : { fy, months: monthsFor(mode, month) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fy, mode, month, fys.join(","), BU_META.minYm]
  );
  const value = useMemo(
    () => ({ fy, fys, mode, month, lastMonth, layer, allocKey, netAssocFee, period, setFy, setMode, setMonth, setLayer, setAllocKey, setNetAssocFee }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fy, fys.join(","), mode, month, lastMonth, layer, allocKey, netAssocFee, period]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBuFilters(): BuFilterState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBuFilters outside BuFilterProvider");
  return c;
}
