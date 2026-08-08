"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { supabase, usernameToEmail } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    if (signInError) {
      setError("登入名稱或密碼錯誤");
      setBusy(false);
      return;
    }
    router.push("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="pt-4 pb-3 text-center">
          <h1 className="text-lg font-semibold text-ink">集團管理 Dashboard</h1>
          <p className="text-[12px] text-ink3 mt-1">請登入</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 pb-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-ink2">登入名稱</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="w-full rounded-md border border-ringc bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-ink2">密碼</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-ringc bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40"
            />
          </label>
          {error && <p className="text-[12px] text-critical">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-1 w-full rounded-md bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
          >
            {busy ? "登入中…" : "登入"}
          </button>
        </form>
      </Card>
    </div>
  );
}
