// Internal helper — renders project_details_gta_180.xlsx as a PNG that
// visually matches the styled Excel output. Used for README screenshots
// and marketing assets. Not part of the user-facing pipeline.
//
// Usage: node scripts/generate_screenshot.js

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import ExcelJS from "exceljs";
import { fileURLToPath } from "url";
import { isHighPriorityArchitect } from "../high_priority_architects.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const XLSX_PATH = path.join(ROOT, "project_details_gta_180.xlsx");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const OUT_PATH = path.join(OUT_DIR, "output.png");

function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortenUrl(url) {
  if (!url) return "";
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

async function loadRows() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const sheet = wb.getWorksheet("GTA Projects") || wb.worksheets[0];

  const headers = [];
  const rows = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (c) =>
    headers.push((c.value || "").toString())
  );

  sheet.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const r = {};
    row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
      const key = headers[colIdx - 1];
      r[key] = (cell.value || "").toString();
    });
    rows.push(r);
  });

  return { headers, rows };
}

function buildHtml({ rows }) {
  const display = rows.slice(0, 12);

  const tbody = display
    .map((r) => {
      const archMatch = isHighPriorityArchitect(r["Design Architect Firm"] || "");
      const isPriority =
        archMatch ||
        (r["Short Note"] || "").trim().toLowerCase() === "high priority";

      const rowStyle = isPriority ? "background: #FFE5E5;" : "";
      const archStyle = archMatch
        ? "background: #FFFF00; font-weight: 600;"
        : "font-weight: 600;";

      return `<tr style="${rowStyle}">
        <td class="proj">${escapeHtml(r["Project Name"])}</td>
        <td>${escapeHtml(r["Construction Status"])}</td>
        <td style="${archStyle}">${escapeHtml(r["Design Architect Firm"]) || "<span class='muted'>—</span>"}</td>
        <td>${escapeHtml(r["Developer"]) || "<span class='muted'>—</span>"}</td>
        <td>${escapeHtml(r["Address"])}</td>
        <td class="gta">${escapeHtml(r["In GTA"])}</td>
        <td class="note">${escapeHtml(r["Short Note"])}</td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px;
    background: #f3f4f6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
  }
  .frame {
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
    overflow: hidden;
  }
  .titlebar {
    padding: 14px 22px;
    background: linear-gradient(180deg, #1f7a3f, #166732);
    color: white;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .titlebar .file {
    opacity: 0.92;
  }
  .titlebar .pill {
    font-size: 11px;
    padding: 3px 10px;
    background: rgba(255,255,255,0.18);
    border-radius: 999px;
    letter-spacing: 0.4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th {
    background: #E5E5E5;
    color: #111827;
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid #d1d5db;
    border-right: 1px solid #d1d5db;
    font-weight: 600;
    white-space: nowrap;
  }
  th:last-child { border-right: none; }
  td {
    padding: 9px 12px;
    border-bottom: 1px solid #e5e7eb;
    border-right: 1px solid #e5e7eb;
    vertical-align: top;
    line-height: 1.35;
  }
  td:last-child { border-right: none; }
  td.proj { font-weight: 600; color: #111827; max-width: 220px; }
  td.gta { text-align: center; font-weight: 600; color: #166534; }
  td.note { color: #b91c1c; font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.3px; }
  td .muted, span.muted { color: #9ca3af; font-style: italic; }
  .footer {
    padding: 10px 22px;
    background: #fafafa;
    border-top: 1px solid #e5e7eb;
    font-size: 11px;
    color: #6b7280;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="titlebar">
      <span class="file">project_details_gta_180.xlsx — GTA Projects</span>
      <span class="pill">Sample output</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Project Name</th>
          <th>Status</th>
          <th>Design Architect Firm</th>
          <th>Developer</th>
          <th>Address</th>
          <th>In GTA</th>
          <th>Short Note</th>
        </tr>
      </thead>
      <tbody>
        ${tbody}
      </tbody>
    </table>
    <div class="footer">
      <span>Sheet 1 of 1 · ${display.length} of ${rows.length} rows shown</span>
      <span>UrbanToronto GTA Scraper</span>
    </div>
  </div>
</body>
</html>`;
}

async function render(html) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: "new" });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const frame = await page.$(".frame");
    await frame.screenshot({ path: OUT_PATH });

    console.log(`✓ Wrote ${OUT_PATH}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`Missing ${XLSX_PATH}. Run 'npm run sample' first.`);
    process.exit(1);
  }
  const { rows } = await loadRows();
  if (!rows.length) {
    console.error("XLSX has no data rows.");
    process.exit(1);
  }
  const html = buildHtml({ rows });
  await render(html);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
