import { NextResponse } from "next/server";
import { getRow, insertRow, insertRows, listRows, updateRow } from "../../../lib/supabase";
import { getKitchenActor } from "../../../lib/supabase-auth";
import { inventoryItemKey, MAX_IMPORT_ITEMS, validateImportedItem, type ImportedInventoryItem } from "../../../lib/inventory-import-data";
import {readInventory, updateCombinedInventory} from "../../../lib/inventory";

export const runtime = "nodejs";

type Volunteer = { id: string; name: string; hours: number; isActive: boolean };
type Shift = { id: string; volunteerId: string; checkedInAt: string | null; checkedOutAt: string | null };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const clean = (value: unknown, max = 140) => typeof value === "string" ? value.trim().slice(0, max) : "";
const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

function toClientError(error: unknown) {
  console.error("Kitchen operations request failed", error);
  if (error instanceof Error && error.message.includes("Supabase Auth needs")) return "Supabase Auth needs the project URL and publishable API key in the app environment.";
  if (error instanceof Error && error.message.includes("not connected yet")) return "Supabase is not connected yet. Add the project URL and server key in site settings.";
  if (error instanceof Error && error.message.includes("volunteer fields are missing")) return "Supabase is missing the volunteer email and active-status fields. Run the latest kitchen schema SQL in the Supabase SQL Editor, then try again.";
  if (error instanceof Error && error.message.includes("kitchen tables are missing")) return "The kitchen tables are not installed in Supabase. Run the latest kitchen schema SQL in the Supabase SQL Editor, then try again.";
  if (error instanceof Error && error.message.startsWith("Supabase request failed")) return "Supabase could not complete that request. Run the latest kitchen schema SQL in the Supabase SQL Editor, then try again.";
  return "Kitchen records are unavailable right now. Please try again.";
}

export async function GET() {
  try {
    const actor = await getKitchenActor();
    if (!actor) return json({ error: "Your Google account does not have access to this kitchen dashboard. Ask an Admin to add your email." }, 403);
    const [stock, costs, schedule] = await Promise.all([
      readInventory(),
      listRows("expenses", "spent_at.desc"),
      actor.role === "admin" ? listRows("shifts", "date.asc,start_time.asc") : Promise.resolve([]),
    ]);
    const people = actor.role === "admin"
      ? await listRows("volunteers", "created_at.desc")
      : actor.role === "staff"
        ? (await listRows<{id: string; name: string; isActive: boolean}>("volunteers", "name.asc"))
          .filter(person => person.isActive !== false)
          .map(({id, name, isActive}) => ({id, name, isActive}))
        : [];
    return json({ inventory: stock, volunteers: people, shifts: schedule, expenses: costs, role: actor.role });
  } catch (error) {
    return json({ error: toClientError(error) }, 503);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getKitchenActor();
    if (!actor) return json({ error: "Your Google account does not have access to this kitchen dashboard. Ask an Admin to add your email." }, 403);
    if (actor.role === "viewer") return json({ error: "Your account has view-only access." }, 403);
    const body = await request.json() as Record<string, unknown>;
    if (actor.role === "staff" && !["inventory", "inventory-import", "expense"].includes(String(body.type))) return json({ error: "Kitchen staff can add inventory and expenses. An Admin manages volunteers and shifts." }, 403);
    const id = crypto.randomUUID();
    const today = localDate();
    switch (body.type) {
      case "inventory-import": {
        if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_IMPORT_ITEMS) return json({error: `Import between 1 and ${MAX_IMPORT_ITEMS} items at a time.`}, 400);
        const items: ImportedInventoryItem[] = [];
        for (let index = 0; index < body.items.length; index++) {
          const result = validateImportedItem(body.items[index]);
          if (!result.item) return json({error: `Item ${index + 1}: ${result.errors.join(" ")}`}, 400);
          items.push(result.item);
        }
        const existing = await readInventory();
        const seen = new Set(existing.map(inventoryItemKey));
        let combined = 0;
        for (const item of items) {
          const key = inventoryItemKey(item);
          if (seen.has(key)) combined++;
          seen.add(key);
        }
        // Insert the batch together: duplicate quantities add without overwriting
        // stock added by another user. Reads combine all matching records.
        await insertRows("inventory", items.map(item => ({...item, id: crypto.randomUUID(), updatedAt: today})));
        return json({ok: true, imported: items.length, combined, inventory: await readInventory()}, 201);
      }
      case "inventory": {
        const name = clean(body.name);
        const unit = clean(body.unit, 24);
        const quantity = amount(body.quantity);
        const threshold = amount(body.threshold);
        if (!name || !unit || quantity === null || threshold === null) return json({ error: "Add a name, unit, and valid quantities." }, 400);
        await insertRow("inventory", { id, name, unit, quantity, threshold, updatedAt: today });
        break;
      }
      case "volunteer": {
        const name = clean(body.name);
        if (!name) return json({ error: "Add a volunteer name." }, 400);
        const email = clean(body.email, 254).toLowerCase();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address, or leave it blank." }, 400);
        await insertRow("volunteers", { id, name, role: clean(body.role) || "Kitchen volunteer", phone: clean(body.phone, 32) || null, email: email || null, isActive: true, hours: 0, createdAt: today });
        break;
      }
      case "shift": {
        const volunteerId = clean(body.volunteerId);
        const person = await getRow<Volunteer>("volunteers", volunteerId);
        const date = clean(body.date, 10);
        const startTime = clean(body.startTime, 5);
        const endTime = clean(body.endTime, 5);
        const assignment = clean(body.assignment);
        if (!person || person.isActive === false || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !startTime || !endTime || !assignment) return json({ error: "Choose an active volunteer, date, time, and assignment." }, 400);
        await insertRow("shifts", { id, volunteerId, volunteerName: person.name, date, startTime, endTime, assignment, checkedInAt: null, checkedOutAt: null });
        break;
      }
      case "expense": {
        const description = clean(body.description);
        const category = clean(body.category) || "Other";
        const value = amount(body.amount);
        if (!description || value === null || value === 0) return json({ error: "Add a description and a positive amount." }, 400);
        await insertRow("expenses", { id, description, category, amount: value, spentAt: clean(body.date, 10) || today });
        break;
      }
      default: return json({ error: "Choose a valid kitchen record type." }, 400);
    }
    return json({ ok: true }, 201);
  } catch (error) {
    return json({ error: toClientError(error) }, 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getKitchenActor();
    if (!actor) return json({ error: "Your Google account does not have access to this kitchen dashboard. Ask an Admin to add your email." }, 403);
    if (actor.role === "viewer") return json({ error: "Your account has view-only access." }, 403);
    const body = await request.json() as Record<string, unknown>;
    const id = clean(body.id);
    const action = clean(body.action);
    if (!id) return json({ error: "A record is required." }, 400);
    if (actor.role === "staff" && !["stock", "inventory", "expense"].includes(action)) return json({ error: "Kitchen staff can edit calendar, inventory, and expenses. An Admin manages volunteers and shifts." }, 403);
    if (action === "check-in" || action === "check-out") {
      const shift = await getRow<Shift>("shifts", id);
      if (!shift) return json({ error: "That shift could not be found." }, 404);
      if (action === "check-in") await updateRow("shifts", id, { checkedInAt: new Date().toISOString(), checkedOutAt: null });
      else {
        if (!shift.checkedInAt) return json({ error: "Check in before checking out." }, 400);
        if (shift.checkedOutAt) return json({ error: "This shift has already been checked out." }, 400);
        const hours = Math.max(0, (Date.now() - new Date(shift.checkedInAt).getTime()) / 3600000);
        const person = await getRow<Volunteer>("volunteers", shift.volunteerId);
        if (person) await updateRow("volunteers", person.id, { hours: person.hours + hours });
        await updateRow("shifts", id, { checkedOutAt: new Date().toISOString() });
      }
    } else if (action === "volunteer-status") {
      if (typeof body.isActive !== "boolean") return json({ error: "Choose an active or inactive status." }, 400);
      const person = await getRow<Volunteer>("volunteers", id);
      if (!person) return json({ error: "That volunteer could not be found." }, 404);
      await updateRow("volunteers", id, { isActive: body.isActive });
    } else if (action === "stock") {
      const quantity = amount(body.quantity);
      if (quantity === null) return json({ error: "Enter a valid stock quantity." }, 400);
      if (!await updateCombinedInventory(id, {quantity}, localDate())) return json({error: "That pantry item could not be found."}, 404);
    } else if (action === "inventory") {
      const name = clean(body.name);
      const unit = clean(body.unit, 24);
      const quantity = amount(body.quantity);
      const threshold = amount(body.threshold);
      if (!name || !unit || quantity === null || threshold === null) return json({ error: "Add a name, unit, and valid quantities." }, 400);
      if (!await updateCombinedInventory(id, {name, unit, quantity, threshold}, localDate())) return json({ error: "That pantry item could not be found." }, 404);
    } else if (action === "expense") {
      const description = clean(body.description);
      const category = clean(body.category) || "Other";
      const value = amount(body.amount);
      const spentAt = clean(body.date, 10);
      if (!description || value === null || value === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(spentAt)) return json({ error: "Add a purchase, positive amount, and valid date." }, 400);
      if (!await getRow("expenses", id)) return json({ error: "That expense could not be found." }, 404);
      await updateRow("expenses", id, { description, category, amount: value, spentAt });
    } else return json({ error: "Choose a valid update." }, 400);
    return json({ ok: true });
  } catch (error) {
    return json({ error: toClientError(error) }, 503);
  }
}
