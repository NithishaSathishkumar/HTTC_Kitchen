import { NextResponse } from "next/server";
import { getRow, getRowBy, insertRow, listRows, updateRow } from "../../../lib/supabase";
import { getKitchenActor } from "../../../lib/supabase-auth";

export const runtime = "edge";

type ChangeRequest = {
  id: string;
  requesterEmail: string;
  requesterName: string;
  message: string;
  status: "pending" | "handled" | "declined";
  createdAt: string;
  updatedAt: string;
};
type KitchenAccess = { id: string; email: string; role: "admin" | "staff" | "viewer" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function GET() {
  try {
    const actor = await getKitchenActor();
    if (!actor) return json({ error: "Sign in with an account that has kitchen dashboard access." }, 403);
    const rows = await listRows<ChangeRequest>("change_requests", "created_at.desc");
    const requests = actor.role === "admin" ? rows : rows.filter(row => row.requesterEmail === actor.email);
    return json({ requests });
  } catch (error) {
    console.error("Kitchen change requests could not be loaded", error);
    return json({ error: "Change requests are unavailable. Check that the latest kitchen schema is installed." }, 503);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getKitchenActor();
    if (!actor) return json({ error: "Sign in with an account that has kitchen dashboard access." }, 403);
    const body = await request.json() as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length < 10 || message.length > 500) return json({ error: "Describe the change in 10 to 500 characters." }, 400);
    const now = new Date().toISOString();
    await insertRow("change_requests", {
      id: crypto.randomUUID(), requesterEmail: actor.email, requesterName: actor.name,
      message, status: "pending", createdAt: now, updatedAt: now,
    });
    return json({ ok: true }, 201);
  } catch (error) {
    console.error("Kitchen change request could not be saved", error);
    return json({ error: "Could not send the request. Check that the latest kitchen schema is installed." }, 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getKitchenActor();
    if (!actor) return json({ error: "Sign in with an account that has kitchen dashboard access." }, 403);
    if (actor.role !== "admin") return json({ error: "Only a kitchen Admin can review change requests." }, 403);
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const action = body.action;
    if (!id || !["handled", "declined", "grant-staff"].includes(String(action))) return json({ error: "Choose a request and a valid review action." }, 400);
    const changeRequest = await getRow<ChangeRequest>("change_requests", id);
    if (!changeRequest) return json({ error: "That request could not be found." }, 404);
    if (changeRequest.status !== "pending") return json({ error: "That request has already been reviewed." }, 409);

    if (action === "grant-staff") {
      const member = await getRowBy<KitchenAccess>("kitchen_access", "email", changeRequest.requesterEmail);
      if (!member) return json({ error: "This requester no longer has dashboard access." }, 409);
      await updateRow("kitchen_access", member.id, { role: "staff" });
    }
    await updateRow("change_requests", id, {
      status: action === "declined" ? "declined" : "handled",
      updatedAt: new Date().toISOString(),
    });
    return json({ ok: true });
  } catch (error) {
    console.error("Kitchen change request could not be reviewed", error);
    return json({ error: "Could not review the request. Check that the latest kitchen schema is installed." }, 503);
  }
}
