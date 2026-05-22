const defaults = require("../config/defaults");

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildCell(value) {
  const isNumber = typeof value === "number" && Number.isFinite(value);
  const cellType = isNumber ? "Number" : "String";
  return `<Cell><Data ss:Type="${cellType}">${escapeXml(value)}</Data></Cell>`;
}

function generateInventoryExcel(items) {
  const headers = [
    "Inventory Number",
    "Item",
    "Branch",
    "Department",
    "Category",
    "Subcategory",
    "Barcode",
    "RFID",
    "Qty On Hand",
    "Min Level",
    "Reorder Level",
    "Unit Cost (KSH)",
    "Value (KSH)",
    "Status",
  ];

  const headerRow = `<Row>${headers.map(buildCell).join("")}</Row>`;
  const dataRows = items
    .map((item) => {
      const value = item.quantityOnHand * item.unitCost;
      return `<Row>${[
        item.inventoryNumber,
        item.name,
        item.branch?.name || "",
        item.department?.name || "",
        item.category?.name || "",
        item.subcategory?.name || "",
        item.barcode || "",
        item.rfidTag || "",
        item.quantityOnHand,
        item.minimumLevel,
        item.reorderLevel,
        item.unitCost,
        value,
        item.status,
      ]
        .map(buildCell)
        .join("")}</Row>`;
    })
    .join("");

  const xml =
    `<?xml version="1.0"?>` +
    `<?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="Inventory"><Table>${headerRow}${dataRows}</Table></Worksheet>` +
    `</Workbook>`;

  return Buffer.from(xml, "utf8");
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function buildPdfContent(lines) {
  const startY = 760;
  const left = 40;
  const lineHeight = 14;
  let y = startY;
  let content = "BT\n/F1 10 Tf\n";

  lines.forEach((line) => {
    content += `1 0 0 1 ${left} ${y} Tm (${escapePdfText(line)}) Tj\n`;
    y -= lineHeight;
  });

  content += "ET";
  return content;
}

function assemblePdf(objects) {
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf, "utf8");
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

function generateInventoryPdf(items) {
  const lines = [
    `${defaults.companyName} Inventory Report`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Inventory No | Item | Branch | Qty | Reorder | Status",
  ];

  items.forEach((item) => {
    lines.push(
      [
        item.inventoryNumber,
        item.name,
        item.branch?.name || "",
        item.quantityOnHand,
        item.reorderLevel,
        item.status,
      ].join(" | ")
    );
  });

  const pageChunks = [];
  for (let index = 0; index < lines.length; index += 45) {
    pageChunks.push(lines.slice(index, index + 45));
  }

  const fontObjectNumber = pageChunks.length * 2 + 3;
  const objects = new Array(fontObjectNumber + 1);
  const pageReferences = [];

  pageChunks.forEach((chunk, chunkIndex) => {
    const pageObjectNumber = chunkIndex * 2 + 3;
    const contentObjectNumber = chunkIndex * 2 + 4;
    const content = buildPdfContent(chunk);

    pageReferences.push(`${pageObjectNumber} 0 R`);
    objects[pageObjectNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> ` +
      `/Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber] =
      `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`;
  });

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageReferences.join(
    " "
  )}] /Count ${pageReferences.length} >>`;
  objects[fontObjectNumber] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  return assemblePdf(objects);
}

module.exports = {
  generateInventoryExcel,
  generateInventoryPdf,
};
