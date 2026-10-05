import { inventoryItemKey, inventoryUnitKey, MAX_IMPORT_ITEMS, validateImportedItem, type ImportedInventoryItem } from "./inventory-import-data";

type Cell = string | number | boolean | Date | null;
export type InventorySheet = {sheet: string; data: Cell[][]};
export type ImportField = keyof ImportedInventoryItem;
export type ColumnMapping = Record<ImportField, number>;
export type InventoryPreviewRow = {rowNumber: number; name: string; item?: ImportedInventoryItem; errors: string[]; mergeReason?: string};
export const importFields: {key: ImportField; label: string}[] = [
  {key: "name", label: "Item name"},
  {key: "quantity", label: "Quantity"}, {key: "unit", label: "Unit"}, {key: "threshold", label: "Restock at"},
];
const headerKey = (cell: Cell | undefined) => typeof cell === "string" ? cell.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
const aliases: Record<ImportField, string[]> = {
  name: ["item", "itemname", "name", "product", "productname", "ingredient", "ingredientname"],
  quantity: ["quantity", "qty", "instock", "stock", "currentquantity", "stockquantity", "onhand", "quantityonhand"],
  unit: ["unit", "units", "uom", "unitofmeasure"],
  threshold: ["restockat", "threshold", "restocklevel", "minimum", "minimumstock", "minstock", "minquantity", "reorderlevel"],
};
export function mapInventoryColumns(headers: Cell[]): ColumnMapping {
  return Object.fromEntries(importFields.map(({key}) => [key, headers.findIndex(cell => aliases[key].includes(headerKey(cell)))])) as ColumnMapping;
}
export function findInventoryHeader(data: Cell[][]) {
  const match = data.slice(0, 20).findIndex(row => {
    const mapping = mapInventoryColumns(row);
    return mapping.name >= 0 && mapping.quantity >= 0;
  });
  return match >= 0 ? match : Math.max(0, data.findIndex(row => row.some(cell => cell !== null && cell !== "")));
}
export async function readInventoryWorkbook(file: File): Promise<InventorySheet[]> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel .xlsx file. Save older .xls files as .xlsx first.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a workbook smaller than 5 MB.");
  const {default: readExcelFile} = await import("read-excel-file/browser");
  const sheets = await readExcelFile(file);
  if (!sheets.length) throw new Error("This workbook has no worksheets.");
  return sheets as unknown as InventorySheet[];
}

const cellText = (value: Cell | undefined) => typeof value === "string" ? value.trim() : "";
function stockAmount(value: Cell | undefined): {quantity: number; unit: string} {
  if (typeof value === "number") return {quantity: value, unit: ""};
  if (typeof value !== "string") return {quantity: NaN, unit: ""};
  // Accept numeric cells or the existing export's combined values, such as "12 kg".
  const match = /^\s*(\+?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*$/.exec(value);
  return match && !/^[\d,.+\-]/.test(match[2]) ? {quantity: Number(match[1].replace(/,/g, "")), unit: match[2]} : {quantity: NaN, unit: ""};
}
export function previewInventoryImport(sheet: InventorySheet, headerRow: number, mapping: ColumnMapping, existing: {name: string; unit: string}[]): InventoryPreviewRow[] {
  if (mapping.name < 0 || mapping.quantity < 0) throw new Error("Match the Item name and Quantity columns to continue.");
  const rows = sheet.data.slice(headerRow + 1).map((cells, index) => ({cells, rowNumber: headerRow + index + 2}))
    .filter(({cells}) => cells.some(cell => cell !== null && cell !== ""));
  if (!rows.length) throw new Error("There are no inventory items below the header row.");
  if (rows.length > MAX_IMPORT_ITEMS) throw new Error(`Import up to ${MAX_IMPORT_ITEMS} items at a time. Split this worksheet into smaller files.`);
  const existingKeys = new Set(existing.map(inventoryItemKey));
  const seen = new Set<string>();
  return rows.map(({cells, rowNumber}) => {
    const stock = stockAmount(cells[mapping.quantity]);
    const restockCell = cells[mapping.threshold];
    const restock = mapping.threshold < 0 || restockCell === null || restockCell === undefined || restockCell === "" ? {quantity: 0, unit: ""} : stockAmount(restockCell);
    const unit = cellText(cells[mapping.unit]) || stock.unit || restock.unit;
    const result = validateImportedItem({name: cellText(cells[mapping.name]), quantity: stock.quantity, unit, threshold: restock.quantity});
    if ((stock.unit && inventoryUnitKey(stock.unit) !== inventoryUnitKey(unit)) || (restock.unit && inventoryUnitKey(restock.unit) !== inventoryUnitKey(unit))) result.errors.push("Use the same unit for quantity and restock level.");
    const key = result.item ? inventoryItemKey(result.item) : "";
    const mergeReason = key && existingKeys.has(key) ? "Add to existing stock" : key && seen.has(key) ? "Combine with matching row" : undefined;
    if (key) seen.add(key);
    return {rowNumber, name: cellText(cells[mapping.name]), item: result.item, errors: result.errors, mergeReason};
  });
}
