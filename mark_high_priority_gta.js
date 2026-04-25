import fs from "fs";
import path from "path";
import { isHighPriorityArchitect } from "./high_priority_architects.js";

const INPUT_FILE = path.resolve("project_details_gta_180.csv");
const OUTPUT_FILE = path.resolve("project_details_gta_180.csv");

// Reuse same simple CSV parser logic
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

function toCsvLine(values) {
  return (
    values
      .map((v) => {
        const value = (v ?? "").toString().replace(/"/g, '""');
        return `"${value}"`;
      })
      .join(",") + "\n"
  );
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  console.log(`Reading GTA projects CSV from: ${INPUT_FILE}`);
  const raw = fs.readFileSync(INPUT_FILE, "utf8");

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

  if (!("Design Architect Firm" in headerIndex)) {
    console.error('CSV does not contain expected "Design Architect Firm" column.');
    process.exit(1);
  }
  if (!("Short Note" in headerIndex)) {
    console.error('CSV does not contain expected "Short Note" column.');
    process.exit(1);
  }

  let updatedCount = 0;

  for (const row of dataRows) {
    const architectVal = row[headerIndex["Design Architect Firm"]] || "";
    const isPriority = isHighPriorityArchitect(architectVal);

    if (isPriority) {
      row[headerIndex["Short Note"]] = "high priority";
      updatedCount++;
    }
  }

  console.log(`Marked ${updatedCount} projects as HIGH PRIORITY based on architect firm.`);

  // Write back to same file
  const outLines = [];
  outLines.push(toCsvLine(headers));
  for (const row of dataRows) {
    outLines.push(toCsvLine(row));
  }

  fs.writeFileSync(OUTPUT_FILE, outLines.join(""), "utf8");
  console.log(`Updated file written to: ${OUTPUT_FILE}`);
}

main();



