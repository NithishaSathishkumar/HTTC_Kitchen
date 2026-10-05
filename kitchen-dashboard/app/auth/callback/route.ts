import { NextResponse } from "next/server";
import { createKitchenAuthClient } from "../../../lib/supabase-auth";

export const runtime = "edge";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const returnTo = requestUrl.searchParams.get("next") ?? "/";
  const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";

  if (code) {
    const supabase = await createKitchenAuthClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeReturnTo, requestUrl.origin));
  }

  return NextResponse.redirect(new URL("/?auth=error", requestUrl.origin));
}
