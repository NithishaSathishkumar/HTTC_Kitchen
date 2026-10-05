export type ExportInventoryItem = {
  name: string;
  quantity: number;
  unit: string;
  threshold: number;
};

const encoder = new TextEncoder();
const xmlEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const xml = (value: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`;

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; content: string }[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50); u16(localView, 4, 20); u16(localView, 6, 0x0800);
    u16(localView, 8, 0); u32(localView, 14, crc); u32(localView, 18, data.length); u32(localView, 22, data.length);
    u16(localView, 26, name.length); local.set(name, 30); local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    u32(centralView, 0, 0x02014b50); u16(centralView, 4, 20); u16(centralView, 6, 20); u16(centralView, 8, 0x0800);
    u16(centralView, 10, 0); u32(centralView, 16, crc); u32(centralView, 20, data.length); u32(centralView, 24, data.length);
    u16(centralView, 28, name.length); u32(centralView, 42, offset); central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50); u16(endView, 8, files.length); u16(endView, 10, files.length);
  u32(endView, 12, centralSize); u32(endView, 16, offset);
  return new Blob([...localParts, ...centralParts, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const columns = ["Item", "In stock", "Restock at", "Status"];
const rowsFor = (items: ExportInventoryItem[]) => items.map(item => [
  item.name, `${item.quantity} ${item.unit}`, `${item.threshold} ${item.unit}`,
  item.quantity <= item.threshold ? "Restock soon" : "In stock",
]);

export function exportInventoryToExcel(items: ExportInventoryItem[], template = false) {
  const rows = template ? [["Item", "Quantity", "Unit", "Restock at"]] : [columns, ...rowsFor(items)];
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const files = [
    { name: "[Content_Types].xml", content: xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: "_rels/.rels", content: xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", content: xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pantry Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", content: xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", content: xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="4" width="22" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:D${rows.length}"/></worksheet>`) },
  ];
  const blob = zipStore(files);
  download(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), template ? "kitchen-inventory-template.xlsx" : `kitchen-inventory-${dateStamp()}.xlsx`);
}

export function exportInventoryToWord(items: ExportInventoryItem[]) {
  const tableRows = [columns, ...rowsFor(items)].map((row, index) => `<w:tr>${row.map(cell => `<w:tc><w:tcPr><w:tcW w:w="2100" w:type="dxa"/>${index === 0 ? "<w:shd w:fill=\"EAF1EB\"/>" : ""}</w:tcPr><w:p><w:r>${index === 0 ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlEscape(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("");
  const documentXml = xml(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>HTTC Kitchen Pantry Inventory</w:t></w:r></w:p><w:p><w:r><w:t>Exported ${dateStamp()} · ${items.length} ${items.length === 1 ? "item" : "items"}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="DDE5DE"/><w:left w:val="single" w:sz="4" w:color="DDE5DE"/><w:bottom w:val="single" w:sz="4" w:color="DDE5DE"/><w:right w:val="single" w:sz="4" w:color="DDE5DE"/><w:insideH w:val="single" w:sz="4" w:color="DDE5DE"/><w:insideV w:val="single" w:sz="4" w:color="DDE5DE"/></w:tblBorders></w:tblPr><w:tblGrid>${columns.map(() => `<w:gridCol w:w="2100"/>`).join("")}</w:tblGrid>${tableRows}</w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1000" w:right="900" w:bottom="1000" w:left="900"/></w:sectPr></w:body></w:document>`);
  const files = [
    { name: "[Content_Types].xml", content: xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: "_rels/.rels", content: xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: "word/document.xml", content: documentXml },
  ];
  const blob = zipStore(files);
  download(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `kitchen-inventory-${dateStamp()}.docx`);
}
