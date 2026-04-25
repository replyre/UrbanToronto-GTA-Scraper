import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const API_URL = "https://urbantoronto.ca/release/database-ajx.php";
const BASE_URL = "https://urbantoronto.ca/";
const BATCH_SIZE = 50; // Store 50 paths per file
const PAGE_LIMIT = 50; // API limit per request
const MAX_RETRIES = 5; // Maximum retry attempts
const RETRY_DELAY = 2000; // Initial retry delay in ms
const REQUEST_DELAY = 1000; // Delay between requests in ms

// Statuses to filter - only Pre-Construction or Design state
const ALLOWED_STATUSES = [
  "Pre-Construction"
];

// Optional: stop after collecting this many paths (for sample / smoke runs).
// Pass `--limit=50` on the command line, e.g.
//   node scrape_project_paths.js --limit=50
function parseLimitArg() {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--limit="));
  if (!arg) return null;
  const n = Number(arg.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Build the form body with the exact payload structure
function buildFormBody(start) {
  const timestamp = Date.now();
  return (
    "query=database_project_list" +
    `&start=${encodeURIComponent(String(start))}` +
    `&limit=${encodeURIComponent(String(PAGE_LIMIT))}` +
    "&sort=title" +
    "&order=asc" +
    "&title=" +
    "&status_pre_construction=true" +
    "&status_under_construction=true" +
    "&status_complete=true" +
    "&status_occupied=true" +
    "&status_on_hold=true" +
    "&status_cancelled=true" +
    "&type_residential=true" +
    "&type_seniors_home=true" +
    "&type_student_dorm=true" +
    "&type_hotel=true" +
    "&type_detached_house=true" +
    "&type_townhouse=true" +
    "&type_affordable_rental=true" +
    "&type_market_rate_rental=true" +
    "&type_condo=true" +
    "&type_co_op=true" +
    "&type_freehold=true" +
    "&type_subdivision=true" +
    "&type_unspecified=true" +
    "&type_commercial=true" +
    "&type_office=true" +
    "&type_retail=true" +
    "&type_storage=true" +
    "&type_industrial=true" +
    "&type_institutional=true" +
    "&type_government=true" +
    "&type_health_care=true" +
    "&type_education=true" +
    "&type_community_centre=true" +
    "&type_place_of_worship=true" +
    "&type_sports_facility=true" +
    "&type_transit=true" +
    "&type_public_space_park=true" +
    "&type_other=true" +
    `&timestamp=${encodeURIComponent(String(timestamp))}`
  );
}

// Fetch a page from the API with retry logic
async function fetchPage(start, retryCount = 0) {
  const body = buildFormBody(start);

  try {
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout after 30 seconds")), 30000);
    });

    // Race between fetch and timeout
    const res = await Promise.race([
      fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://urbantoronto.ca/database/projects",
          Origin: "https://urbantoronto.ca",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36"
        },
        body
      }),
      timeoutPromise
    ]);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from database-ajx.php`);
    }

    const json = await res.json();
    return json;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY * Math.pow(2, retryCount); // Exponential backoff
      console.log(`  ⚠ Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms delay...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchPage(start, retryCount + 1);
    }
    throw error;
  }
}

// Save paths to a file (batch file)
function saveBatchFile(batchNumber, paths) {
  const filename = `project_paths_batch_${String(batchNumber).padStart(4, "0")}.txt`;
  const filepath = path.resolve(filename);
  const content = paths.map(p => BASE_URL + p).join("\n") + "\n";
  fs.writeFileSync(filepath, content, "utf8");
  return filepath;
}

// Find the last batch file to resume from
function findLastBatchFile() {
  const files = fs.readdirSync(".")
    .filter(f => f.startsWith("project_paths_batch_") && f.endsWith(".txt"))
    .sort();
  
  if (files.length === 0) {
    return { batchNumber: 1, startOffset: 0, totalPaths: 0 };
  }

  const lastFile = files[files.length - 1];
  const match = lastFile.match(/project_paths_batch_(\d+)\.txt/);
  const batchNumber = match ? parseInt(match[1]) : 1;
  
  // Count total paths from all existing batch files
  let totalPaths = 0;
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.trim().split("\n").filter(line => line.length > 0);
    totalPaths += lines.length;
  }

  // Calculate start offset (approximate - we'll continue from where we left off)
  const startOffset = totalPaths;
  
  return { batchNumber: batchNumber + 1, startOffset, totalPaths };
}

// Main function
async function main() {
  console.log("Starting UrbanToronto project path scraper...");
  console.log(`Filtering by statuses: ${ALLOWED_STATUSES.join(", ")}`);
  console.log(`Storing ${BATCH_SIZE} paths per file`);

  const pathLimit = parseLimitArg();
  if (pathLimit) {
    console.log(`Limit applied: stopping after ${pathLimit} matching paths`);
  }
  console.log("");

  // Check for existing batch files to resume
  const resumeInfo = findLastBatchFile();
  let start = resumeInfo.startOffset;
  let batchFileNumber = resumeInfo.batchNumber;
  
  if (resumeInfo.totalPaths > 0) {
    console.log(`📂 Found existing batch files. Resuming from batch ${batchFileNumber}`);
    console.log(`   Starting API offset: ${start} (${resumeInfo.totalPaths} paths already collected)\n`);
  }

  const allPaths = [];
  let pageIndex = Math.floor(start / PAGE_LIMIT);
  let currentBatch = [];
  let consecutiveEmptyBatches = 0;

  while (true) {
    console.log(`\n[Page ${pageIndex}] Fetching batch (start=${start}, limit=${PAGE_LIMIT})...`);
    
    let data;
    try {
      data = await fetchPage(start);
    } catch (err) {
      console.error(`❌ Error fetching batch at start=${start}: ${err.message}`);
      console.error(`   Saving current batch and stopping...`);
      // Save current batch if any
      if (currentBatch.length > 0) {
        const filepath = saveBatchFile(batchFileNumber, currentBatch);
        console.log(`✓ Saved batch ${batchFileNumber} with ${currentBatch.length} paths to ${filepath}`);
      }
      break;
    }

    // Check if we have content
    if (!data || !data.content || !Array.isArray(data.content)) {
      console.log("⚠ No content in response or invalid format.");
      consecutiveEmptyBatches++;
      
      if (consecutiveEmptyBatches >= 3) {
        console.log("   Got 3 consecutive empty batches. Stopping.");
        break;
      }
      
      start += PAGE_LIMIT;
      pageIndex++;
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      continue;
    }

    const projects = data.content;
    console.log(`   Received ${projects.length} projects in this batch`);
    
    // Reset empty batch counter if we got data
    if (projects.length > 0) {
      consecutiveEmptyBatches = 0;
    }

    // Filter by status and extract paths
    const filteredPaths = projects
      .filter(project => {
        const status = project.status || "";
        return ALLOWED_STATUSES.includes(status);
      })
      .map(project => project.path || "")
      .filter(path => path.length > 0);

    console.log(`   Filtered to ${filteredPaths.length} paths matching status criteria`);

    // Add to current batch
    let limitReached = false;
    for (const projectPath of filteredPaths) {
      currentBatch.push(projectPath);
      allPaths.push(projectPath);

      // Save batch when it reaches BATCH_SIZE
      if (currentBatch.length >= BATCH_SIZE) {
        const filepath = saveBatchFile(batchFileNumber, currentBatch);
        console.log(`   ✓ Saved batch ${batchFileNumber} with ${currentBatch.length} paths`);
        currentBatch = [];
        batchFileNumber++;
      }

      if (pathLimit && allPaths.length >= pathLimit) {
        limitReached = true;
        break;
      }
    }

    if (limitReached) {
      console.log(`\n✓ Reached --limit=${pathLimit}; stopping early.`);
      if (currentBatch.length > 0) {
        const filepath = saveBatchFile(batchFileNumber, currentBatch);
        console.log(`✓ Saved final batch ${batchFileNumber} with ${currentBatch.length} paths to ${filepath}`);
      }
      break;
    }

    // Check if we should continue
    // Only stop if we get an empty array AND complete flag is true
    if (projects.length === 0 && data.complete === true) {
      console.log("\n✓ Reached end of data (empty response with complete=true).");
      // Save remaining batch if any
      if (currentBatch.length > 0) {
        const filepath = saveBatchFile(batchFileNumber, currentBatch);
        console.log(`✓ Saved final batch ${batchFileNumber} with ${currentBatch.length} paths to ${filepath}`);
      }
      break;
    }

    // If we got fewer items than the limit, we might be at the end
    // But continue anyway to make sure (sometimes API returns partial batches)
    if (projects.length === 0) {
      consecutiveEmptyBatches++;
      if (consecutiveEmptyBatches >= 3) {
        console.log("\n✓ Got 3 consecutive empty batches. Assuming end of data.");
        break;
      }
    }

    start += PAGE_LIMIT;
    pageIndex++;

    // Add delay to be respectful to the server and handle slow responses
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
  }

  // Save remaining batch if any
  if (currentBatch.length > 0) {
    const filepath = saveBatchFile(batchFileNumber, currentBatch);
    console.log(`\n✓ Saved final batch ${batchFileNumber} with ${currentBatch.length} paths to ${filepath}`);
  }

  // Load all existing paths from batch files and combine with new ones
  const existingFiles = fs.readdirSync(".")
    .filter(f => f.startsWith("project_paths_batch_") && f.endsWith(".txt"))
    .sort();
  
  const allExistingPaths = new Set();
  for (const file of existingFiles) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.trim().split("\n").filter(line => line.length > 0);
    for (const line of lines) {
      // Extract path from full URL
      const pathMatch = line.replace(BASE_URL, "");
      if (pathMatch) {
        allExistingPaths.add(pathMatch);
      }
    }
  }
  
  // Add newly collected paths
  for (const p of allPaths) {
    allExistingPaths.add(p);
  }

  // Save a summary file with all paths
  const summaryFile = path.resolve("project_paths_all.txt");
  const allLinks = Array.from(allExistingPaths).map(p => BASE_URL + p).join("\n") + "\n";
  fs.writeFileSync(summaryFile, allLinks, "utf8");

  console.log(`\n=== Summary ===`);
  console.log(`New paths collected this run: ${allPaths.length}`);
  console.log(`Total unique paths (all batches): ${allExistingPaths.size}`);
  console.log(`Batch files created: ${batchFileNumber - 1}`);
  console.log(`All paths saved to: ${summaryFile}`);
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

