import { NextResponse } from "next/server";
import { deleteRow, getRow, getRowBy, insertRow, listRows, updateRow } from "../../../lib/supabase";
import { getKitchenActor, type KitchenRole } from "../../../lib/supabase-auth";

export const runtime = "edge";

type KitchenAccess = { id: string; email: string; role: KitchenRole; createdAt: string };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const roleOf = (value: unknown): KitchenRole | null => value === "admin" || value === "staff" || value === "viewer" ? value : null;
const emailIsValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function requireAdmin() {
  const actor = await getKitchenActor();
  if (!actor) return { error: json({ error: "Your Google account does not have access to this kitchen dashboard. Ask an Admin to add your email." }, 403) };
  if (actor.role !== "admin") return { error: json({ error: "Only a kitchen Admin can manage access." }, 403) };
  return { actor };
}

async function isLastAdmin(id: string) {
  const [target, access] = await Promise.all([
    getRow<KitchenAccess>("kitchen_access", id),
    listRows<KitchenAccess>("kitchen_access", "email.asc"),
  ]);
  return target?.role === "admin" && access.filter(member => member.role === "admin").length <= 1;
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const people = await listRows<KitchenAccess>("kitchen_access", "email.asc");
    return json({ people });
  } catch {
    return json({ error: "Kitchen access settings are unavailable. Check that the latest kitchen schema is installed." }, 503);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const body = await request.json() as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = roleOf(body.role);
    if (!emailIsValid(email) || !role) return json({ error: "Enter a valid email and choose an access role." }, 400);
    if (await getRowBy<KitchenAccess>("kitchen_access", "email", email)) return json({ error: "That email already has dashboard access." }, 409);
    await insertRow("kitchen_access", { id: crypto.randomUUID(), email, role, createdAt: new Date().toISOString() });
    return json({ ok: true }, 201);
  } catch {
    return json({ error: "Could not add this person. Check the kitchen schema and try again." }, 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const role = roleOf(body.role);
    if (!id || !role) return json({ error: "Choose a person and a valid access role." }, 400);
    if (role !== "admin" && await isLastAdmin(id)) return json({ error: "Keep at least one Admin assigned to the kitchen." }, 400);
    if (!await getRow<KitchenAccess>("kitchen_access", id)) return json({ error: "That person could not be found." }, 404);
    await updateRow("kitchen_access", id, { role });
    return json({ ok: true });
  } catch {
    return json({ error: "Could not update this access role. Try again." }, 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return json({ error: "Choose a person to remove." }, 400);
    if (await isLastAdmin(id)) return json({ error: "Keep at least one Admin assigned to the kitchen." }, 400);
    if (!await getRow<KitchenAccess>("kitchen_access", id)) return json({ error: "That person could not be found." }, 404);
    await deleteRow("kitchen_access", id);
    return json({ ok: true });
  } catch {
    return json({ error: "Could not remove this person's dashboard access. Try again." }, 503);
  }
}
