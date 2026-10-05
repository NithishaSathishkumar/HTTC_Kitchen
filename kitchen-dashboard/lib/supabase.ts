import { env } from "cloudflare:workers";

export type KitchenTable = "inventory" | "volunteers" | "shifts" | "expenses" | "kitchen_access" | "change_requests" | "kitchen_calendar";
type RecordRow = Record<string, unknown>;

function connection() {
  const url = env.SUPABASE_URL?.replace(/\/$/, "");
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase is not connected yet. Add the project URL and server key in site settings.");
  return { url, key };
}

const snake = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const toDatabase = (value: RecordRow) => Object.fromEntries(Object.entries(value).map(([key, entry]) => [snake(key), entry]));
const fromDatabase = <T>(value: RecordRow) => Object.fromEntries(Object.entries(value).map(([key, entry]) => [camel(key), key.endsWith("_time") && typeof entry === "string" ? entry.slice(0, 5) : entry])) as T;

async function request<T>(table: KitchenTable, query: URLSearchParams, method = "GET", body?: RecordRow | RecordRow[], preference = "return=representation"): Promise<T> {
  const { url, key } = connection();
  const response = await fetch(`${url}/rest/v1/${table}?${query.toString()}`, {
    method,
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      ...(method !== "GET" ? { Prefer: preference } : {}),
    },
    ...(body ? { body: JSON.stringify(Array.isArray(body) ? body.map(toDatabase) : toDatabase(body)) } : {}),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`Supabase ${method} ${table} failed (${response.status})`, detail.slice(0, 500));
    try {
      const failure = JSON.parse(detail) as { code?: string; message?: string; details?: string };
      const reason = `${failure.message ?? ""} ${failure.details ?? ""}`;
      if (table === "kitchen_calendar" && /end_date/i.test(reason) && ["PGRST204", "42703"].includes(failure.code ?? "")) {
        throw new Error("Supabase is missing the event end date field. Run supabase/migrations/20261003_multi_day_events.sql in the Supabase SQL Editor, then try again.");
      }
      if (table === "kitchen_calendar" && ["PGRST204", "42703"].includes(failure.code ?? "")) {
        throw new Error("Supabase calendar fields are missing. Run the latest kitchen schema SQL in Supabase, then try again.");
      }
      if (table === "volunteers" && /email|is_active/i.test(reason) && ["PGRST204", "42703"].includes(failure.code ?? "")) {
        throw new Error("Supabase volunteer fields are missing.");
      }
      if (["42P01", "PGRST205"].includes(failure.code ?? "")) {
        throw new Error("Supabase kitchen tables are missing.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Supabase ")) throw error;
    }
    throw new Error(`Supabase request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  const value = await response.json() as RecordRow[];
  return (Array.isArray(value) ? value.map(row => fromDatabase(row)) : value) as T;
}

export function listRows<T>(table: KitchenTable, order: string) {
  return request<T[]>(table, new URLSearchParams({ select: "*", order }));
}

export async function listAllRows<T>(table: KitchenTable, order: string): Promise<T[]> {
  const rows: T[] = [];
  // Use the actual returned count, including projects with a smaller API row limit.
  while (true) {
    const page = await request<T[]>(table, new URLSearchParams({select: "*", order, limit: "1000", offset: String(rows.length)}));
    if (!page.length) return rows;
    rows.push(...page);
  }
}

export async function getRow<T>(table: KitchenTable, id: string): Promise<T | undefined> {
  const rows = await request<T[]>(table, new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" }));
  return rows[0];
}

export async function getRowBy<T>(table: KitchenTable, column: string, value: string): Promise<T | undefined> {
  const rows = await request<T[]>(table, new URLSearchParams({ select: "*", [column]: `eq.${value}`, limit: "1" }));
  return rows[0];
}

export async function callKitchenRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { url, key } = connection();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`Supabase RPC ${name} failed (${response.status})`, detail.slice(0, 500));
    throw new Error(`Supabase request failed (${response.status}).`);
  }
  return await response.json() as T;
}

export function insertRow(table: KitchenTable, value: RecordRow) {
  return request<RecordRow[]>(table, new URLSearchParams({ select: "*" }), "POST", value);
}

export function insertRows<T>(table: KitchenTable, values: RecordRow[]) {
  // A single PostgREST insert keeps a batch atomic when a row fails validation.
  return request<T[]>(table, new URLSearchParams({ select: "*" }), "POST", values);
}

export function upsertRows<T>(table: KitchenTable, values: RecordRow[]) {
  return request<T[]>(table, new URLSearchParams({select: "*"}), "POST", values, "resolution=merge-duplicates,return=representation");
}

export function updateRow(table: KitchenTable, id: string, value: RecordRow) {
  return request<RecordRow[]>(table, new URLSearchParams({ id: `eq.${id}`, select: "*" }), "PATCH", value);
}

export function deleteRow(table: KitchenTable, id: string) {
  return request<RecordRow[]>(table, new URLSearchParams({ id: `eq.${id}`, select: "*" }), "DELETE");
}
