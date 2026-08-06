"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DATA_AS_OF, IS_DEMO } from "@/lib/demo";

const NAV = [
  { href: "/", label: "集團總覽", en: "Overview" },
  { href: "/pnl", label: "損益表", en: "P&L" },
  { href: "/balance-sheet", label: "資產負債表", en: "Balance Sheet" },
  { href: "/budget", label: "預算", en: "Budgeting" },
  { href: "/cashflow", label: "現金流", en: "Cashflow" },
  { href: "/cost-center", label: "成本中心", en: "Cost Center" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen lg:flex">
      <aside className="lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-grid bg-surface">
        <div className="px-4 py-4 border-b border-grid">
          <div className="text-sm font-semibold leading-tight">集團管理 Dashboard</div>
          <div className="text-[11px] text-ink3 mt-0.5">NetSuite · FY2026/27（4–3 月財年）</div>
        </div>
        <nav className="flex lg:flex-col overflow-x-auto px-2 py-2 gap-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-ink2 hover:bg-ink3/10"
                }`}
              >
                {item.label}
                <span className="ml-1.5 text-[10px] text-ink3">{item.en}</span>
              </Link>
            );
          })}
        </nav>
        <div className="hidden lg:block px-4 py-3 mt-2 border-t border-grid text-[11px] text-ink3 leading-relaxed">
          數據截至 {DATA_AS_OF}
          <br />
          Blueprint v1.0 · Phase 1–2 preview
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        {IS_DEMO && (
          <div className="bg-warn/15 border-b border-warn/40 px-4 py-1.5 text-[12px] text-ink2">
            <span className="font-semibold text-ink">DEMO 數據</span> — 所有數字為示範用虛構數據，結構跟足
            blueprint（真實 NetSuite sync 屬下一階段，未過 §10.4 對數驗收前不開放真數）。
          </div>
        )}
        <main className="p-4 lg:p-6 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
