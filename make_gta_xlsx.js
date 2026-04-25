import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { isHighPriorityArchitect } from "./high_priority_architects.js";

const INPUT_CSV = path.resolve("project_details_gta_180.csv");
const OUTPUT_XLSX = path.resolve("project_details_gta_180.xlsx");

// Simple CSV parser that handles quoted fields and commas
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\r") {
        continue;
      } else if (char === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else {
        field += char;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

async function main() {
  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`Input CSV not found: ${INPUT_CSV}`);
    process.exit(1);
  }

  console.log(`Reading GTA CSV: ${INPUT_CSV}`);
  const raw = fs.readFileSync(INPUT_CSV, "utf8");
  const rows = parseCsv(raw);
  if (!rows.length) {
    console.error("CSV appears to be empty.");
    process.exit(1);
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const headerIndex = {};
  headers.forEach((h, idx) => {
    headerIndex[h.trim()] = idx;
  });

  const colIdx = {
    projectUrl: headerIndex["Project URL"],
    projectName: headerIndex["Project Name"],
    status: headerIndex["Construction Status"],
    architect: headerIndex["Design Architect Firm"],
    engineers: headerIndex["Engineering Firm(s)"],
    developer: headerIndex["Developer"],
    address: headerIndex["Address"],
    inGta: headerIndex["In GTA"],
    imageUrl: headerIndex["Image URL"],
    shortNote: headerIndex["Short Note"]
  };

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("GTA Projects");

  // Add header row
  sheet.addRow(headers);

  // Add data rows
  dataRows.forEach((r) => sheet.addRow(r));

  // Basic column widths
  const widths = {
    "Project URL": 40,
    "Project Name": 35,
    "Construction Status": 18,
    "Design Architect Firm": 28,
    "Engineering Firm(s)": 35,
    Developer: 28,
    Address: 35,
    "In GTA": 8,
    "Image URL": 40,
    "Short Note": 14
  };

  sheet.columns.forEach((col, idx) => {
    const header = headers[idx];
    if (widths[header]) {
      col.width = widths[header];
    }
  });

  // Header style: bold + fill
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E5E5" }
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCCCCCC" } },
      left: { style: "thin", color: { argb: "FFCCCCCC" } },
      bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
      right: { style: "thin", color: { argb: "FFCCCCCC" } }
    };
  });

  // Bold entire Design Architect Firm column
  const architectColIndex = colIdx.architect + 1; // ExcelJS is 1-based
  if (architectColIndex > 0) {
    sheet.getColumn(architectColIndex).eachCell((cell, rowNumber) => {
      if (rowNumber === 1) return; // header already styled
      cell.font = { ...(cell.font || {}), bold: true };
    });
  }

  // Highlight key architects and high priority rows
  const firstDataRow = 2;
  const lastRow = sheet.lastRow.number;
  let highlightedArchitectCount = 0;
  let highlightedPriorityCount = 0;

  for (let r = firstDataRow; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const architectCell = architectColIndex ? row.getCell(architectColIndex) : null;
    const shortNoteCell =
      colIdx.shortNote != null ? row.getCell(colIdx.shortNote + 1) : null;

    const architectVal = architectCell ? (architectCell.value || "").toString() : "";
    const shortNoteVal = shortNoteCell ? (shortNoteCell.value || "").toString() : "";

    const isArchPriority = isHighPriorityArchitect(architectVal);
    const isHighPriorityNote = shortNoteVal.trim().toLowerCase() === "high priority";

    // Highlight architect cells for key firms
    if (architectCell && isArchPriority) {
      architectCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFF00" } // yellow
      };
      architectCell.font = { ...(architectCell.font || {}), color: { argb: "FF000000" } };
      highlightedArchitectCount++;
    }

    // Highlight entire row if HIGH PRIORITY
    if (isHighPriorityNote || isArchPriority) {
      row.eachCell((cell) => {
        cell.fill = cell.fill || {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFE5E5" } // very light red
        };
      });
      if (shortNoteCell && !shortNoteVal) {
        shortNoteCell.value = "high priority";
      }
      highlightedPriorityCount++;
    }
  }

  // Freeze header row and add filter for review
  sheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  console.log(
    `Highlighted ${highlightedArchitectCount} architect cells and ${highlightedPriorityCount} HIGH PRIORITY rows.`
  );

  console.log(`Writing formatted XLSX to: ${OUTPUT_XLSX}`);
  await workbook.xlsx.writeFile(OUTPUT_XLSX);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error in make_gta_xlsx:", err);
  process.exit(1);
});


