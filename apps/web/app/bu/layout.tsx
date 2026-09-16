"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BuFilterProvider } from "@/lib/bu-filters";
import { BU_META } from "@/lib/bu-store";

const TABS = [
  { href: "/bu", label: "BU Cockpit" },
  { href: "/bu/pnl", label: "BU P&L" },
  { href: "/bu/bridge", label: "Bridge 法定→管理" },
  { href: "/bu/shared", label: "Shared cost 分攤" },
  { href: "/bu/cash", label: "BU Cashflow" },
  { href: "/bu/quality", label: "Data quality" },
];

export default function BuLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <BuFilterProvider>
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-grid pb-2">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link key={t.href} href={t.href} className={`rounded-md px-2.5 py-1 text-[12px] ${active ? "bg-accent/10 text-accent font-medium" : "text-ink2 hover:bg-ink3/10"}`}>
              {t.label}
            </Link>
          );
        })}
        <span className="ml-auto text-[11px] text-ink3">
          fact_bu_pl：{BU_META.minYm || "—"} → {BU_META.maxYm || "—"}（{BU_META.rows.toLocaleString()} 行）
        </span>
      </div>
      {children}
    </BuFilterProvider>
  );
}
