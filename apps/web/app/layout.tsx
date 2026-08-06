import type { Metadata } from "next";
import "./globals.css";
import { FilterProvider } from "@/lib/filters";
import { PaletteProvider } from "@/lib/theme";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "集團管理 Dashboard",
  description:
    "廣告／PR agency 集團管理報表 — P&L、Balance Sheet、Budgeting、Cashflow、Cost Center（NetSuite 數據，示範模式）",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-HK">
      <body className="antialiased">
        <PaletteProvider>
          <FilterProvider>
            <Shell>{children}</Shell>
          </FilterProvider>
        </PaletteProvider>
      </body>
    </html>
  );
}
