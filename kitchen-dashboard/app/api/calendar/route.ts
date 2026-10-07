import { NextResponse } from "next/server";
import { deleteRow, getRow, insertRow, listRows, updateRow } from "../../../lib/supabase";
import { getKitchenActor } from "../../../lib/supabase-auth";
import {readInventory} from "../../../lib/inventory";
import {convertInventoryQuantity} from "../../../lib/inventory-import-data";

export const runtime = "nodejs";

type Volunteer = { id: string; name: string; isActive: boolean };
type InventoryItem = { id: string; name: string; unit: string };
type MealPeriod = "morning" | "afternoon" | "evening";
type FestivePlan = Record<MealPeriod, {
  cookVolunteerId: string | null;
  cookName: string | null;
  helperVolunteers: { id: string; name: string }[];
  dishes: string;
  ingredients: { id: string; inventoryItemId: string | null; name: string; requiredQuantity: number; unit: string }[];
}>;
type EventFestivePlan = { days: Record<string, FestivePlan> };
type CalendarEntry = {
  id: string;
  date: string;
  endDate?: string | null;
  entryType: "event" | "cooking";
  title: string;
  details: string | null;
  mealPeriod: "morning" | "afternoon" | "evening" | null;
  volunteerId: string | null;
  cookName: string | null;
  eventKind?: "normal" | "festive";
  festivePlan?: FestivePlan | EventFestivePlan | null;
};
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const calendarFailure = (error: unknown, fallback: string) => {
  if (error instanceof Error && /^(Supabase is missing the event end date field\.|Supabase calendar fields are missing\.)/.test(error.message)) return json({ error: error.message }, 503);
  if (error instanceof Error && error.message === "Supabase kitchen tables are missing.") return json({ error: "The kitchen calendar table is missing. Run the latest kitchen schema SQL in Supabase, then try again." }, 503);
  return json({ error: fallback }, 503);
};
const clean = (value: unknown, max = 180) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};
const mealPeriods: MealPeriod[] = ["morning", "afternoon", "evening"];

async function normalizeFestivePlan(
  value: unknown,
  startDate: string,
  endDate: string,
  volunteerById: Map<string, Volunteer>,
  inventoryById: Map<string, InventoryItem>,
): Promise<{ plan?: EventFestivePlan | null; error?: string }> {
  if (value === null || value === undefined) return { plan: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Add the festive meal plan and try again." };
  const raw = value as Record<string, unknown>;
  const rawDays = raw.days && typeof raw.days === "object" && !Array.isArray(raw.days)
    ? raw.days as Record<string, unknown>
    : {[startDate]: raw};
  const allowedDates = new Set<string>();
  const dateCursor = new Date(`${startDate}T12:00:00Z`);
  const lastDate = new Date(`${endDate}T12:00:00Z`);
  while (dateCursor <= lastDate && allowedDates.size <= 366) {
    allowedDates.add(dateCursor.toISOString().slice(0, 10));
    dateCursor.setUTCDate(dateCursor.getUTCDate() + 1);
  }
  const plan: EventFestivePlan = {days: {}};
  if (Object.keys(rawDays).length === 0) return {plan};
  for (const [date, rawPlan] of Object.entries(rawDays)) {
    if (!validDate(date) || !allowedDates.has(date)) return {error: "Meal plans must use dates inside the big event."};
    if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) return {error: "Add a valid meal plan for each event day."};
    const day = rawPlan as Record<string, unknown>;
    const normalizedDay = {} as FestivePlan;
    for (const period of mealPeriods) {
      const meal = day[period];
      if (!meal || typeof meal !== "object" || Array.isArray(meal)) return { error: `Complete the ${period} meal plan for ${date}.` };
      const details = meal as Record<string, unknown>;
      const cookId = clean(details.cookVolunteerId, 80) || null;
      const cook = cookId ? volunteerById.get(cookId) : undefined;
      if (cookId && !cook) return { error: `Choose an active volunteer to cook the ${period} meal on ${date}.` };
      const helperIds = Array.isArray(details.helperVolunteerIds) ? details.helperVolunteerIds : [];
      const helpers: { id: string; name: string }[] = [];
      for (const rawId of helperIds.slice(0, 30)) {
        const person = volunteerById.get(clean(rawId, 80));
        if (!person) return { error: "Choose helpers from the active volunteer roster." };
        if (!helpers.some(helper => helper.id === person.id)) helpers.push({ id: person.id, name: person.name });
      }
      const rawIngredients = Array.isArray(details.ingredients) ? details.ingredients : [];
      if (rawIngredients.length > 40) return { error: "Keep each meal to 40 ingredients or fewer." };
      const ingredients: FestivePlan[MealPeriod]["ingredients"] = [];
      for (const rawItem of rawIngredients) {
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
        const ingredient = rawItem as Record<string, unknown>;
        const inventoryItemId = clean(ingredient.inventoryItemId, 80) || null;
        const pantryItem = inventoryItemId ? inventoryById.get(inventoryItemId) : undefined;
        if (inventoryItemId && !pantryItem) return { error: "Refresh the pantry list and choose an available item." };
        const name = clean(ingredient.name, 120) || pantryItem?.name || "";
        const requiredQuantity = Number(ingredient.requiredQuantity);
        const unit = clean(ingredient.unit, 32) || pantryItem?.unit || "";
        if (!name || !Number.isFinite(requiredQuantity) || requiredQuantity <= 0 || !unit) return { error: "Each ingredient needs a name, quantity, and unit." };
        const pantryQuantity = pantryItem ? convertInventoryQuantity(requiredQuantity, unit, pantryItem.unit) : null;
        if (pantryItem && pantryQuantity === null) return {error: `Use ${pantryItem.unit} for ${pantryItem.name}, or a package unit with its weight.`};
        ingredients.push({ id: clean(ingredient.id, 80) || crypto.randomUUID(), inventoryItemId: pantryItem?.id ?? null, name, requiredQuantity: pantryQuantity ?? requiredQuantity, unit: pantryItem?.unit ?? unit });
      }
      normalizedDay[period] = {cookVolunteerId: cook?.id ?? null, cookName: cook?.name ?? null, helperVolunteers: helpers, dishes: clean(details.dishes, 500), ingredients};
    }
    plan.days[date] = normalizedDay;
  }
  return {plan};
}

async function getVolunteerAndInventoryIndexes() {
  const [volunteers, inventory] = await Promise.all([
    listRows<Volunteer>("volunteers", "name.asc"),
    readInventory(),
  ]);
  return {
    volunteerById: new Map(volunteers.filter(person => person.isActive !== false).map(person => [person.id, person])),
    inventoryById: new Map(inventory.flatMap(item => item.sourceIds.map(id => [id, item] as [string, InventoryItem]))),
  };
}

type EventValues = {date: string; endDate: string; title: string; details: string | null; eventKind: "normal" | "festive"; festivePlan: EventFestivePlan | FestivePlan | null};
async function eventValues(body: Record<string, unknown>): Promise<{values: EventValues} | {error: string}> {
  const title = clean(body.title);
  const details = clean(body.details, 500);
  const date = clean(body.date, 10);
  const endDate = clean(body.endDate, 10) || date;
  const eventKind = body.eventKind === "festive" ? "festive" : "normal";
  if (!validDate(date) || !validDate(endDate)) return {error: "Choose valid event start and end dates."};
  if (endDate < date) return {error: "The event end date must be on or after its start date."};
  if ((new Date(`${endDate}T12:00:00Z`).getTime() - new Date(`${date}T12:00:00Z`).getTime()) / 86400000 > 365) return {error: "Big events can be up to one year long."};
  if (!title) return { error: "Enter an event name." };
  if (eventKind === "normal") return { values: { date, endDate, title, details: details || null, eventKind, festivePlan: null } };
  let normalized: {plan?: EventFestivePlan | null; error?: string};
  if (body.festivePlan === null || body.festivePlan === undefined) normalized = {plan: null};
  else {
    const {volunteerById, inventoryById} = await getVolunteerAndInventoryIndexes();
    normalized = await normalizeFestivePlan(body.festivePlan, date, endDate, volunteerById, inventoryById);
  }
  if (normalized.error) return {error: normalized.error};
  return { values: { date, endDate, title, details: details || null, eventKind, festivePlan: normalized.plan ?? null } };
}

async function getActor() {
  const actor = await getKitchenActor();
  if (!actor) return { error: json({ error: "Your Google account does not have access to this kitchen dashboard. Ask an Admin to add your email." }, 403) };
  return { actor };
}

async function requireEditor() {
  const auth = await getActor();
  if (auth.error) return auth;
  if (auth.actor.role === "viewer") return { error: json({ error: "Your account has view-only access. Send a change request to an Admin." }, 403) };
  return auth;
}

export async function GET() {
  try {
    const auth = await getActor();
    if (auth.error) return auth.error;
    const [entries, inventory] = await Promise.all([
      listRows<CalendarEntry>("kitchen_calendar", "date.asc,title.asc"), readInventory(),
    ]);
    const pantryById = new Map(inventory.flatMap(item => item.sourceIds.map(id => [id, item] as const)));
    const linkPlan = (plan: FestivePlan): FestivePlan => Object.fromEntries(mealPeriods.map(period => {
      const meal = plan[period];
      if (!meal) return [period, meal];
      return [period, {...meal, ingredients: (meal.ingredients ?? []).map(ingredient => {
        const pantryItem = ingredient.inventoryItemId ? pantryById.get(ingredient.inventoryItemId) : undefined;
        if (!pantryItem) return ingredient;
        const quantity = convertInventoryQuantity(ingredient.requiredQuantity, ingredient.unit, pantryItem.unit);
        return {...ingredient, inventoryItemId: pantryItem.id, ...(quantity === null ? {} : {requiredQuantity: quantity, unit: pantryItem.unit})};
      })}];
    })) as FestivePlan;
    return json({entries: entries.map(entry => {
      const plan = entry.festivePlan;
      if (!plan) return entry;
      const festivePlan = "days" in plan
        ? {days: Object.fromEntries(Object.entries(plan.days).map(([date, day]) => [date, linkPlan(day)]))}
        : linkPlan(plan);
      return {...entry, festivePlan};
    })});
  } catch (error) {
    console.error("Kitchen calendar could not be loaded", error);
    return calendarFailure(error, "Kitchen calendar is unavailable. Please try again.");
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireEditor();
    if (auth.error) return auth.error;
    const body = await request.json() as Record<string, unknown>;
    const date = clean(body.date, 10);
    if (!validDate(date)) return json({ error: "Choose a valid event date." }, 400);
    const result = await eventValues(body);
    if ("error" in result) return json({ error: result.error }, 400);
    const [created] = await insertRow("kitchen_calendar", {
      id: crypto.randomUUID(), entryType: "event", ...result.values,
      mealPeriod: null, volunteerId: null, cookName: null,
      createdBy: auth.actor.email, createdAt: new Date().toISOString(),
    });
    return json({ ok: true, id: created?.id }, 201);
  } catch (error) {
    console.error("Kitchen calendar event could not be saved", error);
    return calendarFailure(error, "Could not add the event. Please try again.");
  }
}

export async function PUT(request: Request) {
  let savingEvent = false;
  try {
    const auth = await requireEditor();
    if (auth.error) return auth.error;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "update-meal") {
      savingEvent = true;
      const id = clean(body.id, 80);
      const date = clean(body.date, 10);
      const period = body.mealPeriod as MealPeriod;
      const existing = id ? await getRow<CalendarEntry>("kitchen_calendar", id) : undefined;
      if (!existing || existing.entryType !== "event" || existing.eventKind !== "festive") return json({error: "That big event could not be found."}, 404);
      if (!validDate(date) || date < existing.date || date > (existing.endDate || existing.date) || !mealPeriods.includes(period)) return json({error: "Choose a meal inside this event's dates."}, 400);
      const patch = body.patch as Record<string, unknown> | undefined;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return json({error: "Choose the meal fields to update."}, 400);
      // Validate only the changed fields, preserving other days and existing assignments.
      const emptyMeal = () => ({cookVolunteerId: null, cookName: null, helperVolunteerIds: [], helperVolunteers: [], dishes: "", ingredients: []});
      const candidate: Record<string, Record<string, unknown>> = Object.fromEntries(mealPeriods.map(key => [key, emptyMeal()]));
      const fields = ["dishes", "helperVolunteerIds", "ingredients"] as const;
      if (!fields.some(field => field in patch)) return json({error: "Choose the meal fields to update."}, 400);
      if (("dishes" in patch && typeof patch.dishes !== "string") || ("helperVolunteerIds" in patch && !Array.isArray(patch.helperVolunteerIds)) || ("ingredients" in patch && !Array.isArray(patch.ingredients))) return json({error: "Add valid dishes, helpers or ingredients."}, 400);
      for (const field of fields) if (field in patch) candidate[period][field] = patch[field];
      const {volunteerById, inventoryById} = await getVolunteerAndInventoryIndexes();
      const stored = existing.festivePlan;
      const days = stored ? "days" in stored ? {...stored.days} : {[existing.date]: stored} : {};
      const day = days[date] || {morning: emptyMeal(), afternoon: emptyMeal(), evening: emptyMeal()};
      // Keep previously assigned helpers available for removal even if they became inactive.
      for (const helper of day[period].helperVolunteers) {
        if (!volunteerById.has(helper.id)) volunteerById.set(helper.id, {...helper, isActive: false});
      }
      const normalized = await normalizeFestivePlan({days: {[date]: candidate}}, existing.date, existing.endDate || existing.date, volunteerById, inventoryById);
      if (normalized.error) return json({error: normalized.error}, 400);
      const meal = {...day[period]};
      const validated = normalized.plan!.days[date][period];
      if ("dishes" in patch) meal.dishes = validated.dishes;
      if ("helperVolunteerIds" in patch) meal.helperVolunteers = validated.helperVolunteers;
      if ("ingredients" in patch) meal.ingredients = validated.ingredients;
      days[date] = {...day, [period]: meal};
      await updateRow("kitchen_calendar", id, {festivePlan: {days}});
      return json({ok: true});
    }
    if (body.action === "update-event") {
      savingEvent = true;
      const id = clean(body.id, 80);
      const existing = id ? await getRow<CalendarEntry>("kitchen_calendar", id) : undefined;
      if (!existing || existing.entryType !== "event") return json({ error: "That calendar event could not be found." }, 404);
      const result = await eventValues(body);
      if ("error" in result) return json({ error: result.error }, 400);
      const values = result.values!;
      if (values.eventKind === "festive" && !values.festivePlan && existing.festivePlan) values.festivePlan = existing.festivePlan;
      await updateRow("kitchen_calendar", id, values);
      return json({ ok: true });
    }
    const date = clean(body.date, 10);
    const period = body.mealPeriod;
    const volunteerId = clean(body.volunteerId, 80);
    if (!validDate(date) || !["morning", "afternoon", "evening"].includes(String(period)) || !volunteerId) return json({ error: "Choose a date, meal period, and cook." }, 400);
    const volunteer = await getRow<Volunteer>("volunteers", volunteerId);
    if (!volunteer || volunteer.isActive === false) return json({ error: "Choose an active volunteer from the kitchen roster." }, 400);
    const entries = await listRows<CalendarEntry>("kitchen_calendar", "date.asc,title.asc");
    const existing = entries.find(entry => entry.date === date && entry.entryType === "cooking" && entry.mealPeriod === period);
    const assignment = {
      date, entryType: "cooking", title: volunteer.name, cookName: volunteer.name,
      volunteerId: volunteer.id, mealPeriod: period, details: null,
    };
    if (existing) await updateRow("kitchen_calendar", existing.id, assignment);
    else await insertRow("kitchen_calendar", { id: crypto.randomUUID(), ...assignment, createdBy: auth.actor.email, createdAt: new Date().toISOString() });
    return json({ ok: true });
  } catch (error) {
    console.error(savingEvent ? "Kitchen event changes could not be saved" : "Kitchen cook assignment could not be saved", error);
    return calendarFailure(error, savingEvent ? "Could not save the event changes. Please try again." : "Could not save the cooking assignment. Please try again.");
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireEditor();
    if (auth.error) return auth.error;
    const body = await request.json() as Record<string, unknown>;
    const id = clean(body.id, 80);
    if (!id) return json({ error: "Choose a calendar entry to remove." }, 400);
    if (!await getRow<CalendarEntry>("kitchen_calendar", id)) return json({ error: "That calendar entry could not be found." }, 404);
    await deleteRow("kitchen_calendar", id);
    return json({ ok: true });
  } catch (error) {
    console.error("Kitchen calendar entry could not be removed", error);
    return json({ error: "Could not remove the calendar entry. Try again." }, 503);
  }
}
