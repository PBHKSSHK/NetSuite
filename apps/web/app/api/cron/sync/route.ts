import { NextResponse } from "next/server";

// Vercel Cron entry point for the NetSuite → Supabase sync (blueprint §2.2).
// Wiring requires NetSuite OAuth2 M2M credentials + Supabase service-role key
// in Vercel env vars — see packages/sync/README.md.

export function GET() {
  return NextResponse.json(
    {
      status: "not_configured",
      message:
        "Sync worker not wired yet (Phase 1 demo build). See packages/sync/README.md for the SuiteQL specs and setup steps.",
    },
    { status: 501 }
  );
}
