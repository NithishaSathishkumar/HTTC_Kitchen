import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

export const runtime = "edge";

export async function GET() {
  const url = env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = env.SUPABASE_API_KEY;
  if (!url || !publishableKey) {
    return NextResponse.json({ error: "Supabase Auth is not configured for this app." }, { status: 503 });
  }
  return NextResponse.json({ url, publishableKey }, { headers: { "Cache-Control": "no-store" } });
}
