import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import * as cheerio from "cheerio";

const BATCH_FILES_PATTERN = "project_paths_batch_*.txt";
const OUTPUT_FILE = path.resolve("project_details.csv");
const SKIPPED_LOG = path.resolve("project_details_skipped.log");
const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds
const PAGE_LOAD_TIMEOUT = 60000; // 60 seconds

// Optional: limit how many URLs are scraped (for sample / smoke runs).
// Pass `--limit=20` on the command line, e.g.
//   node scrape_project_details.js --limit=20
function parseLimitArg() {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--limit="));
  if (!arg) return null;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// High priority keywords to check in description
const HIGH_PRIORITY_KEYWORDS = {
  tall: ["high-rise", "highrise", "high rise", "tall", "tower", "skyscraper", "supertall", "storeys", "storey"],
  curtainWall: ["curtain wall", "unitized curtain wall", "curtainwall", "unitized"],
  complexPremium: ["premium", "luxury", "complex", "sophisticated", "world-renowned", "acclaimed", "iconic", "signature"]
};

// GTA (Greater Toronto Area) cities and municipalities
const GTA_CITIES = [
  "toronto",
  "mississauga",
  "brampton",
  "markham",
  "vaughan",
  "richmond hill",
  "oakville",
  "burlington",
  "ajax",
  "pickering",
  "whitby",
  "oshawa",
  "milton",
  "halton hills",
  "georgina",
  "aurora",
  "newmarket",
  "east gwillimbury",
  "bradford west gwillimbury",
  "innisfil",
  "barrie" // Sometimes considered part of GTA
];

// Check if address is in GTA
function isInGTA(address) {
  if (!address) return false;
  const addressLower = address.toLowerCase();
  return GTA_CITIES.some(city => addressLower.includes(city));
}

// Check if description indicates high priority
function isHighPriority(description, height, storeys) {
  if (!description) return false;
  
  const descLower = description.toLowerCase();
  const heightLower = (height || "").toLowerCase();
  const storeysLower = (storeys || "").toLowerCase();
  const combinedText = `${descLower} ${heightLower} ${storeysLower}`;
  
  // Check for tall building indicators
  const isTall = HIGH_PRIORITY_KEYWORDS.tall.some(keyword => 
    combinedText.includes(keyword)
  );
  
  // Check for curtain wall indicators
  const hasCurtainWall = HIGH_PRIORITY_KEYWORDS.curtainWall.some(keyword =>
    combinedText.includes(keyword)
  );
  
  // Check for complex/premium indicators
  const isComplexPremium = HIGH_PRIORITY_KEYWORDS.complexPremium.some(keyword =>
    combinedText.includes(keyword)
  );
  
  // Also check storeys count - if 20+ storeys, likely high-rise
  const storeysMatch = storeysLower.match(/(\d+)\s*storey/i);
  const storeysCount = storeysMatch ? parseInt(storeysMatch[1]) : 0;
  const isHighRiseByCount = storeysCount >= 20;
  
  // High priority if at least 2 of these conditions are met, or if it's clearly a high-rise
  const conditionsMet = [isTall, hasCurtainWall, isComplexPremium, isHighRiseByCount].filter(Boolean).length;
  
  return conditionsMet >= 2 || isHighRiseByCount;
}

// Extract value by heading (like "Construction Status", "Engineering", etc.)
function extractProjectDetailByHeading($, headingExactText) {
  const needle = headingExactText.toLowerCase();
  const td = $("td")
    .filter((_, el) => {
      const heading = $(el).find("span.heading").first().text().trim().toLowerCase();
      return heading === needle;
    })
    .first();

  if (!td.length) return null;

  const val = td.find("span.project-details").first().text().trim();
  return val ? val.replace(/\s+/g, " ") : null;
}

// Extract company links (for Architect, Developer, Engineering)
function extractCompanyLinks($, headingText) {
  const needle = headingText.toLowerCase();
  const td = $("td")
    .filter((_, el) => {
      const heading = $(el).find("span.heading").first().text().trim().toLowerCase();
      return heading === needle;
    })
    .first();

  if (!td.length) return { names: [], urls: [] };

  const links = td
    .find("span.project-details a")
    .toArray()
    .map((a) => {
      const name = $(a).text().trim().replace(/\s+/g, " ");
      let href = $(a).attr("href") || "";
      if (href && !href.startsWith("http")) {
        try {
          href = new URL(href, "https://urbantoronto.ca").href;
        } catch {
          // keep original href if URL construction fails
        }
      }
      return { name, url: href };
    });

  // Also check for text without links
  const textContent = td.find("span.project-details").first().text().trim();
  if (textContent && links.length === 0) {
    // Split by comma and clean up
    const names = textContent.split(",").map(n => n.trim()).filter(n => n);
    return { names, urls: [] };
  }

  return {
    names: links.map((l) => l.name),
    urls: links.map((l) => l.url)
  };
}

// Extract full project description/bio
function extractProjectDescription($) {
  const bio = $(".project-bio").first().text().trim();
  return bio ? bio.replace(/\s+/g, " ") : "";
}

// Extract project image URL
function extractProjectImage($) {
  // Try og:image meta tag first (most reliable)
  let imageUrl = $('meta[property="og:image"]').attr("content");
  if (imageUrl) return imageUrl.trim();

  // Try project-image class
  imageUrl = $(".project-image").attr("src") || $("img.project-image").attr("src");
  if (imageUrl) return imageUrl.trim();

  // Try first rendering preview
  imageUrl = $("#rendering_preview").attr("src");
  if (imageUrl) return imageUrl.trim();

  // Try first image in renderings array (from script tag)
  const scriptContent = $("script").toArray()
    .map(script => $(script).html())
    .join(" ");
  
  const renderingMatch = scriptContent.match(/var renderings\s*=\s*\[([^\]]+)\]/);
  if (renderingMatch) {
    try {
      // Try to extract first image URL from renderings array
      const firstImageMatch = renderingMatch[1].match(/"image"\s*:\s*"([^"]+)"/);
      if (firstImageMatch) {
        return firstImageMatch[1].replace(/\\\//g, "/");
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }

  return "";
}

// Read all batch files and collect URLs
function readAllProjectUrls() {
  const files = fs.readdirSync(".")
    .filter(f => f.startsWith("project_paths_batch_") && f.endsWith(".txt"))
    .sort();
  
  const allUrls = new Set();
  
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.trim().split("\n").filter(line => line.trim().length > 0);
    for (const line of lines) {
      allUrls.add(line.trim());
    }
  }
  
  return Array.from(allUrls);
}

// Ensure CSV header exists
function ensureCsvHeader(filepath) {
  if (fs.existsSync(filepath)) return;
  const headers = [
    "Project URL",
    "Project Name",
    "Construction Status",
    "Design Architect Firm",
    "Engineering Firm(s)",
    "Developer",
    "Address",
    "In GTA",
    "Image URL",
    "Short Note"
  ];
  fs.writeFileSync(filepath, headers.join(",") + "\n", "utf8");
}

// Append CSV row - writes immediately and flushes to disk
function appendCsvRow(row, filepath) {
  const headers = [
    "Project URL",
    "Project Name",
    "Construction Status",
    "Design Architect Firm",
    "Engineering Firm(s)",
    "Developer",
    "Address",
    "In GTA",
    "Image URL",
    "Short Note"
  ];
  const line =
    headers
      .map((key) => {
        const value = (row[key] || "").toString().replace(/"/g, '""');
        return `"${value}"`;
      })
      .join(",") + "\n";
  
  // Write immediately and ensure it's flushed to disk
  const fd = fs.openSync(filepath, "a");
  fs.writeSync(fd, line, null, "utf8");
  fs.fsyncSync(fd); // Force flush to disk
  fs.closeSync(fd);
}

// Scrape a single project page
async function scrapeProjectWithPuppeteer(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: PAGE_LOAD_TIMEOUT });

    // Give the project page extra time for JS content to appear
    await delay(5000);

    // Try to wait for the project title if possible
    try {
      await page.waitForSelector("h1, .page-title", { timeout: 10000 });
    } catch {
      // ignore timeout here; we'll still try to parse whatever HTML we have
    }

    const html = await page.content();
    const $ = cheerio.load(html);

    // Extract Project Name
    let projectName =
      $("h1").first().text().trim() || $(".page-title").first().text().trim();
    if (!projectName) {
      projectName =
        $('meta[property="og:title"]').attr("content") ||
        $("title").first().text().trim() ||
        url;
    }
    // Strip the " | UrbanToronto" suffix that <title> / og:title leaves on the name.
    const name = (projectName || "")
      .replace(/\s*\|\s*UrbanToronto.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    // Extract Construction Status
    const status = extractProjectDetailByHeading($, "Construction Status") || "";
    const statusClean = status.trim().replace(/\s+/g, " ");
    
    // Note: We collect all projects, but focus on Pre-Construction or In Design status
    // The batch files should already contain Pre-Construction projects

    // Extract Design Architect Firm
    const architectInfo = extractCompanyLinks($, "architect");
    const architectNames = architectInfo.names.join(" | ");

    // Extract Engineering Firm(s)
    const engineeringInfo = extractCompanyLinks($, "engineering");
    const engineeringNames = engineeringInfo.names.join(" | ");

    // Extract Developer
    const developerInfo = extractCompanyLinks($, "developer");
    const developerNames = developerInfo.names.join(" | ");

    // Extract Address
    const address = extractProjectDetailByHeading($, "Address") || "";
    const addressClean = address.trim().replace(/\s+/g, " ");

    // Check if in GTA
    const inGTA = isInGTA(addressClean) ? "Yes" : "No";

    // Extract Image URL
    const imageUrl = extractProjectImage($);

    // Extract description for high priority check
    const description = extractProjectDescription($);
    const height = extractProjectDetailByHeading($, "Height") || "";
    const storeys = extractProjectDetailByHeading($, "Storeys") || "";

    // Check if high priority
    const isHighPriorityProject = isHighPriority(description, height, storeys);
    const shortNote = isHighPriorityProject ? "high priority" : "";

    return {
      data: {
        "Project URL": url,
        "Project Name": name,
        "Construction Status": statusClean,
        "Design Architect Firm": architectNames,
        "Engineering Firm(s)": engineeringNames,
        "Developer": developerNames,
        "Address": addressClean,
        "In GTA": inGTA,
        "Image URL": imageUrl,
        "Short Note": shortNote
      }
    };
  } catch (err) {
    return { skip: `Error scraping: ${err.message}` };
  }
}

// Main function
async function main() {
  console.log("Starting project detail scraper...");
  console.log("Collecting: Project Name, Construction Status, Design Architect, Engineering Firm(s), Developer");
  console.log("Marking high priority projects based on description keywords\n");

  // Read all project URLs from batch files
  let urls = readAllProjectUrls();
  console.log(`Found ${urls.length} project URLs from batch files`);

  // Apply --limit=N if provided
  const limit = parseLimitArg();
  if (limit && urls.length > limit) {
    urls = urls.slice(0, limit);
    console.log(`Limit applied: scraping first ${urls.length} URLs only`);
  }
  console.log("");

  if (urls.length === 0) {
    console.log("No project URLs found. Make sure batch files exist.");
    return;
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(PAGE_LOAD_TIMEOUT);

  // Ensure CSV has header
  ensureCsvHeader(OUTPUT_FILE);

  const skipped = [];
  const seen = new Set(); // Deduplicate by URL

  try {
    for (const [index, url] of urls.entries()) {
      // Skip if already processed
      if (seen.has(url)) {
        console.log(`[${index + 1}/${urls.length}] Skipping duplicate: ${url}`);
        continue;
      }
      seen.add(url);

      console.log(`\n[${index + 1}/${urls.length}] Scraping: ${url}`);

      let data, skip;
      for (let attempt = 0; attempt < 3; attempt++) {
        ({ data, skip } = await scrapeProjectWithPuppeteer(page, url));
        if (!skip || !/Error scraping/.test(skip)) break;
        console.warn(`  Retrying (attempt ${attempt + 2}/3)...`);
        await delay(3000);
      }

      if (data) {
        appendCsvRow(data, OUTPUT_FILE);
        const priorityNote = data["Short Note"] ? " [HIGH PRIORITY]" : "";
        console.log(`  ✓ Written to CSV: ${data["Project Name"]}${priorityNote}`);
      } else if (skip) {
        skipped.push({ url, reason: skip });
        console.warn(`  ⚠ Skipped: ${skip}`);
      }

      // Delay between requests
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  } finally {
    console.log("\nClosing browser...");
    await browser.close();
  }

  // Log skipped projects
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} projects:`);
    skipped.forEach((s) => console.log(`  - ${s.reason}: ${s.url}`));
    
    const skippedLines = skipped.map(
      (s) => `${new Date().toISOString()} | ${s.reason} | ${s.url}`
    );
    fs.appendFileSync(SKIPPED_LOG, skippedLines.join("\n") + "\n", "utf8");
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total URLs processed: ${urls.length}`);
  console.log(`Successfully scraped: ${urls.length - skipped.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Output saved to: ${OUTPUT_FILE}`);
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

