"use client";

import { useRef, useState } from "react";
import { Check, FileSpreadsheet, LoaderCircle, Upload, X } from "lucide-react";
import { exportInventoryToExcel } from "@/lib/inventory-export";
import { findInventoryHeader, importFields, mapInventoryColumns, previewInventoryImport, readInventoryWorkbook, type ColumnMapping, type InventorySheet } from "@/lib/inventory-import";
import type { ImportedInventoryItem } from "@/lib/inventory-import-data";

const blankMapping: ColumnMapping = {name: -1, quantity: -1, unit: -1, threshold: -1};

export function InventoryImportDialog({existing, onClose, onImport}: {
  existing: {name: string; unit: string}[];
  onClose: () => void;
  onImport: (items: ImportedInventoryItem[]) => Promise<void>;
}) {
  const [sheets, setSheets] = useState<InventorySheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>(blankMapping);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const busy = reading || saving;
  const sheet = sheets[sheetIndex];
  const headers = sheet?.data[headerRow] ?? [];
  const columnCount = sheet ? Math.max(headers.length, ...sheet.data.slice(headerRow + 1, headerRow + 6).map(row => row.length)) : 0;
  let preview: ReturnType<typeof previewInventoryImport> = [];
  let previewError = "";
  if (sheet) {
    try {
      const matched = Object.values(mapping).filter(column => column >= 0);
      if (new Set(matched).size !== matched.length) throw new Error("Match each inventory field to a different column.");
      preview = previewInventoryImport(sheet, headerRow, mapping, existing);
    } catch (e) { previewError = e instanceof Error ? e.message : "Could not preview this worksheet."; }
  }
  const invalid = preview.filter(row => row.errors.length > 0);
  const additions = preview.filter(row => row.item && !row.errors.length);
  const combined = additions.filter(row => row.mergeReason);

  function selectSheet(nextSheets: InventorySheet[], index: number) {
    const header = findInventoryHeader(nextSheets[index].data);
    setSheetIndex(index); setHeaderRow(header);
    setMapping(mapInventoryColumns(nextSheets[index].data[header] ?? []));
    setError("");
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    setReading(true); setError(""); setSheets([]); setFileName(file.name);
    try {
      const nextSheets = await readInventoryWorkbook(file);
      const preferred = nextSheets.findIndex(sheet => {
        const mapped = mapInventoryColumns(sheet.data[findInventoryHeader(sheet.data)] ?? []);
        return mapped.name >= 0 && mapped.quantity >= 0;
      });
      setSheets(nextSheets); selectSheet(nextSheets, Math.max(0, preferred));
    } catch (e) {
      setError(e instanceof Error && /Choose|Save older|workbook|worksheets/.test(e.message) ? e.message : "Could not read this Excel file. Choose an unprotected .xlsx workbook and try again.");
    } finally { setReading(false); if (input.current) input.current.value = ""; }
  }
  async function submit() {
    if (busy || previewError || invalid.length || !additions.length) return;
    setSaving(true); setError("");
    try { await onImport(additions.map(row => row.item!)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not import the inventory. Please try again."); }
    finally { setSaving(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={e => {if (e.target === e.currentTarget && !busy) onClose();}}>
    <section className="dialog inventory-import-dialog" role="dialog" aria-modal="true" aria-labelledby="inventory-import-title">
      <div className="dialog-heading"><div><span className="dialog-kicker">Pantry inventory</span><h2 id="inventory-import-title">Import from Excel</h2></div><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Close import"><X size={18}/></button></div>
      <p className="import-intro">Choose a workbook, check its columns, then add the items to your pantry.</p>
      <div className="import-file-picker"><span className="import-file-icon"><FileSpreadsheet size={23}/></span><div><strong>{fileName || "Choose an Excel workbook"}</strong><span>.xlsx · Up to 5 MB · 500 items per import</span></div><button type="button" className="outline-button" disabled={busy} onClick={() => input.current?.click()}>{reading ? <><LoaderCircle size={14} className="spin"/>Reading…</> : <><Upload size={14}/>{fileName ? "Choose another file" : "Choose file"}</>}</button><input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Excel workbook" disabled={busy} onChange={e => void chooseFile(e.target.files?.[0])}/></div>
      {!sheet && !reading && <div className="import-start-help"><p>Use columns for <strong>Item, Quantity, Unit and Restock at</strong>. Restock level is optional. Existing Excel inventory exports also work.</p><button type="button" className="text-action" onClick={() => exportInventoryToExcel([], true)}><FileSpreadsheet size={14}/>Download template</button></div>}
      {sheet && <>
        <div className="import-sheet-controls"><label className="field"><span>Worksheet</span><select value={sheetIndex} disabled={busy} onChange={e => selectSheet(sheets, Number(e.target.value))}>{sheets.map((sheet, index) => <option key={index} value={index}>{sheet.sheet}</option>)}</select></label><label className="field"><span>Header row</span><select value={headerRow} disabled={busy} onChange={e => {const row = Number(e.target.value); setHeaderRow(row); setMapping(mapInventoryColumns(sheet.data[row] ?? [])); setError("");}}>{sheet.data.slice(0, 20).map((_, index) => <option key={index} value={index}>Row {index + 1}</option>)}</select></label></div>
        <div className="import-column-mapping"><h3>Match your columns</h3><div>{importFields.map(({key,label}) => <label className="field" key={key}><span>{label}{(key === "name" || key === "quantity") && " *"}</span><select value={mapping[key]} disabled={busy} onChange={e => {setMapping(current => ({...current,[key]:Number(e.target.value)})); setError("");}}><option value={-1}>{key === "unit" ? "Read from quantity" : key === "threshold" ? "Use 0" : "Choose column"}</option>{Array.from({length:columnCount},(_, index) => <option key={index} value={index}>{index + 1}. {String(headers[index] ?? `Column ${index + 1}`)}</option>)}</select></label>)}</div><p>Unit can come from its own column or a quantity such as “12 kg”.</p></div>
        {previewError ? <p className="dialog-error" role="alert">{previewError}</p> : <>
          <div className="import-preview-heading"><h3>Review items</h3><span><Check size={13}/>{additions.length} rows to import{combined.length > 0 && ` · ${combined.length} will combine`}{invalid.length > 0 && ` · ${invalid.length} invalid rows`}</span></div>
          <div className="table-scroll import-preview-table"><table><thead><tr><th>Row</th><th>Item</th><th>Quantity</th><th>Unit</th><th>Restock at</th><th>Result</th></tr></thead><tbody>{preview.map(row => <tr key={row.rowNumber} className={row.errors.length ? "import-invalid-row" : row.mergeReason ? "import-combined-row" : ""}><td>{row.rowNumber}</td><td><strong>{row.item?.name || row.name || "Missing item name"}</strong></td><td>{row.item?.quantity ?? "—"}</td><td>{row.item?.unit ?? "—"}</td><td>{row.item?.threshold ?? "—"}</td><td>{row.errors.length ? <span className="import-row-error">{row.errors.join(" ")}</span> : row.mergeReason ? <span>{row.mergeReason}</span> : <span className="status-pill status-good">Add</span>}</td></tr>)}</tbody></table></div>
          {invalid.length > 0 ? <p className="import-validation-note">Fix the highlighted rows in Excel, then choose the file again.</p> : <p className="import-validation-note">Matching names and units combine into one item. Quantities are added to existing stock and the highest restock level is kept. Importing this file again adds its quantities again.</p>}
        </>}
      </>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="cancel-button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !!previewError || !!invalid.length || !additions.length} onClick={() => void submit()}>{saving ? <><LoaderCircle size={14} className="spin"/>Importing…</> : <><Upload size={14}/>Import {additions.length || ""} {additions.length === 1 ? "item" : "items"}</>}</button></div>
    </section>
  </div>;
}
