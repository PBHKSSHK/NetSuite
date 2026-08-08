"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DATA_AS_OF, IS_DEMO } from "@/lib/demo";
import { DATA_MODE } from "@/lib/store";
import { supabase } from "@/lib/supabase";

const NAV = [
  { href: "/", label: "集團總覽", en: "Overview" },
  { href: "/pnl", label: "損益表", en: "P&L" },
  { href: "/balance-sheet", label: "資產負債表", en: "Balance Sheet" },
  { href: "/budget", label: "預算", en: "Budgeting" },
  { href: "/cashflow", label: "現金流", en: "Cashflow" },
  { href: "/cost-center", label: "成本中心", en: "Cost Center" },
  { href: "/clients", label: "客戶", en: "Clients" },
  { href: "/operations", label: "營運", en: "Operations" },
  { href: "/business-lines", label: "業務線", en: "Biz Lines" },
];

type AuthState = "loading" | "signed-in" | "signed-out";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>("loading");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setAuth(data.session ? "signed-in" : "signed-out");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(session ? "signed-in" : "signed-out");
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (auth === "signed-out" && pathname !== "/login") {
      router.replace("/login");
    }
  }, [auth, pathname, router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (auth === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-ink3">
        載入中…
      </div>
    );
  }

  // login 頁唔包 sidebar（登入前後都係全版顯示，成功後會 push 返 "/"）
  if (pathname === "/login") {
    return <>{children}</>;
  }

  if (auth === "signed-out") {
    // redirect effect 進行中
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-ink3">
        載入中…
      </div>
    );
  }

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
          <div className="mt-2">
            <button
              onClick={handleSignOut}
              className="text-[11px] text-ink2 border border-ringc rounded-md px-2.5 py-1 hover:bg-ink3/10"
            >
              登出
            </button>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        {DATA_MODE === "live" ? (
          <div className="bg-deltagood/10 border-b border-deltagood/40 px-4 py-1.5 text-[12px] text-ink2">
            <span className="font-semibold text-ink">真實數據</span> — NetSuite
            已接通（P&L 行項用臨時 mapping，待會計確認；預算未 import）
          </div>
        ) : (
          IS_DEMO && (
            <div className="bg-warn/15 border-b border-warn/40 px-4 py-1.5 text-[12px] text-ink2">
              <span className="font-semibold text-ink">DEMO 數據</span> — 所有數字為示範用虛構數據，結構跟足
              blueprint（真實 NetSuite sync 屬下一階段，未過 §10.4 對數驗收前不開放真數）。
            </div>
          )
        )}
        <main className="p-4 lg:p-6 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
