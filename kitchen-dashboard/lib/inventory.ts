import {combineInventory, inventoryItemKey, type ImportedInventoryItem, type InventoryRecord} from "./inventory-import-data";
import {listAllRows, upsertRows} from "./supabase";

export const readInventoryRecords = () => listAllRows<InventoryRecord>("inventory", "id.asc");
export const readInventory = async () => combineInventory(await readInventoryRecords());

export async function updateCombinedInventory(id: string, values: Partial<ImportedInventoryItem>, updatedAt: string) {
  const records = await readInventoryRecords();
  const selected = records.find(item => item.id === id);
  if (!selected) return false;
  const key = inventoryItemKey(selected);
  const members = records.filter(item => inventoryItemKey(item) === key).sort((a, b) => a.id.localeCompare(b.id));
  const group = combineInventory(members)[0];
  const total = values.quantity ?? group.quantity;
  // Keep every original ID so saved event ingredients remain linked. One atomic
  // write replaces the group total; adding new stock still uses separate inserts.
  await upsertRows("inventory", members.map((item, index) => ({
    id: item.id, category: item.category ?? "Other", name: values.name ?? group.name,
    unit: values.unit ?? group.unit, threshold: values.threshold ?? group.threshold,
    quantity: index === 0 ? total : 0, updatedAt,
  })));
  return true;
}
