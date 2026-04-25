import fs from "fs";
import path from "path";

const INPUT_FILE = path.resolve("project_details.csv");
const OUTPUT_FILE = path.resolve("project_details_gta_180.csv");
const MAX_PROJECTS = 180;

// Simple CSV parser that supports:
// - Comma-separated values
// - Double-quoted fields
// - Commas and quotes inside quoted fields (quotes doubled as "")
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
        // Escaped quote ("")
        field += '"';
        i++; // skip next
      } else if (char === '"') {
        // End of quoted field
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
        // ignore, handle on \n
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

  // Handle last field/row if file does not end with newline
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

  console.log(`Reading input CSV from: ${INPUT_FILE}`);
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

  if (!("In GTA" in headerIndex)) {
    console.error('CSV does not contain expected "In GTA" column.');
    process.exit(1);
  }

  console.log(`Total rows (excluding header): ${dataRows.length}`);

  // Filter rows where In GTA == Yes (case-insensitive, trimming spaces)
  const gtaRows = dataRows.filter((row) => {
    const val = (row[headerIndex["In GTA"]] || "").trim().toLowerCase();
    return val === "yes";
  });

  console.log(`Rows with In GTA = Yes: ${gtaRows.length}`);

  const selected = gtaRows.slice(0, MAX_PROJECTS);
  console.log(`Selecting first ${selected.length} GTA projects.`);

  // Write output CSV
  const outLines = [];
  outLines.push(toCsvLine(headers)); // header

  for (const row of selected) {
    outLines.push(toCsvLine(row));
  }

  fs.writeFileSync(OUTPUT_FILE, outLines.join(""), "utf8");
  console.log(`Saved ${selected.length} GTA projects to: ${OUTPUT_FILE}`);
}

main();



