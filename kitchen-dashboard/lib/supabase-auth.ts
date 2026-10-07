import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {getSupabaseEnvironment} from "./supabase-environment";
import { callKitchenRpc, getRowBy } from "./supabase";

export type KitchenRole = "admin" | "staff" | "viewer";
type KitchenAccess = { id: string; email: string; role: KitchenRole };

export async function createKitchenAuthClient() {
  const {url, publishableKey: key} = getSupabaseEnvironment();
  if (!url || !key) {
    throw new Error("Supabase Auth needs SUPABASE_URL and the publishable SUPABASE_API_KEY.");
  }

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot write cookies. Route handlers can.
        }
      },
    },
  });
}

export async function getKitchenUser() {
  const supabase = await createKitchenAuthClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "", name: data.user.user_metadata.full_name ?? data.user.user_metadata.name ?? data.user.email ?? "Kitchen team" };
}

export async function getKitchenActor() {
  const user = await getKitchenUser();
  if (!user || !user.email) return null;
  const email = user.email.trim().toLowerCase();
  let access = await getRowBy<KitchenAccess>("kitchen_access", "email", email);
  if (!access) {
    await callKitchenRpc<boolean>("ensure_kitchen_viewer", { candidate_email: email });
    access = await getRowBy<KitchenAccess>("kitchen_access", "email", email);
  }
  return access ? { ...user, email, role: access.role, accessId: access.id } : null;
}
