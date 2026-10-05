export type ImportedInventoryItem = {
  name: string;
  quantity: number;
  unit: string;
  threshold: number;
};

export const MAX_IMPORT_ITEMS = 500;
const unitAliases: Record<string, string> = {
  lbs: "lb", pound: "lb", pounds: "lb",
  kgs: "kg", kilogram: "kg", kilograms: "kg",
  gram: "g", grams: "g", ounce: "oz", ounces: "oz",
  liter: "l", liters: "l", litre: "l", litres: "l",
  milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  bags: "bag", boxes: "box", bottles: "bottle", cans: "can",
  packets: "packet", packs: "pack", pieces: "piece", pcs: "piece", pc: "piece",
};
export const inventoryUnitKey = (unit: string) => unit.trim().toLowerCase()
  .replace(/\s+/g, " ").replace(/[a-z]+/g, word => unitAliases[word] ?? word)
  .replace(/\s*([()])\s*/g, "$1").replace(/(\d)\s+(?=[a-z])/g, "$1");
// Exact international pound definition; package weights must be explicitly stated.
const kilogramsPerUnit: Record<string, number> = {kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125};
function weightUnit(unit: string): {factor: number; packaged: boolean} | null {
  const key = inventoryUnitKey(unit);
  const plain = key.replace(/^\((kg|g|lb|oz)\)$/, "$1");
  if (kilogramsPerUnit[plain]) return {factor: kilogramsPerUnit[plain], packaged: false};
  const pack = /^(?:bag|box|packet|pack|bottle|can)\((\d+(?:\.\d+)?)(kg|g|lb|oz)\)$/.exec(key);
  if (!pack || Number(pack[1]) <= 0) return null;
  return {factor: Number(pack[1]) * kilogramsPerUnit[pack[2]], packaged: true};
}
export function convertInventoryQuantity(quantity: number, fromUnit: string, toUnit: string): number | null {
  if (inventoryUnitKey(fromUnit) === inventoryUnitKey(toUnit)) return quantity;
  const from = weightUnit(fromUnit), to = weightUnit(toUnit);
  return from && to ? Number((quantity * from.factor / to.factor).toPrecision(15)) : null;
}
export const inventoryItemKey = (item: {name: string; unit: string}) =>
  JSON.stringify([item.name.trim().replace(/\s+/g, " ").toLowerCase(), weightUnit(item.unit) ? "weight" : inventoryUnitKey(item.unit)]);

export type InventoryRecord = ImportedInventoryItem & {id: string; updatedAt?: string; category?: string};
export type CombinedInventoryItem = InventoryRecord & {sourceIds: string[]};

export function combineInventory(items: InventoryRecord[]): CombinedInventoryItem[] {
  const groups = new Map<string, InventoryRecord[]>();
  // Stable IDs keep pantry references consistent regardless of database row order.
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = inventoryItemKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map(members => {
    const first = members[0];
    // Prefer a loose stock unit over a package count when combining weights.
    const unit = members.find(item => weightUnit(item.unit)?.packaged === false)?.unit ?? first.unit;
    return {...first, unit,
      quantity: Number(members.reduce((sum, item) => sum + (convertInventoryQuantity(item.quantity, item.unit, unit) ?? item.quantity), 0).toPrecision(15)),
      threshold: Math.max(...members.map(item => convertInventoryQuantity(item.threshold, item.unit, unit) ?? item.threshold)),
      sourceIds: members.map(item => item.id),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function validateImportedItem(value: unknown): {item?: ImportedInventoryItem; errors: string[]} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {errors: ["Invalid item."]};
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const unit = typeof raw.unit === "string" ? raw.unit.trim() : "";
  const errors: string[] = [];
  if (!name || name.length > 140) errors.push("Item name is required (up to 140 characters).");
  if (!unit || unit.length > 24) errors.push("Unit is required (up to 24 characters).");
  if (typeof raw.quantity !== "number" || !Number.isFinite(raw.quantity) || raw.quantity < 0) errors.push("Quantity must be a number of zero or more.");
  if (typeof raw.threshold !== "number" || !Number.isFinite(raw.threshold) || raw.threshold < 0) errors.push("Restock level must be a number of zero or more.");
  return errors.length ? {errors} : {errors, item: {name, unit, quantity: raw.quantity as number, threshold: raw.threshold as number}};
}
