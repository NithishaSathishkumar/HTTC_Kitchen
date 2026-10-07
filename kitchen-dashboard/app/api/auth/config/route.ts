import { NextResponse } from "next/server";
import {getSupabaseEnvironment} from "@/lib/supabase-environment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const {url, publishableKey} = getSupabaseEnvironment();
  if (!url || !publishableKey) {
    return NextResponse.json({ error: "Supabase Auth is not configured for this app." }, { status: 503 });
  }
  return NextResponse.json({ url, publishableKey }, { headers: { "Cache-Control": "no-store" } });
}
