"use client";

// DataBoot — live-data hydration gate。有 session 先行 hydrate()（RLS 要登入
// 先讀到），完成前顯示「同步數據中…」，失敗顯示「同步失敗」+ error message。
// 未登入時直接 pass-through（auth gate 喺 Shell 層負責顯示登入畫面），並監聽
// auth state：一登入即開始 hydrate。

import { useEffect, useState } from "react";
import { hydrate } from "@/lib/store";
import { supabase } from "@/lib/supabase";

type Phase = "checking" | "syncing" | "ready" | "error" | "anon";

export function DataBoot({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    let started = false;

    const run = async () => {
      if (started) return;
      started = true;
      if (!cancelled) setPhase("syncing");
      try {
        await hydrate();
        if (!cancelled) setPhase("ready");
      } catch (e) {
        started = false; // hydrate 內部會 reset promise，容許 retry
        if (!cancelled) {
          setErrMsg(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) void run();
      else setPhase("anon");
    });

    // 同 auth gate 夾位：登入完成（SIGNED_IN）即開始 hydrate
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void run();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (phase === "checking" || phase === "syncing") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="text-sm font-medium text-ink">同步數據中…</div>
          <div className="mt-1.5 text-[12px] text-ink3">正由 Supabase 讀取財務數據</div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-ringc bg-surface p-5 text-center">
          <div className="text-sm font-semibold text-ink">同步失敗</div>
          <div className="mt-2 break-words text-[12px] leading-relaxed text-ink2">{errMsg}</div>
          <div className="mt-2 text-[11px] text-ink3">請重新整理頁面再試；持續失敗請聯絡管理員。</div>
        </div>
      </div>
    );
  }

  // ready — 或未登入（anon：auth gate 會接手顯示登入畫面）
  return <>{children}</>;
}
