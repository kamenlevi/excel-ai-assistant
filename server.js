require('dotenv').config();
const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const fetch   = require('node-fetch');
const crypto = require('crypto');
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Supabase client (optional — add SUPABASE_URL + SUPABASE_ANON_KEY to .env) ─
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

// ── SSL cert — use office-addin-dev-certs (trusted by Excel desktop) ──
const DEV_CERTS_DIR = process.env.EXCEL_AI_CERTS_DIR || path.join(process.env.USERPROFILE || process.env.HOME, '.office-addin-dev-certs');
let pems;
try {
  pems = {
    cert:    fs.readFileSync(path.join(DEV_CERTS_DIR, 'localhost.crt'), 'utf8'),
    private: fs.readFileSync(path.join(DEV_CERTS_DIR, 'localhost.key'), 'utf8'),
  };
} catch {
  pems = null; // certs will be provided by startServer(opts) or Electron
}

// ── Data dir for chat persistence ─────────────────────────────────────────────
const DATA_DIR    = process.env.EXCEL_AI_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Per-user data directories — keyed by x-user-id header
const _userCaches = {};
function getUserDir(userId) {
  if (!userId) {
    // No user ID — try to use the first (primary) user's data if one exists
    const usersDir = path.join(DATA_DIR, 'users');
    try {
      const dirs = fs.readdirSync(usersDir);
      if (dirs.length === 1) return path.join(usersDir, dirs[0]);
    } catch {}
    return DATA_DIR;
  }
  const dir = path.join(DATA_DIR, 'users', userId.replace(/[^a-zA-Z0-9@._-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  // Migrate shared data on first access
  if (!_userCaches[userId + ':migrated']) {
    _userCaches[userId + ':migrated'] = true;
    ['chats.json', 'training.json', 'skills.json', 'usage.json'].forEach(f => {
      const shared = path.join(DATA_DIR, f);
      const user = path.join(dir, f);
      if (fs.existsSync(shared) && !fs.existsSync(user)) {
        try { fs.copyFileSync(shared, user); } catch {}
      }
    });
  }
  return dir;
}

function getCache(userId) {
  const key = userId || '__default__';
  if (!_userCaches[key]) _userCaches[key] = {};
  return _userCaches[key];
}

function readJSON(userId, file, fallback) {
  const cache = getCache(userId);
  if (cache[file] !== undefined) return cache[file];
  const fp = path.join(getUserDir(userId), file);
  try { cache[file] = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { cache[file] = fallback; }
  return cache[file];
}
function writeJSON(userId, file, data) {
  const cache = getCache(userId);
  cache[file] = data;
  const fp = path.join(getUserDir(userId), file);
  fs.writeFile(fp, JSON.stringify(data, null, 2), 'utf8', err => {
    if (err) console.error('[' + file + '] write error:', err.message);
  });
}

function readChats(userId)          { return readJSON(userId, 'chats.json', {}); }
function writeChats(userId, data)   { writeJSON(userId, 'chats.json', data); }
function readTraining(userId)       { return readJSON(userId, 'training.json', {}); }
function writeTraining(userId, data){ writeJSON(userId, 'training.json', data); }
function readSkills(userId)         { return readJSON(userId, 'skills.json', []); }
function writeSkills(userId, data)  { writeJSON(userId, 'skills.json', data); }
function readUsage(userId)          { return readJSON(userId, 'usage.json', []); }
function writeUsage(userId, data)   { writeJSON(userId, 'usage.json', data); }

// Extract user ID from request header
function uid(req) { return req.headers['x-user-id'] || null; }

// ── CONFIG ────────────────────────────────────────────────────────────────────
const OLLAMA_HOST    = process.env.OLLAMA_HOST || '127.0.0.1';
const MLX_PORT       = process.env.MLX_PORT    || '8080';
const OLLAMA_PORT    = process.env.OLLAMA_PORT  || '11434';

const USE_OPENROUTER = true;
const USE_MLX        = false;
const USE_GROQ       = false;

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const GROQ_KEY       = process.env.GROQ_KEY;

const DEFAULT_MODEL = USE_OPENROUTER
  ? 'meta-llama/llama-3.3-70b-instruct'
  : USE_MLX
    ? 'mlx-community/Qwen3-32B-4bit'
    : 'qwen3:32b';
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI assistant built directly into Microsoft Excel (Excel Online). You have complete read/write access to the entire workbook.

CRITICAL RULE — HOW YOU MAKE CHANGES:
When the user asks you to do ANYTHING to the spreadsheet, you MUST output a CODE_JS block containing valid Office JavaScript API code. This code runs inside Excel.run(async (context) => { ... }). You have access to "context", "workbook" (which is context.workbook), and the full "Excel" namespace (Excel.FilterOn, Excel.ChartType, Excel.RangeCopyType, etc.).

FORMAT:
CODE_JS::
// your Office JS code here
::END_CODE

RULES FOR YOUR CODE:
- You write the BODY of an async function that receives "context", "workbook", and "Excel"
- Always call "await context.sync();" after loading properties and after making changes
- Use workbook.worksheets.getItem("SheetName") or workbook.worksheets.getActiveWorksheet()
- Always use .load() before reading properties, then await context.sync()
- This runs in Excel Online — only use APIs available in ExcelApi 1.1 through 1.17
- Do NOT use sheet.autoFilter.getColumnFilter() — it does not exist in Excel Online
- PivotTables ARE supported via Office JS (ExcelApi 1.8+) — do NOT use VBA for them. Prefer the createPivotTable() helper below.
- Keep code simple and direct. No unnecessary abstractions.
- NEVER use console.log in your code. Use throw new Error() to surface problems.

HELPER FUNCTIONS — always use these instead of raw Office JS for filtering and sorting:

  applyColumnFilter(columnName, filterValues)
    — filters by column header name, handles everything automatically
    — filterValues can be a single value or array
    — examples: await applyColumnFilter("Status", "Active");
                await applyColumnFilter("Name", ["Rossen", "Ivan"]);

  clearFilters()
    — removes all active filters
    — example: await clearFilters();

  sortByColumn(columnName, ascending)
    — sorts by column header name, ascending=true or false
    — example: await sortByColumn("Date", false);

NEVER write manual autoFilter or sort code when these helpers exist. Just call them.

DATA, STRUCTURE & FORMAT HELPERS — prefer these over hand-written code:

  createPivotTable(sourceRange, rowFields, valueFields, columnFields?)
    — builds a PivotTable on a NEW sheet using Office JS (never VBA)
    — fields are column header names; each of rowFields/valueFields/columnFields may be a string or array
    — omit sourceRange (pass null) to use the active sheet's used range
    — example: await createPivotTable("A1:E500", "Region", ["Sales"], "Quarter");

  createTable(rangeAddress?, hasHeaders=true)
    — converts a range into a native Excel Table (ListObject). Omit rangeAddress to use the whole used range.
    — example: await createTable();   await createTable("A1:D50");

  setNumberFormat(rangeAddress, format)
    — applies a number/date/currency format to every cell in the range
    — examples: await setNumberFormat("B2:B100", "$#,##0.00");
                await setNumberFormat("C2:C100", "0.0%");
                await setNumberFormat("A2:A100", "yyyy-mm-dd");

  dedupeRows(columnNames?)
    — removes duplicate rows on the active sheet, keeping the header. Omit for an all-column match, or pass key column name(s).
    — example: await dedupeRows();   await dedupeRows(["Email"]);

  fillDown(columnName)
    — fills blank cells in a column with the value above (e.g. un-flattens grouped labels)
    — example: await fillDown("Category");

  trimCells(columnName?)
    — trims leading/trailing whitespace. Omit columnName to trim the whole sheet.
    — example: await trimCells("Name");

DELETING AND CLEARING — these are the correct patterns:

User: "delete row 5"
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
sheet.getRange("5:5").delete(Excel.DeleteShiftDirection.up);
await context.sync();
::END_CODE

User: "delete rows where Status is Inactive"
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("values,rowIndex");
await context.sync();
const rows = used.values;
const toDelete = [];
const hdr = rows[0].map(h => String(h).toLowerCase().trim());
const col = hdr.indexOf("status");
if (col === -1) throw new Error("Column 'Status' not found.");
for (let i = rows.length - 1; i >= 1; i--) {
  if (String(rows[i][col]).toLowerCase() === "inactive") toDelete.push(used.rowIndex + i);
}
for (const ri of toDelete) {
  sheet.getRangeByIndexes(ri, 0, 1, rows[0].length).delete(Excel.DeleteShiftDirection.up);
  await context.sync();
}
::END_CODE

User: "clear the contents of B2:D10"
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
sheet.getRange("B2:D10").clear(Excel.ClearApplyTo.contents);
await context.sync();
::END_CODE

User: "delete sheet named OldData"
CODE_JS::
const sheet = workbook.worksheets.getItem("OldData");
sheet.delete();
await context.sync();
::END_CODE

User: "clear all formatting from column C"
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("rowCount");
await context.sync();
sheet.getRange("C1:C" + used.rowCount).clear(Excel.ClearApplyTo.formats);
await context.sync();
::END_CODE

EXAMPLES:

User: "make my header row bold with green background"
Response:
Formatting your header row now.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("columnCount");
await context.sync();
const header = sheet.getRangeByIndexes(0, 0, 1, used.columnCount);
header.format.font.bold = true;
header.format.fill.color = "#217346";
header.format.font.color = "#FFFFFF";
await context.sync();
::END_CODE

User: "filter the Status column to only show Active"
Response:
Filtering Status column for "Active".
CODE_JS::
await applyColumnFilter("Status", "Active");
::END_CODE

User: "show only rows where Name is Rossen or Ivan"
Response:
Filtering Name column for Rossen and Ivan.
CODE_JS::
await applyColumnFilter("Name", ["Rossen", "Ivan"]);
::END_CODE

User: "clear all filters"
Response:
Clearing all filters.
CODE_JS::
await clearFilters();
::END_CODE

User: "sort by Date descending"
Response:
Sorting by Date descending.
CODE_JS::
await sortByColumn("Date", false);
::END_CODE

User: "sort by column C descending"
Response:
Sorting by column C descending.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("values");
await context.sync();
const colName = used.values[0][2]; // column C = index 2
await sortByColumn(colName, false);
::END_CODE

User: "copy columns A-C to column F"
Response:
Copying columns A through C to column F.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const src = sheet.getRange("A:C");
const dst = sheet.getRange("F1");
dst.copyFrom(src, Excel.RangeCopyType.all, false, false);
await context.sync();
::END_CODE

User: "add a chart from A1:B10"
Response:
Creating a chart from your data.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const dataRange = sheet.getRange("A1:B10");
const chart = sheet.charts.add(Excel.ChartType.columnClustered, dataRange, Excel.ChartSeriesBy.auto);
chart.title.text = "Chart";
chart.setPosition("D2", "N20");
await context.sync();
::END_CODE

READING DATA — only use "return" when the user wants to KNOW something from the data (counts, sums, lookups). Do NOT use return for tasks that make changes (formatting, filtering, sorting, formulas). For read queries, return a plain string answer.

User: "how many deposits and what is their total?"
Response:
Let me check the data.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("values");
await context.sync();
const rows = used.values.slice(1);
const deposits = rows.filter(function(r) { return String(r[2]).toLowerCase().includes("deposit"); });
const total = deposits.reduce(function(sum, r) { return sum + (Number(r[3]) || 0); }, 0);
return "Found " + deposits.length + " deposits totalling " + total.toFixed(2) + ".";
::END_CODE

User: "put a SUM formula in B10"
Response:
Adding SUM formula to B10.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
sheet.getRange("B10").formulas = [["=SUM(B2:B9)"]];
await context.sync();
::END_CODE

POWER FEATURES — PivotTables, Tables, cleaning, lookups, formula help:

User: "make a pivot table of sales by region and quarter"
Response:
Building a PivotTable of Sales by Region and Quarter.
CODE_JS::
await createPivotTable(null, "Region", ["Sales"], "Quarter");
::END_CODE

User: "turn my data into a table"
Response:
Converting the data range into an Excel Table.
CODE_JS::
await createTable();
::END_CODE

User: "format column C as currency"
Response:
Formatting column C as currency.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("rowCount");
await context.sync();
await setNumberFormat("C2:C" + used.rowCount, "$#,##0.00");
::END_CODE

User: "remove duplicate rows by email"
Response:
Removing duplicate rows keyed on Email.
CODE_JS::
await dedupeRows(["Email"]);
::END_CODE

User: "fill the blank category cells with the value above and trim spaces"
Response:
Filling down Category and trimming whitespace.
CODE_JS::
await fillDown("Category");
await trimCells();
::END_CODE

User: "split the Full Name column into first and last name"
Response:
Splitting Full Name on the space into two new columns.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("values");
await context.sync();
const rows = used.values;
const hdr = rows[0].map(h => String(h).toLowerCase().trim());
const ci = hdr.indexOf("full name");
if (ci === -1) throw new Error("Column 'Full Name' not found.");
const out = rows.map((r, i) => i === 0 ? ["First Name", "Last Name"] : String(r[ci]).split(" ").length > 1 ? [String(r[ci]).split(" ")[0], String(r[ci]).split(" ").slice(1).join(" ")] : [r[ci], ""]);
// write into two columns just past the used range
sheet.getRangeByIndexes(0, rows[0].length, out.length, 2).values = out;
await context.sync();
::END_CODE

User: "look up each Product's price from the Prices sheet"
Response:
Adding an XLOOKUP against the Prices sheet.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("values,rowCount");
await context.sync();
const hdr = used.values[0].map(h => String(h).toLowerCase().trim());
const pc = hdr.indexOf("product");
if (pc === -1) throw new Error("Column 'Product' not found.");
const col = String.fromCharCode(65 + pc);
const out = ["Price"];
for (let r = 2; r <= used.rowCount; r++) out.push("=XLOOKUP(" + col + r + ",Prices!A:A,Prices!B:B,\\"Not found\\")");
sheet.getRangeByIndexes(0, used.values[0].length, out.length, 1).values = out.map(v => [v]);
await context.sync();
::END_CODE

READING / EXPLAINING / DEBUGGING FORMULAS — for "explain B2" or "why is C5 an error", load the formula and answer in prose (return a string), do not change the sheet unless asked to fix it.

User: "explain the formula in B2"
Response:
Reading the formula in B2.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const c = sheet.getRange("B2");
c.load("formulas,values");
await context.sync();
return "B2 contains " + c.formulas[0][0] + " which currently evaluates to " + c.values[0][0] + ".";
::END_CODE

MULTI-WORKBOOK SUPPORT:
You can work with MULTIPLE workbooks on the user's computer — not just the one currently open. Use these helper functions inside CODE_JS blocks:

  searchWorkbooks(query)
    — finds .xlsx/.xlsm files on the user's computer by filename
    — returns array of {path, name, size, modified}
    — example: const files = await searchWorkbooks("Sales Report");

  searchWorkbooksByContent(query)
    — finds workbooks that CONTAIN specific text in their cells
    — slower than name search — use when user doesn't know the filename
    — returns array of {path, name, size, modified}
    — example: const files = await searchWorkbooksByContent("Q4 Revenue");

  readExternalWorkbook(filePath, sheetNames)
    — reads data from a workbook file WITHOUT opening it in Excel
    — sheetNames is optional array to read specific sheets only
    — returns {file, sheets: [{name, rowCount, rows: [{row, values}]}]}
    — example: const data = await readExternalWorkbook(files[0].path);
    — example: const data = await readExternalWorkbook("C:\\Users\\Me\\report.xlsx", ["Summary"]);

  writeExternalWorkbook(filePath, operations)
    — writes changes to a workbook file on disk (creates it if it doesn't exist)
    — operations is an array of operation objects:
      {type:"setValue", sheet:"Sheet1", cell:"A1", value:"Hello"}
      {type:"setFormula", sheet:"Sheet1", cell:"B1", formula:"SUM(A1:A10)"}
      {type:"setValues", sheet:"Sheet1", startCell:"A1", values:[["Name","Age"],["Alice",30]]}
      {type:"setFormat", sheet:"Sheet1", cell:"A1", bold:true, fill:"FF217346"}
    — example: await writeExternalWorkbook(files[0].path, [
        {type:"setValue", sheet:"Sheet1", cell:"D1", value:"Result"},
        {type:"setFormula", sheet:"Sheet1", cell:"D2", formula:"SUM(B2:C2)"}
      ]);

  openInExcel(filePath)
    — opens a workbook file in Excel (the desktop app)
    — use this AFTER writing changes so the user can see them
    — DO NOT call this if the user says "don't open it" or "just save it"
    — example: await openInExcel(files[0].path);

MULTI-WORKBOOK WORKFLOW EXAMPLES:

User: "Find my Sales Report workbook and copy the totals to this workbook"
Response:
Finding your Sales Report and copying the totals.
CODE_JS::
const files = await searchWorkbooks("Sales Report");
if (!files.length) throw new Error("No workbook matching 'Sales Report' found on your computer.");
const extData = await readExternalWorkbook(files[0].path);
const salesSheet = extData.sheets[0];
// Find totals in external workbook
const totals = salesSheet.rows[salesSheet.rows.length - 1].values;
// Write to current workbook
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("rowCount");
await context.sync();
const targetRow = used.rowCount + 2;
for (let i = 0; i < totals.length; i++) {
  sheet.getRangeByIndexes(targetRow, i, 1, 1).values = [[totals[i]]];
}
await context.sync();
return "Copied " + totals.length + " values from " + files[0].name;
::END_CODE

User: "Apply this formula to cells B2:B10 in Workbook Y, using results from this workbook, then open it"
Response:
I'll read the current data, apply formulas to Workbook Y, and open it.
CODE_JS::
// 1. Read data from current workbook
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("values");
await context.sync();
const currentData = used.values;
// 2. Find the target workbook
const files = await searchWorkbooks("Workbook Y");
if (!files.length) throw new Error("Could not find 'Workbook Y' on your computer.");
// 3. Write results to it
const ops = [];
for (let i = 1; i < Math.min(currentData.length, 10); i++) {
  ops.push({type:"setValue", sheet:"Sheet1", cell:"B" + (i+1), value: currentData[i][1] * 2});
}
await writeExternalWorkbook(files[0].path, ops);
// 4. Open it in Excel
await openInExcel(files[0].path);
return "Applied formulas to " + ops.length + " cells in " + files[0].name + " and opened it.";
::END_CODE

User: "Update 3 workbooks with this month's data but don't open them"
Response:
Updating all three workbooks without opening them.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("values");
await context.sync();
const monthData = used.values;
const targets = ["Budget 2024", "Summary Report", "Department Costs"];
let updated = 0;
for (const name of targets) {
  const files = await searchWorkbooks(name);
  if (!files.length) { continue; }
  const ops = monthData.slice(1).map((row, i) => ({
    type: "setValue", sheet: "Sheet1", cell: "C" + (i + 2), value: row[2]
  }));
  await writeExternalWorkbook(files[0].path, ops);
  updated++;
}
return "Updated " + updated + " of " + targets.length + " workbooks (not opened).";
::END_CODE

IMPORTANT MULTI-WORKBOOK RULES:
- When the user says a workbook name, ALWAYS use searchWorkbooks() to find it — never guess paths
- If the user says "find workbooks containing X", use searchWorkbooksByContent() to search cell contents
- ALWAYS check if searchWorkbooks returns results before proceeding — throw a clear error if not found
- By DEFAULT, open modified external workbooks with openInExcel() AFTER writing
- Do NOT open workbooks if the user explicitly says not to (e.g., "don't open", "just save", "silently")
- You can chain operations: read current workbook → process → write to external → optionally open
- For many workbooks (e.g., 100), use a loop — the helpers handle files efficiently
- External workbook operations happen on disk — they don't need Excel to be open

OTHER RULES:
- Be concise. One short sentence explaining what you're doing, then the CODE_JS block.
- Never tell the user to do something manually that you can do via code.
- If a requested column does not exist, throw a clear error: throw new Error("Column 'X' not found. Check the column name and try again.");
- Only skip CODE_JS if the user is purely asking a question with no changes needed.

VBA MACROS — USE WHEN OFFICE JS CANNOT DO THE JOB:
Some tasks CANNOT be done with the Office JS API (CODE_JS). For these, output a VBA_MACRO block instead:

VBA_MACRO::
Sub MyMacro()
    ' VBA code here
End Sub
::END_VBA

USE VBA_MACRO (not CODE_JS) for:
- Custom UserForms / input dialogs beyond simple prompts
- ActiveX or Form controls on worksheets
- Advanced page setup (custom headers/footers, print areas, page breaks)
- Sending emails via Outlook
- Advanced chart sub-type customization
- Workbook events (BeforeSave, BeforeClose, Workbook_Open)
- Accessing other Office apps (Word, Outlook, PowerPoint)
- Running shell commands or calling external DLLs
- Advanced Find/Replace with regex

When you output VBA_MACRO, also include a brief instruction like:
"I've generated VBA code for this. Click the **Copy** button below, then press **Alt+F11** to open the VBA Editor, go to **Insert > Module**, paste the code, and press **F5** to run it."

ALWAYS prefer CODE_JS when both can do the job — it runs automatically without user steps.
If unsure whether Office JS supports something, use CODE_JS first. Only fall back to VBA_MACRO for the specific cases listed above.

// EVAL-IMPROVEMENTS-START
**Rules:**

* When filtering by value, use 'getUsedRange().load("values")' and 'context.sync()' to load the values before filtering.
* When filtering by column name, use 'getUsedRange().columns' to get the column index.
* When clearing all filters, use 'clearFilters()' with the correct column specification.
* When inserting a new row, use 'insertRows()' instead of shifting existing data.
* When deleting a row, use 'deleteRow(row)' instead of 'delete(Excel.DeleteShiftDirection.up)'.
* When setting number format, use 'setNumberFormat()' with the correct range and format string.
* When inserting a shape, specify the cell where the shape should be inserted.
* When creating a table, use 'createTable()' with the correct range and options.

**Examples:**

'''javascript
// gen-L1-filter-002
const sheet = workbook.worksheets.getActiveWorksheet();
const range = sheet.getUsedRange();
range.load("values");
await context.sync();
const rows = range.values;
const hdr = rows[0].map(h => String(h).toLowerCase().trim());
const col = hdr.indexOf("x");
if (col === -1) throw new Error("Column 'X' not found.");
const toShow = rows.filter(function(r) { return String(r[col]).toLowerCase() === "val"; });
sheet.getRangeByIndexes(0, 0, toShow.length, rows[0].length).values = toShow;

// gen-L1-filter-003
const sheet = workbook.worksheets.getActiveWorksheet();
sheet.clearFilters();

// gen-L1-filter-059
const sheet = workbook.worksheets.getActiveWorksheet();
const range = sheet.getRange("B2:B" + sheet.getUsedRange().rowCount);
range.load("values");
await context.sync();
const rows = range.values;
const hdr = rows[0].map(h => String(h).toLowerCase().trim());
const col = hdr.indexOf("y");
if (col === -1) throw new Error("Column 'Y' not found.");
const toShow = rows.filter(function(r) { return String(r[col]).toLowerCase() === "val"; });
sheet.getRangeByIndexes(0, col, toShow.length, 1).values = toShow;

// L1-format-003
const sheet = workbook.worksheets.getActiveWorksheet();
const range = sheet.getRange("B2:B" + sheet.getUsedRange().rowCount);
range.load("values");
await context.sync();
range.setNumberFormat
// EVAL-IMPROVEMENTS-END
`
+ (DEFAULT_MODEL.toLowerCase().includes('qwen') ? '\n/no_think' : '');

// ── Call the AI ───────────────────────────────────────────────────────────────
function injectNoThink(messages, model) {
  if (!model.toLowerCase().includes('qwen')) return messages;
  return messages.map(m =>
    m.role === 'system' && !m.content.includes('/no_think') && !m.content.includes('__ALLOW_THINK__')
      ? { ...m, content: m.content + '\n/no_think' }
      : m
  );
}

// ── Stream helpers ────────────────────────────────────────────────────────────
async function* readLines(stream) {
  let buf = '';
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) yield line;
  }
  if (buf) yield buf;
}

// Yields {token, usage?} chunks; usage appears once at end for OpenAI-compatible providers
// Resolve provider config from client request + server env fallbacks
function resolveProvider(req) {
  const pc = req.body?.providerConfig;
  if (pc && pc.provider && pc.provider !== 'openrouter') {
    // New-style request with explicit provider
    const key = pc.apiKey || ({
      openrouter: OPENROUTER_KEY, groq: GROQ_KEY,
      openai: process.env.OPENAI_KEY, anthropic: process.env.ANTHROPIC_KEY,
      google: process.env.GOOGLE_AI_KEY, mistral: process.env.MISTRAL_KEY,
      together: process.env.TOGETHER_KEY,
    })[pc.provider] || '';
    return { provider: pc.provider, endpoint: pc.endpoint, apiKey: key, format: pc.format || 'openai' };
  }
  // Backward compat: old-style boolean flags
  const { useOllama, useGroq, apiKey, groqKey } = req.body || {};
  if (useOllama) return { provider: 'ollama', endpoint: '', apiKey: '', format: 'ollama' };
  if (useGroq || USE_GROQ) return { provider: 'groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey: groqKey || GROQ_KEY, format: 'openai' };
  const orKey = (pc?.apiKey) || apiKey || OPENROUTER_KEY;
  if (USE_OPENROUTER || orKey) return { provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', apiKey: orKey, format: 'openai' };
  if (USE_MLX) return { provider: 'mlx', endpoint: `http://${OLLAMA_HOST}:${MLX_PORT}/v1/chat/completions`, apiKey: '', format: 'openai' };
  return { provider: 'ollama', endpoint: '', apiKey: '', format: 'ollama' };
}

async function* streamAI(messages, maxTokens, model, providerCfg) {
  const effectiveModel = model || DEFAULT_MODEL;
  const { provider, endpoint, apiKey: pKey, format } = providerCfg;

  // Friendly guard: cloud providers need a key. Fail with a clear, actionable
  // message instead of leaking the provider's cryptic auth error.
  const isLocal = provider === 'ollama' || provider === 'mlx' || format === 'ollama';
  if (!isLocal && !pKey) {
    const label = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'this provider';
    throw new Error(`No API key set for ${label}. Open Settings → Providers and paste your ${label} key (or add it to your .env), then try again. Free options: OpenRouter and Groq have free tiers, or run a local model with Ollama — no key needed.`);
  }

  // ── Ollama native format ──
  if (format === 'ollama') {
    const ollamaUrl = endpoint || `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/chat`;
    const msgsToSend = injectNoThink(messages, effectiveModel);
    const res = await fetch(ollamaUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 120000,
      body: JSON.stringify({ model: effectiveModel, messages: msgsToSend, stream: true,
        options: { num_ctx: 8192, num_predict: maxTokens, temperature: 0.15, top_p: 0.9, repeat_penalty: 1.1 } })
    });
    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d.message?.content) yield { token: d.message.content };
        if (d.done) return;
      } catch {}
    }
    return;
  }

  // ── Anthropic Messages API ──
  if (format === 'anthropic') {
    const url = endpoint || 'https://api.anthropic.com/v1/messages';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': pKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: effectiveModel, messages, max_tokens: maxTokens, stream: true })
    });
    if (!res.ok) {
      let body = ''; try { body = await res.text(); } catch {}
      let msg = `Anthropic error ${res.status}`;
      try { const j = JSON.parse(body); msg = j.error?.message || msg; } catch { if (body) msg = body.slice(0, 300); }
      throw new Error(msg);
    }
    let pendingUsage = null;
    for await (const line of readLines(res.body)) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      try {
        const d = JSON.parse(raw);
        if (d.type === 'content_block_delta' && d.delta?.text) yield { token: d.delta.text };
        if (d.type === 'message_delta' && d.usage) pendingUsage = d.usage;
        if (d.type === 'message_stop') { if (pendingUsage) yield { token: '', usage: pendingUsage }; return; }
      } catch {}
    }
    if (pendingUsage) yield { token: '', usage: pendingUsage };
    return;
  }

  // ── OpenAI-compatible format (OpenRouter, Groq, OpenAI, Mistral, Together, MLX, Google AI, custom) ──
  let url = endpoint;
  const headers = { 'Content-Type': 'application/json' };
  if (pKey) headers['Authorization'] = `Bearer ${pKey}`;
  if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://localhost:3000'; headers['X-Title'] = 'Excel AI Assistant'; }
  const msgsToSend = (provider === 'mlx' || provider === 'ollama') ? injectNoThink(messages, effectiveModel) : messages;
  const reqBody = { model: effectiveModel, messages: msgsToSend, max_tokens: maxTokens, temperature: 0.15, top_p: 0.9,
    stream: true, stream_options: { include_usage: true } };

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(reqBody) });
  if (!res.ok) {
    let body = ''; try { body = await res.text(); } catch {}
    let msg = `Provider error ${res.status}`;
    try { const j = JSON.parse(body); msg = j.error?.message || (typeof j.error === 'string' ? j.error : null) || msg; }
    catch { if (body) msg = body.slice(0, 300); }
    throw new Error(msg);
  }
  let pendingUsage = null;
  for await (const line of readLines(res.body)) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') { if (pendingUsage) yield { token: '', usage: pendingUsage }; return; }
    try {
      const d = JSON.parse(raw);
      if (d.usage) pendingUsage = d.usage;
      const token = d.choices?.[0]?.delta?.content;
      if (token) yield { token };
    } catch {}
  }
  if (pendingUsage) yield { token: '', usage: pendingUsage };
}

async function callAI(messages, maxTokens = 4096, model = null, useOllama = false, useGroq = false, apiKey = null, groqKey = null, providerCfg = null) {
  // If no explicit providerCfg, build one from legacy flags
  if (!providerCfg) {
    if (useOllama) providerCfg = { provider: 'ollama', endpoint: '', apiKey: '', format: 'ollama' };
    else if (useGroq || USE_GROQ) providerCfg = { provider: 'groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey: groqKey || GROQ_KEY, format: 'openai' };
    else if (USE_OPENROUTER || apiKey || OPENROUTER_KEY) providerCfg = { provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', apiKey: apiKey || OPENROUTER_KEY, format: 'openai' };
    else if (USE_MLX) providerCfg = { provider: 'mlx', endpoint: `http://${OLLAMA_HOST}:${MLX_PORT}/v1/chat/completions`, apiKey: '', format: 'openai' };
    else providerCfg = { provider: 'ollama', endpoint: '', apiKey: '', format: 'ollama' };
  }
  const effectiveModel = model || DEFAULT_MODEL;
  const { provider, endpoint, apiKey: pKey, format } = providerCfg;

  // Friendly guard: cloud providers need a key. Fail with a clear, actionable
  // message instead of leaking the provider's cryptic auth error.
  const isLocal = provider === 'ollama' || provider === 'mlx' || format === 'ollama';
  if (!isLocal && !pKey) {
    const label = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'this provider';
    throw new Error(`No API key set for ${label}. Open Settings → Providers and paste your ${label} key (or add it to your .env), then try again. Free options: OpenRouter and Groq have free tiers, or run a local model with Ollama — no key needed.`);
  }

  // ── Ollama native format ──
  if (format === 'ollama') {
    const ollamaUrl = endpoint || `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/chat`;
    const msgsToSend = injectNoThink(messages, effectiveModel);
    const res = await fetch(ollamaUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 120000,
      body: JSON.stringify({ model: effectiveModel, messages: msgsToSend, stream: false,
        options: { num_ctx: 8192, num_predict: maxTokens, temperature: 0.15, top_p: 0.9, repeat_penalty: 1.1 } })
    });
    const data = await res.json();
    if (!data.message) throw new Error(data.error || 'Ollama returned no message — is the model loaded?');
    return { text: data.message.content, usage: null };
  }

  // ── Anthropic Messages API ──
  if (format === 'anthropic') {
    const url = endpoint || 'https://api.anthropic.com/v1/messages';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': pKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: effectiveModel, messages, max_tokens: maxTokens })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return { text, usage: data.usage || null };
  }

  // ── OpenAI-compatible ──
  const url = endpoint;
  const headers = { 'Content-Type': 'application/json' };
  if (pKey) headers['Authorization'] = `Bearer ${pKey}`;
  if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://localhost:3000'; headers['X-Title'] = 'Excel AI Assistant'; }
  const msgsToSend = (provider === 'mlx') ? injectNoThink(messages, effectiveModel) : messages;
  const res = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({ model: effectiveModel, messages: msgsToSend, max_tokens: maxTokens, temperature: 0.15, top_p: 0.9 })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)));
  return { text: data.choices[0].message.content, usage: data.usage || null };
}

// ── Parse code from response ─────────────────────────────────────────────────
function parseResponse(text) {
  let code = null, vba = null;
  const codeMatches = [...text.matchAll(/CODE_JS::([\s\S]*?)::END_CODE/g)];
  if (codeMatches.length) code = codeMatches[codeMatches.length - 1][1].trim(); // use last block
  if (codeMatches.length > 1) console.log(`[server] ${codeMatches.length} CODE_JS blocks found — using last`);
  const vbaMatch = text.match(/VBA_MACRO::([\s\S]*?)::END_VBA/);
  if (vbaMatch) vba = vbaMatch[1].trim();

  const cleaned = text
    .replace(/CODE_JS::[\s\S]*?::END_CODE/g, '')
    .replace(/VBA_MACRO::[\s\S]*?::END_VBA/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();

  return { code, vba, cleaned };
}

// ── Danger classifier: scans CODE_JS for risky filesystem operations ──────────
function analyzeDanger(code) {
  if (!code) return null;

  // Critical — irreversible: deletion, shell execution
  const critical = [
    [/\bdeleteFile\b|\bremoveFile\b|\bunlinkSync?\b|\bfs\.rm\b/i,       'file deletion'],
    [/\brmdir\b|\brm\b.*-rf|\.remove\s*\(\s*true\b/i,                   'directory removal'],
    [/child_process|\.exec\s*\(|\.execSync\s*\(|shelljs/i,              'shell command execution'],
    [/fetch\s*\(.*\/api\/.*\bdelet/i,                                    'server-side file deletion endpoint'],
    [/fetch\s*\(.*\/api\/.*\bremov/i,                                    'server-side file removal endpoint'],
  ];

  // High — risky but recoverable: bulk moves, renames, folder creation, drive-wide search
  const high = [
    [/fetch\s*\(.*\/api\/.*\bmov[ei]/i,                                  'bulk file move'],
    [/fetch\s*\(.*\/api\/.*\brenam/i,                                    'file rename operation'],
    [/fetch\s*\(.*\/api\/.*\b(mkdir|createDir|createFolder)\b/i,        'directory creation'],
    [/\bmkdir\b|\bmkdirSync\b|\bcreateDirectory\b/i,                     'directory creation'],
    [/\brenamefile\b|\brename\s*\(/i,                                    'file rename'],
    [/\bmove\s*\(.*\.(xlsx|xlsm)\b/i,                                    'workbook file move'],
    // Bulk: loop that calls a write/modify endpoint for each file
    [/(for\b|forEach|\.map\s*\()[\s\S]{1,600}\/api\/workbooks\/write/is, 'bulk workbook modification loop'],
    // Searching from drive roots
    [/['"](C:\\\\|D:\\\\|E:\\\\|[A-Z]:\\\\|\/home\/|\/Users\/|\/root\/)['"]/i, 'whole-drive file search'],
    // Recursive file walk outside known patterns
    [/readdirSync\s*\(|walkDir\s*\(|glob\s*\(/i,                        'recursive filesystem traversal'],
  ];

  for (const [pattern, reason] of critical) {
    if (pattern.test(code)) return { level: 'critical', reason };
  }
  for (const [pattern, reason] of high) {
    if (pattern.test(code)) return { level: 'high', reason };
  }
  return null;
}

// ── Detect if model forgot to include code for an action request ─────────────
function isQuestion(userMessage) {
  const s = userMessage.toLowerCase().trim();
  const dataQueryWords = ['how many', 'how much', 'what is the total', 'what is the sum', 'what is the average', 'count', 'sum of', 'total of', 'list all', 'show me', 'find all', 'find the', 'which rows', 'how often'];
  if (dataQueryWords.some(q => s.includes(q))) return false;
  // Only treat "?" messages as questions if they start with a question word —
  // action requests like "Can you bold the headers?" end with ? but need code.
  const questionStarters = ['why ', 'explain', 'tell me', 'describe', 'can you explain', 'can you tell', 'what does', 'what is a ', 'what are the', 'how do i', 'how does', 'what is vlookup', 'what is pivot', 'what is a', 'is there ', 'are there ', 'does excel', 'when ', 'where ', 'what happens', 'what should', 'what version', 'which col', 'which row', 'which sheet', 'can excel'];
  return questionStarters.some(q => s.startsWith(q));
}

function isConversational(userMessage) {
  const s = userMessage.toLowerCase().trim().replace(/[!?.,:;]+$/g, '');
  const greetings = ['hi','hey','hello','howdy','yo','sup','hola','good morning','good afternoon','good evening','morning','afternoon','gm'];
  const chitchat = ['thanks','thank you','thx','ok','okay','cool','nice','great','awesome','perfect','got it','understood','sounds good','bye','goodbye','see you','no thanks','nah','nope','yes','yeah','yep','sure','alright','right','hmm','hm','wow','lol','haha','bruh','dude'];
  if (greetings.includes(s) || chitchat.includes(s)) return true;
  if (s.length < 12 && !s.includes('row') && !s.includes('col') && !s.includes('cell') && !s.includes('sheet') && !s.includes('format') && !s.includes('filter') && !s.includes('sort') && !s.includes('add') && !s.includes('delete') && !s.includes('bold') && !s.includes('sum') && !s.includes('formula')) return true;
  return false;
}

function modelForgotCode(responseText, userMessage) {
  if (responseText.includes('CODE_JS::')) return false;
  if (isQuestion(userMessage)) return false;
  if (isConversational(userMessage)) return false;
  return true;
}

// ── Chat history endpoints ────────────────────────────────────────────────────
app.get('/api/chats', (req, res) => {
  const chats = readChats(uid(req));
  const list = Object.values(chats)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(({ id, title, updatedAt, messageCount, totalTokens }) => ({ id, title, updatedAt, messageCount, totalTokens }));
  res.json(list);
});

app.get('/api/chats/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json([]);
  const chats = readChats(uid(req));
  const results = Object.values(chats).filter(c =>
    (c.title || '').toLowerCase().includes(q) ||
    (c.messages || []).some(m => (m.content || '').toLowerCase().includes(q))
  ).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 20).map(c => {
    const matchMsg = (c.messages || []).find(m => (m.content || '').toLowerCase().includes(q));
    const idx = matchMsg ? matchMsg.content.toLowerCase().indexOf(q) : -1;
    const preview = matchMsg ? matchMsg.content.slice(Math.max(0, idx - 30), idx + 70) : null;
    return { id: c.id, title: c.title, updatedAt: c.updatedAt, matchPreview: preview };
  });
  res.json(results);
});

app.post('/api/chats', (req, res) => {
  const chats = readChats(uid(req));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  chats[id] = { id, title: req.body.title || 'New Chat', messages: req.body.messages || [], summary: null, totalTokens: 0, messageCount: 0, createdAt: now, updatedAt: now };
  writeChats(uid(req), chats);
  res.json(chats[id]);
});

app.get('/api/chats/:id', (req, res) => {
  const chats = readChats(uid(req));
  const chat = chats[req.params.id];
  if (!chat) return res.status(404).json({ error: 'Not found' });
  res.json(chat);
});

app.patch('/api/chats/:id', (req, res) => {
  const chats = readChats(uid(req));
  const chat = chats[req.params.id];
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const { title, messages, summary, totalTokens } = req.body;
  if (title !== undefined) chat.title = title;
  if (messages !== undefined) { chat.messages = messages; chat.messageCount = messages.length; }
  if (summary !== undefined) chat.summary = summary;
  if (totalTokens !== undefined) chat.totalTokens = totalTokens;
  chat.updatedAt = new Date().toISOString();
  writeChats(uid(req), chats);
  res.json(chat);
});

app.delete('/api/chats/:id', (req, res) => {
  const chats = readChats(uid(req));
  delete chats[req.params.id];
  writeChats(uid(req), chats);
  res.json({ ok: true });
});

// ── Training chats ──────────────────────────────────────────────────────────
app.get('/api/training', (req, res) => {
  const data = readTraining(uid(req));
  const list = Object.values(data)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(({ id, title, updatedAt, messageCount, skillCount }) => ({ id, title, updatedAt, messageCount: messageCount || 0, skillCount: skillCount || 0 }));
  res.json(list);
});

app.post('/api/training', (req, res) => {
  const data = readTraining(uid(req));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  data[id] = { id, title: req.body.title || 'New Training', messages: [], skillCount: 0, messageCount: 0, createdAt: now, updatedAt: now };
  writeTraining(uid(req), data);
  res.json(data[id]);
});

app.get('/api/training/:id', (req, res) => {
  const data = readTraining(uid(req));
  const chat = data[req.params.id];
  if (!chat) return res.status(404).json({ error: 'Not found' });
  res.json(chat);
});

app.patch('/api/training/:id', (req, res) => {
  const data = readTraining(uid(req));
  const chat = data[req.params.id];
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const { title, messages, skillCount } = req.body;
  if (title !== undefined) chat.title = title;
  if (messages !== undefined) { chat.messages = messages; chat.messageCount = messages.length; }
  if (skillCount !== undefined) chat.skillCount = skillCount;
  chat.updatedAt = new Date().toISOString();
  writeTraining(uid(req), data);
  res.json(chat);
});

app.delete('/api/training/:id', (req, res) => {
  const data = readTraining(uid(req));
  delete data[req.params.id];
  writeTraining(uid(req), data);
  res.json({ ok: true });
});

// ── Skills (approved training examples/knowledge) ────────────────────────────
app.get('/api/skills', (req, res) => {
  res.json(readSkills(uid(req)));
});

app.post('/api/skills', (req, res) => {
  const skills = readSkills(uid(req));
  const skill = {
    id: crypto.randomUUID(),
    type: req.body.type || 'knowledge',
    title: req.body.title || '',
    content: req.body.content || '',
    examples: req.body.examples || [],
    tags: req.body.tags || [],
    trainingChatId: req.body.trainingChatId || null,
    createdAt: new Date().toISOString()
  };
  skills.push(skill);
  writeSkills(uid(req), skills);
  res.json(skill);
});

app.delete('/api/skills/:id', (req, res) => {
  let skills = readSkills(uid(req));
  skills = skills.filter(s => s.id !== req.params.id);
  writeSkills(uid(req), skills);
  res.json({ ok: true });
});

app.get('/api/skills/export', (req, res) => {
  const skills = readSkills(uid(req));
  const format = req.query.format || 'jsonl';
  if (format === 'jsonl') {
    const lines = [];
    skills.forEach(s => {
      if (s.examples && s.examples.length) {
        s.examples.forEach(ex => {
          lines.push(JSON.stringify({
            messages: [
              { role: 'system', content: 'You are an AI assistant for Microsoft Excel.' },
              { role: 'user', content: ex.input },
              { role: 'assistant', content: ex.output }
            ]
          }));
        });
      }
    });
    res.setHeader('Content-Type', 'application/jsonl');
    res.setHeader('Content-Disposition', 'attachment; filename="training-data.jsonl"');
    res.send(lines.join('\n'));
  } else {
    res.json(skills);
  }
});

// ── Usage log persistence ────────────────────────────────────────────────────
app.get('/api/usage', (req, res) => {
  res.json(readUsage(uid(req)));
});
app.post('/api/usage', (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Expected array' });
  const existing = readUsage(uid(req));
  const existingTs = new Set(existing.map(e => e.ts));
  const fresh = entries.filter(e => e.ts && !existingTs.has(e.ts));
  const merged = existing.concat(fresh);
  const USAGE_MAX = 5000;
  if (merged.length > USAGE_MAX) merged.splice(0, merged.length - USAGE_MAX);
  writeUsage(uid(req), merged);
  res.json({ ok: true, count: merged.length });
});
app.delete('/api/usage', (req, res) => {
  writeUsage(uid(req), []);
  res.json({ ok: true });
});

// ── Full OpenRouter model catalog (cached 1 h) ────────────────────────────────
let catalogCache = null, catalogCacheAt = 0;
app.get('/api/models/catalog', async (req, res) => {
  if (catalogCache && Date.now() - catalogCacheAt < 3600_000) return res.json(catalogCache);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', {
      headers: OPENROUTER_KEY ? { 'Authorization': `Bearer ${OPENROUTER_KEY}` } : {}
    });
    const data = await r.json();
    catalogCache = (data.data || []).map(m => ({
      id:      m.id,
      name:    m.name || m.id,
      in:      m.pricing?.prompt     ? Math.round(parseFloat(m.pricing.prompt)     * 1e6 * 100) / 100 : 0,
      out:     m.pricing?.completion ? Math.round(parseFloat(m.pricing.completion) * 1e6 * 100) / 100 : 0,
      context: m.context_length || null,
    })).sort((a, b) => a.name.localeCompare(b.name));
    catalogCacheAt = Date.now();
    res.json(catalogCache);
  } catch (err) {
    res.status(500).json({ error: 'Catalog fetch failed' });
  }
});

// ── Local model detection (Ollama) ────────────────────────────────────────────
app.get('/api/models/local', async (req, res) => {
  try {
    const r = await fetch(`http://localhost:${OLLAMA_PORT}/api/tags`, { timeout: 2000 });
    const data = await r.json();
    const models = (data.models || []).map(m => ({ id: m.name, name: m.name }));
    res.json(models);
  } catch {
    res.json([]);
  }
});

// ── Model recommendation ─────────────────────────────────────────────────────
app.post('/api/recommend-model', async (req, res) => {
  const { specs, modelUsage, preferences, availableModels, apiKey } = req.body;
  // Always use OpenRouter for this call — independent of whatever model the user has selected.
  const orKey = apiKey || OPENROUTER_KEY;
  if (!orKey) return res.status(400).json({ error: 'No OpenRouter API key configured.' });

  const modelList = (availableModels || []).map(m =>
    `${m.id} | ${m.name} | $${m.in}/$${m.out} per 1M tok${(m.tags||[]).includes('free') ? ' [FREE]' : ''}`
  ).join('\n');
  const usageStr = Object.entries(modelUsage || {}).sort((a,b)=>b[1]-a[1]).slice(0,5)
    .map(([id,n])=>`${id}: used ${n}x`).join('\n') || 'No history yet';

  try {
    const { text } = await callAI([
      { role: 'system', content: 'You are an expert in AI model selection. Respond ONLY with valid JSON: {"modelId":"exact-id","reason":"2-3 sentence explanation"}. No markdown. No extra text.' },
      { role: 'user', content: `A user runs an Excel AI Assistant. Recommend the single best model for them.

PC SPECS:
- CPU cores: ${specs?.cores || 'unknown'}
- RAM: ${specs?.memory || 'unknown'} GB
- GPU: ${specs?.gpu || 'unknown'}
- GPU Vendor: ${specs?.gpuVendor || 'unknown'}
- Platform: ${specs?.platform || 'unknown'}

USAGE HISTORY (most used first):
${usageStr}

USER PREFERENCES: ${preferences || 'None stated'}

AVAILABLE MODELS (id | name | price in/out per 1M):
${modelList}

Consider: code generation quality for Excel tasks, cost, speed. GPU/RAM only matter for local Ollama models. Cloud models run on provider hardware.

Respond with ONLY this JSON: {"modelId":"exact-id-from-list","reason":"2-3 sentences explaining why"}` }
    ], 400, 'meta-llama/llama-3.3-70b-instruct', false, false, orKey, null);

    const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    let parsed = null;
    // Try full parse first, then greedy regex extraction
    try { parsed = JSON.parse(clean); } catch {}
    if (!parsed) {
      const match = clean.match(/\{[\s\S]*?\}/); // non-greedy — matches first complete {...}
      if (match) try { parsed = JSON.parse(match[0]); } catch {}
    }
    if (parsed?.modelId) {
      console.log('[recommend] →', parsed.modelId);
      return res.json(parsed);
    }
    console.log('[recommend] Could not parse response:', clean.slice(0, 200));
    res.json({ modelId: null, reason: 'Could not parse recommendation.' });
  } catch (err) {
    console.error('[recommend] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-feedback: detect user dissatisfaction ──────────────────────────────
const FEEDBACK_FILES = {
  human:    path.join(__dirname, 'feedback.jsonl'),
  autoHard: path.join(__dirname, 'feedback-auto-hard.jsonl'),
  autoSoft: path.join(__dirname, 'feedback-auto-soft.jsonl'),
};
const FEEDBACK_WEIGHTS = { human: 1.0, autoHard: 0.7, autoSoft: 0.4 };

const HARD_PATTERNS = [
  /that(?:'s| is) (?:completely |totally )?wrong/i,
  /you (?:messed|screwed|broke|ruined)/i,
  /(?:no+!|NO!)/,
  /(?:wrong|incorrect|broken|messed up|screwed up|completely off)/i,
  /(?:the code (?:failed|crashed|broke|errored|doesn't work|does not work|didn't work))/i,
  /(?:that (?:didn't|did not|doesn't|does not) (?:work|do (?:what|anything)))/i,
  /(?:you (?:forgot|missed|ignored|skipped) (?:to |the |my ))/i,
  /(?:not (?:at all )?what I (?:asked|wanted|meant|said))/i,
];

const SOFT_PATTERNS = [
  /(?:try|do(?: it)?|redo) (?:it )?again/i,
  /(?:can you (?:redo|undo|fix|correct|retry))/i,
  /(?:that(?:'s| is) not (?:right|correct|what))/i,
  /(?:I (?:said|meant|asked|wanted) )/i,
  /(?:no,? (?:I |not |the |it ))/i,
  /(?:actually,? (?:I |can you |please ))/i,
  /(?:instead(?:,| of))/i,
  /(?:but I (?:said|asked|wanted|meant))/i,
  /(?:you did (?:it )?wrong)/i,
  /(?:please (?:fix|correct|change) (?:it|that|this))/i,
];

function detectDissatisfaction(userMessage, conversationHistory) {
  const s = userMessage.trim();
  if (HARD_PATTERNS.some(p => p.test(s))) return 'hard';
  if (SOFT_PATTERNS.some(p => p.test(s))) return 'soft';
  // Detect retry: user repeats a very similar message to one they sent recently
  if (conversationHistory && conversationHistory.length >= 3) {
    const prevUserMsgs = conversationHistory
      .filter(m => m.role === 'user')
      .map(m => (m.content || '').replace(/\[REMINDER:.*?\]/g, '').trim().toLowerCase());
    const current = s.toLowerCase().replace(/\[REMINDER:.*?\]/g, '').trim();
    if (current.length > 10) {
      for (const prev of prevUserMsgs.slice(-3)) {
        if (prev.length > 10 && prev !== current) {
          const shorter = current.length < prev.length ? current : prev;
          const longer  = current.length < prev.length ? prev : current;
          if (longer.includes(shorter) || similarity(current, prev) > 0.7) {
            return 'soft';
          }
        }
      }
    }
  }
  return null;
}

function similarity(a, b) {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  return intersection / Math.max(setA.size, setB.size);
}

function logAutoFeedback(tier, prompt, response, code, model) {
  const file = tier === 'hard' ? FEEDBACK_FILES.autoHard : FEEDBACK_FILES.autoSoft;
  const entry = { prompt, response, code: code || null, model, tier, timestamp: new Date().toISOString() };
  fs.appendFile(file, JSON.stringify(entry) + '\n', err => {
    if (err) console.error(`[auto-feedback][${tier}] write error:`, err.message);
  });
  console.log(`[auto-feedback][${tier}] Logged for prompt: ${prompt?.slice(0, 60)}`);
}

// ── Feedback endpoint (human reports) ────────────────────────────────────────
app.post("/api/feedback", (req, res) => {
  const entry = { ...req.body, tier: 'human' };
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(FEEDBACK_FILES.human, line);
  console.log("[feedback][human] Saved entry for prompt:", entry.prompt?.slice(0, 60));
  res.json({ ok: true });
});

// ── Auto-feedback endpoint (called by frontend when code execution fails) ───
app.post("/api/feedback/auto", (req, res) => {
  const { tier, prompt, response, code, model } = req.body;
  if (!tier || !['soft', 'hard'].includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
  logAutoFeedback(tier, prompt, response, code, model);
  res.json({ ok: true });
});

// ── Fine-tune export: merge all feedback tiers with weights ─────────────────
app.get('/api/finetune/export', (req, res) => {
  const format = req.query.format || 'jsonl'; // jsonl or json
  const entries = [];

  for (const [tier, file] of Object.entries(FEEDBACK_FILES)) {
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          entries.push({
            weight: FEEDBACK_WEIGHTS[tier],
            tier,
            prompt: entry.prompt || '',
            response: entry.response || '',
            code: entry.code || null,
            model: entry.model || null,
            timestamp: entry.timestamp || null,
          });
        } catch {}
      }
    } catch {}
  }

  entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  if (format === 'json') {
    res.json({
      totalEntries: entries.length,
      byTier: {
        human:    entries.filter(e => e.tier === 'human').length,
        autoHard: entries.filter(e => e.tier === 'autoHard').length,
        autoSoft: entries.filter(e => e.tier === 'autoSoft').length,
      },
      weights: FEEDBACK_WEIGHTS,
      entries,
    });
  } else {
    // Training-ready JSONL: each line is a conversation turn with weight
    const lines = entries.map(e => JSON.stringify({
      messages: [
        { role: 'user', content: e.prompt },
        { role: 'assistant', content: (e.response || '') + (e.code ? '\nCODE_JS::\n' + e.code + '\n::END_CODE' : '') },
      ],
      weight: e.weight,
      tier: e.tier,
      _meta: { model: e.model, timestamp: e.timestamp },
    }));
    res.setHeader('Content-Type', 'application/jsonl');
    res.setHeader('Content-Disposition', 'attachment; filename="finetune-feedback.jsonl"');
    res.send(lines.join('\n') + '\n');
  }
});

// ── Fine-tune stats endpoint ────────────────────────────────────────────────
app.get('/api/finetune/stats', (req, res) => {
  const stats = {};
  for (const [tier, file] of Object.entries(FEEDBACK_FILES)) {
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      stats[tier] = { count: lines.length, weight: FEEDBACK_WEIGHTS[tier] };
    } catch {
      stats[tier] = { count: 0, weight: FEEDBACK_WEIGHTS[tier] };
    }
  }
  stats.totalWeighted = Object.entries(stats).reduce((sum, [, v]) => sum + (v.count * v.weight), 0);
  res.json(stats);
});

// ── Title generation endpoint ────────────────────────────────────────────────
app.post('/api/title', async (req, res) => {
  const { userMsg, aiReply, apiKey } = req.body;
  try {
    const { text } = await callAI([
      { role: 'system', content: 'Write a chat title: 4-6 words, no quotes, no punctuation at the end. Summarise what the user asked.' },
      { role: 'user', content: `User: ${String(userMsg).slice(0, 200)}\nAssistant: ${String(aiReply).slice(0, 200)}` }
    ], 30, null, false, false, apiKey || null);
    const title = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["'`]|["'`]$/g, '').slice(0, 60);
    res.json({ title });
  } catch { res.status(500).json({ error: 'Title generation failed' }); }
});

// ── Summarize endpoint ───────────────────────────────────────────────────────
app.post('/api/compress', async (req, res) => {
  const { messages, previousSummary, apiKey } = req.body;
  try {
    const { text } = await callAI([
      {
        role: 'system',
        content: `Compress an Excel AI assistant conversation into a detailed summary that preserves all context needed for the AI to continue working. Respond with EXACTLY this format:

SUMMARY: [2-3 paragraphs, max 300 words — include: what the user asked for, what was done step by step, which sheets/columns/ranges were modified, what the data looks like now, any calculations or formulas applied, any errors encountered and how they were resolved. Be specific about cell references, column names, and data structures.]

FACTS:
- [a permanent rule, preference, or data reference worth always remembering]
- [another fact]

FACTS rules: max 15 items, max 20 words each. Include:
• User rules/preferences ("always X", "never Y", "I prefer Z")
• Named data: sheet names, column names, table names, named ranges, cell references
• Data structure: what columns exist, what data types they contain
• Formulas or patterns that were applied
• Critical errors to avoid repeating
If nothing worth remembering, write "FACTS: none"`
      },
      {
        role: 'user',
        content: (previousSummary ? `Previous summary:\n${previousSummary}\n\nNew messages:\n` : '')
          + messages.map(m => `${m.role}: ${(m.content || '').slice(0, 800)}`).join('\n\n')
      }
    ], 800, null, false, false, apiKey || null);

    const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    const summaryMatch = clean.match(/SUMMARY:\s*([\s\S]*?)(?=\n\nFACTS:|$)/i);
    const summary = summaryMatch ? summaryMatch[1].trim() : clean.slice(0, 500);

    const factsBlock = clean.match(/FACTS:\s*([\s\S]*)$/i)?.[1] || '';
    const facts = factsBlock === 'none' ? [] : factsBlock
      .split('\n')
      .map(l => l.replace(/^[-•*]\s*/, '').trim())
      .filter(l => l.length > 5 && l.length < 120);

    res.json({ summary, facts });
  } catch (err) {
    res.status(500).json({ error: 'Compression failed' });
  }
});


// ── Multi-workbook: search for .xlsx files on the user's machine ─────────────
const SEARCH_DIRS = [
  os.homedir(),
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'OneDrive'),
  path.join(os.homedir(), 'OneDrive - *'),
];

function expandGlobs(dirs) {
  const expanded = [];
  for (const d of dirs) {
    if (d.includes('*')) {
      try {
        const parent = path.dirname(d);
        const pattern = path.basename(d);
        const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        fs.readdirSync(parent).filter(f => re.test(f)).forEach(f => expanded.push(path.join(parent, f)));
      } catch {}
    } else {
      expanded.push(d);
    }
  }
  return expanded;
}

function isAllowedWorkbookPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  if (!/\.(xlsx|xlsm)$/i.test(filePath)) return false;
  let real;
  try { real = fs.realpathSync(filePath); } catch { real = path.resolve(filePath); }
  const allowed = expandGlobs(SEARCH_DIRS);
  return allowed.some(d => {
    let realD;
    try { realD = fs.realpathSync(d); } catch { realD = path.resolve(d); }
    return real.startsWith(realD + path.sep) || real === realD;
  });
}

function walkForXlsx(dir, maxDepth, results, visited, nameQuery, contentQuery, limit) {
  if (results.length >= limit || maxDepth < 0) return;
  let real;
  try { real = fs.realpathSync(dir); } catch { return; }
  if (visited.has(real)) return;
  visited.add(real);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (results.length >= limit) return;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'AppData') continue;
      walkForXlsx(full, maxDepth - 1, results, visited, nameQuery, contentQuery, limit);
    } else if (/\.(xlsx|xlsm)$/i.test(ent.name) && !ent.name.startsWith('~$')) {
      const nameLower = ent.name.toLowerCase();
      if (nameQuery && nameLower.includes(nameQuery)) {
        try {
          const stat = fs.statSync(full);
          results.push({ path: full, name: ent.name, size: stat.size, modified: stat.mtime });
        } catch {}
      } else if (!nameQuery) {
        try {
          const stat = fs.statSync(full);
          results.push({ path: full, name: ent.name, size: stat.size, modified: stat.mtime });
        } catch {}
      }
    }
  }
}

app.post('/api/workbooks/search', (req, res) => {
  const { query, limit: userLimit } = req.body;
  const limit = Math.min(userLimit || 50, 200);
  const q = (query || '').toLowerCase().trim();
  const results = [];
  const visited = new Set();
  const dirs = expandGlobs(SEARCH_DIRS);
  for (const d of dirs) {
    walkForXlsx(d, 5, results, visited, q || null, null, limit);
    if (results.length >= limit) break;
  }
  res.json(results.slice(0, limit));
});

app.post('/api/workbooks/read', async (req, res) => {
  const { filePath, sheetNames } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  if (!isAllowedWorkbookPath(filePath)) return res.status(400).json({ error: 'filePath must be an .xlsx or .xlsm file in an allowed directory' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const sheets = [];
    for (const ws of wb.worksheets) {
      if (sheetNames && sheetNames.length && !sheetNames.includes(ws.name)) continue;
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rows.length >= 500) return;
        const vals = [];
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          vals[colNum - 1] = cell.value !== null && cell.value !== undefined
            ? (typeof cell.value === 'object' && cell.value.result !== undefined ? cell.value.result : String(cell.value))
            : '';
        });
        rows.push({ row: rowNum, values: vals });
      });
      sheets.push({ name: ws.name, rowCount: ws.rowCount, rows });
    }
    res.json({ file: filePath, sheets });
  } catch (err) {
    res.status(500).json({ error: `Failed to read workbook: ${err.message}` });
  }
});

app.post('/api/workbooks/write', async (req, res) => {
  const { filePath, operations } = req.body;
  if (!filePath || !operations) return res.status(400).json({ error: 'filePath and operations required' });
  if (!isAllowedWorkbookPath(filePath)) return res.status(400).json({ error: 'filePath must be an .xlsx or .xlsm file in an allowed directory' });
  try {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.readFile(filePath); } catch { /* new file */ }
    for (const op of operations) {
      let ws = wb.getWorksheet(op.sheet);
      if (!ws) ws = wb.addWorksheet(op.sheet || 'Sheet1');
      if (op.type === 'setValue') {
        const cell = ws.getCell(op.cell);
        cell.value = op.value;
      } else if (op.type === 'setFormula') {
        const cell = ws.getCell(op.cell);
        cell.value = { formula: op.formula };
      } else if (op.type === 'setValues') {
        // op.startCell, op.values (2D array)
        const startCell = ws.getCell(op.startCell);
        const startRow = startCell.row;
        const startCol = startCell.col;
        for (let r = 0; r < op.values.length; r++) {
          for (let c = 0; c < op.values[r].length; c++) {
            ws.getCell(startRow + r, startCol + c).value = op.values[r][c];
          }
        }
      } else if (op.type === 'setFormat') {
        const cell = ws.getCell(op.cell);
        if (op.bold !== undefined) cell.font = { ...cell.font, bold: op.bold };
        if (op.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: op.fill } };
        if (op.numFmt) cell.numFmt = op.numFmt;
      }
    }
    await wb.xlsx.writeFile(filePath);
    res.json({ ok: true, file: filePath, operationCount: operations.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to write workbook: ${err.message}` });
  }
});

app.post('/api/workbooks/open', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  if (!isAllowedWorkbookPath(filePath)) return res.status(400).json({ error: 'filePath must be an .xlsx or .xlsm file in an allowed directory' });
  const platform = process.platform;
  let cmd, args;
  if (platform === 'win32') {
    cmd = 'cmd'; args = ['/c', 'start', '', filePath];
  } else if (platform === 'darwin') {
    cmd = 'open'; args = [filePath];
  } else {
    cmd = 'xdg-open'; args = [filePath];
  }
  execFile(cmd, args, (err) => {
    if (err) return res.status(500).json({ error: `Failed to open: ${err.message}` });
    res.json({ ok: true, file: filePath });
  });
});

// ── Multi-workbook: content search (searches inside .xlsx for matching text) ─
app.post('/api/workbooks/search-content', async (req, res) => {
  const { query, limit: userLimit } = req.body;
  const limit = Math.min(userLimit || 20, 50);
  const q = (query || '').toLowerCase().trim();
  if (!q) return res.json([]);

  // First find all xlsx files, then search content
  const allFiles = [];
  const visited = new Set();
  const dirs = expandGlobs(SEARCH_DIRS);
  for (const d of dirs) {
    walkForXlsx(d, 4, allFiles, visited, null, null, 500);
  }

  const matches = [];
  for (const f of allFiles) {
    if (matches.length >= limit) break;
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(f.path);
      let found = false;
      for (const ws of wb.worksheets) {
        if (found) break;
        ws.eachRow({ includeEmpty: false }, (row) => {
          if (found) return;
          row.eachCell((cell) => {
            if (found) return;
            const v = cell.value;
            if (v && String(v).toLowerCase().includes(q)) {
              found = true;
            }
          });
        });
      }
      if (found) {
        matches.push({ path: f.path, name: f.name, size: f.size, modified: f.modified });
      }
    } catch {}
  }
  res.json(matches);
});

// ── Attachments: parse an uploaded .xlsx/.xlsm into compact text (ExcelJS) ────
// The browser can't read a binary workbook as text, so the file is sent here
// (base64) and turned into the same "Cell:value" text the model sees elsewhere.
app.post('/api/attachments/xlsx', async (req, res) => {
  const { dataBase64 } = req.body;
  if (!dataBase64) return res.status(400).json({ error: 'No file data provided' });
  const cellText = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      if (v.result !== undefined)       return String(v.result);      // formula result
      if (v.text !== undefined)         return String(v.text);        // hyperlink / rich text
      if (Array.isArray(v.richText))    return v.richText.map(t => t.text).join('');
      if (v.hyperlink)                  return String(v.text || v.hyperlink);
      return JSON.stringify(v);
    }
    return String(v);
  };
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(dataBase64, 'base64'));
    const MAX_ROWS = 100, MAX_CELL = 100, MAX_CHARS = 12000;
    const parts = [];
    let total = 0;
    for (const ws of wb.worksheets) {
      if (total >= MAX_CHARS) break;
      const rowsOut = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (rowsOut.length >= MAX_ROWS) return;
        const cells = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          cells.push(cell.address + ':' + cellText(cell.value).slice(0, MAX_CELL));
        });
        if (cells.length) rowsOut.push(cells.join(' | '));
      });
      if (!rowsOut.length) continue;
      const block = `Sheet: ${ws.name} (${ws.rowCount} rows, ${ws.columnCount} cols)\n` + rowsOut.join('\n');
      parts.push(block);
      total += block.length;
    }
    let text = parts.join('\n\n---\n\n') || '(empty workbook)';
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n[...truncated]';
    res.json({ text, sheetCount: wb.worksheets.length });
  } catch (err) {
    res.status(400).json({ error: `Could not parse workbook: ${err.message}` });
  }
});

// ── Sanitize frontend messages into the {role, content} shape the LLM APIs
// expect. Drops UI-only fields (code, vba, ms, tok, time, via) and gives
// empty-content assistant turns (code/VBA-only replies) a short placeholder so
// strict providers don't reject a blank message. ──────────────────────────────
function sanitizeMessages(msgs) {
  return (msgs || []).map(m => {
    let content = m.content || '';
    if (!content.trim()) {
      if (m.code)      content = '[generated and ran Office JS code]';
      else if (m.vba)  content = '[generated a VBA macro]';
    }
    return { role: m.role, content };
  });
}

// ── Main chat route ──────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, workbookData, activeSheet, summary, model, useOllama, useGroq, apiKey, groqKey, options } = req.body;
  const pCfg = resolveProvider(req);

  const preferences   = options?.preferences   || '';
  const deepThink     = options?.deepThink     || false;
  const dynamicDepth  = options?.dynamicDepth  || false;
  const autoModel     = options?.autoModel     || false;
  const planFirst     = options?.plan          || false;
  const forceNoThink  = options?.noThink       || false;
  const forceThink    = options?.allowThink    || false;
  const pinnedMemory  = options?.pinnedMemory  || [];
  const coreMemory    = options?.coreMemory    || [];
  const systemPromptOverride = options?.systemPromptOverride || null;

  let maxTokens = 4096;
  let effectiveModel = model || null;
  let selectedModel = null;

  const rawUserMessage = messages[messages.length - 1]?.content || '';
  const recentMessages = sanitizeMessages(messages); // {role, content} only — drop UI fields

  // ── Auto-feedback: detect if user is unhappy with previous AI response ────
  const dissatisfaction = detectDissatisfaction(rawUserMessage, messages);
  if (dissatisfaction && messages.length >= 2) {
    const prevAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    const prevUser      = [...messages].reverse().filter(m => m.role === 'user')[1];
    if (prevAssistant && prevUser) {
      logAutoFeedback(dissatisfaction, prevUser.content, prevAssistant.content, prevAssistant.code || null, model || 'unknown');
    }
  }

  // ── Auto Model: AI selects the best model for this prompt ─────────────────
  if (autoModel && options?.availableModels?.length) {
    try {
      const { text: choice } = await callAI([
        { role: 'system', content: 'Select the best AI model for this task. JSON only: {"modelId":"id"}' },
        { role: 'user', content: `Task: "${rawUserMessage.slice(0, 300)}"\nPreferences: ${preferences || 'none'}\nCost limit: $${options.costLimit || 'unlimited'} per prompt\nModels:\n${options.availableModels.map(m=>`${m.id} $${m.in}/$${m.out}`).join('\n')}` }
      ], 60, null, false, false, apiKey || null, groqKey || null);
      const m = choice.replace(/<think>[\s\S]*?<\/think>/g,'').trim().match(/\{[\s\S]*?\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (parsed.modelId && options.availableModels.find(x => x.id === parsed.modelId)) {
          effectiveModel = parsed.modelId;
          selectedModel  = parsed.modelId;
        }
      }
    } catch {}
  }

  // ── Dynamic Depth: assess complexity, adjust token budget ─────────────────
  if (dynamicDepth) {
    try {
      const { text: assess } = await callAI([
        { role: 'system', content: 'Rate complexity 1-3: 1=simple, 2=moderate, 3=complex. JSON: {"level":1|2|3}' },
        { role: 'user', content: rawUserMessage.slice(0, 300) }
      ], 30, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
      const m = assess.match(/\{[\s\S]*?\}/);
      const level = m ? (JSON.parse(m[0]).level || 2) : 2;
      maxTokens = level >= 3 ? 8192 : level === 1 ? 2048 : 4096;
    } catch {}
  }

  // ── Deep Think: enhance the prompt before sending ─────────────────────────
  if (deepThink) {
    const lastUserIdx = recentMessages.map(m=>m.role).lastIndexOf('user');
    if (lastUserIdx !== -1) {
      try {
        const orig = recentMessages[lastUserIdx].content;
        const { text: enhanced } = await callAI([
          { role: 'system', content: 'You are a prompt engineer for an Excel AI assistant. Rewrite the user\'s request to be maximally clear, precise, and complete. Preserve intent exactly. Add explicit handling for edge cases (empty cells, merged cells, missing columns). Reference specific column names if visible in context. Output ONLY the rewritten prompt.' },
          { role: 'user', content: `Workbook context (headers + first rows):\n${(workbookData||'').slice(0,2000)}\n\nOriginal request: ${orig}` }
        ], 700, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
        const enhancedText = enhanced.replace(/<think>[\s\S]*?<\/think>/g,'').trim();
        recentMessages[lastUserIdx] = { ...recentMessages[lastUserIdx], content: enhancedText };
        maxTokens = Math.max(maxTokens, 8192);
      } catch {}
    }
  }

  // ── Plan First: ask AI to outline steps before executing ─────────────────
  let planText = null;
  if (planFirst && !isQuestion(rawUserMessage)) {
    try {
      const prefsSection_ = preferences ? `\n\nUSER PREFERENCES:\n${preferences}` : '';
      const contextMessages_ = workbookData ? [
        { role: 'user', content: `Here is the current state of the workbook.\n\nActive sheet: ${activeSheet}\n\n${workbookData}` },
        { role: 'assistant', content: 'I can see the full workbook. What would you like me to do?' }
      ] : [];
      const { text: planReply } = await callAI([
        { role: 'system', content: SYSTEM_PROMPT + prefsSection_ + '\n\nIMPORTANT: The user has requested a plan. Do NOT output any CODE_JS block. Instead, write a short numbered plan (3-5 steps max) describing what you will do. Be concise.' },
        ...contextMessages_,
        { role: 'user', content: `Before executing, give me a brief plan for: ${rawUserMessage}` }
      ], 512, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
      planText = planReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    } catch {}
  }

  // ── Code reminder ─────────────────────────────────────────────────────────
  const lastIdx = recentMessages.map(m=>m.role).lastIndexOf('user');
  if (lastIdx !== -1) {
    recentMessages[lastIdx] = {
      ...recentMessages[lastIdx],
      content: recentMessages[lastIdx].content + '\n\n[REMINDER: If making changes, output a CODE_JS block with Office JS code. Do not skip it.]'
    };
  }

  const prefsSection = preferences ? `\n\nUSER PREFERENCES (always follow these):\n${preferences}` : '';

  // Token budget: estimate tokens from all parts, truncate workbook data if needed
  const MAX_CONTEXT_TOKENS = 200000;
  const CHARS_PER_TOKEN = 3.5;
  const systemTokens = Math.ceil(SYSTEM_PROMPT.length / CHARS_PER_TOKEN);
  const messageTokens = Math.ceil(recentMessages.reduce((s, m) => s + (m.content || '').length, 0) / CHARS_PER_TOKEN);
  const summaryTokens = summary ? Math.ceil(summary.length / CHARS_PER_TOKEN) : 0;
  const overhead = systemTokens + messageTokens + summaryTokens + maxTokens + 2000;
  const wbBudgetTokens = Math.max(10000, MAX_CONTEXT_TOKENS - overhead);
  const wbBudgetChars = Math.floor(wbBudgetTokens * CHARS_PER_TOKEN);

  let trimmedWbData = workbookData || '';
  if (trimmedWbData.length > wbBudgetChars) {
    trimmedWbData = trimmedWbData.slice(0, wbBudgetChars) + '\n\n[...workbook data truncated to fit context window. Ask me to look at specific sheets/ranges if needed.]';
  }

  const contextMessages = trimmedWbData ? [
    { role: 'user', content: `Here is the current state of the workbook (last synced before this message).\n\nActive sheet: ${activeSheet}\n\n${trimmedWbData}` },
    { role: 'assistant', content: 'I can see the full workbook. What would you like me to do?' }
  ] : [];

  const summaryMessages = summary ? [
    { role: 'user', content: `CONVERSATION HISTORY (what we've done so far in this chat):\n\n${summary}\n\nUse this context to understand what has already been done and what the user is referring to. The workbook data below shows the CURRENT state after all these changes.` },
    { role: 'assistant', content: 'I have the full context of our conversation — I know what we\'ve done, which sheets and columns were modified, and the current state of the workbook. I\'ll continue from here.' }
  ] : [];

  const allMemoryItems = [
    ...pinnedMemory.map(p => p.text || p),
    ...coreMemory
  ].filter(Boolean);
  const memorySection = allMemoryItems.length
    ? '\n\nPERMANENT MEMORY — always remember and follow these throughout the conversation:\n'
      + allMemoryItems.map(m => `• ${m}`).join('\n')
    : '';

  const _allSkills = readSkills(uid(req));
  const _skillsSection = _allSkills.length
    ? '\n\nTRAINED SKILLS — the user has taught you the following. Apply them when relevant:\n'
      + _allSkills.map(s => {
        let entry = `• [${s.type}] ${s.title}: ${s.content}`;
        if (s.examples?.length) entry += '\n  Examples:\n' + s.examples.map(ex => `    User: ${ex.input}\n    You: ${ex.output}`).join('\n');
        return entry;
      }).join('\n')
    : '';
  let systemContent = systemPromptOverride || (SYSTEM_PROMPT + prefsSection + memorySection + _skillsSection);
  if (!systemPromptOverride) {
    if (planText) systemContent += `\n\nYour plan for this request was:\n${planText}\nFollow this plan exactly.`;
  }
  if (forceNoThink && !systemContent.includes('/no_think')) systemContent += '\n/no_think';
  if (forceThink) systemContent += '__ALLOW_THINK__';

  const allMessages = systemPromptOverride
    ? [{ role: 'system', content: systemContent }, ...recentMessages]
    : [{ role: 'system', content: systemContent }, ...contextMessages, ...summaryMessages, ...recentMessages];

  try {
    let { text: responseText, usage } = await callAI(allMessages, maxTokens, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null, pCfg);
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    if (!responseText.includes('VBA_MACRO::') && modelForgotCode(responseText, rawUserMessage)) {
      console.log('[server] Model forgot CODE_JS — retrying...');
      const { text: retryText } = await callAI([
        ...allMessages,
        { role: 'assistant', content: responseText },
        { role: 'user', content: 'You forgot the CODE_JS block. Output ONLY the CODE_JS block now. Start with CODE_JS:: and end with ::END_CODE.' }
      ], 2048, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
      const retryClean = retryText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const { code: retryCode } = parseResponse(retryClean);
      if (retryCode) {
        const { cleaned } = parseResponse(responseText);
        return res.json({ response: cleaned, code: retryCode, usage, selectedModel, danger: analyzeDanger(retryCode) });
      }
    }

    const { code, vba, cleaned } = parseResponse(responseText);
    if (code) console.log('[server] Code to execute:\n' + code);
    if (vba) console.log('[server] VBA macro generated:\n' + vba);
    const danger = analyzeDanger(code);
    if (danger) console.log(`[server] Danger classified: ${danger.level} — ${danger.reason}`);
    res.json({ response: cleaned, code, vba, usage, selectedModel, plan: planText, danger });

  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: `AI error: ${err.message}` });
  }
});

// ── Streaming chat route ─────────────────────────────────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const { messages, workbookData, activeSheet, summary, model, useOllama, useGroq, apiKey, groqKey, options } = req.body;
  const pCfg = resolveProvider(req);

  const preferences  = options?.preferences  || '';
  const deepThink    = options?.deepThink    || false;
  const dynamicDepth = options?.dynamicDepth || false;
  const autoModel    = options?.autoModel    || false;
  const planFirst    = options?.plan         || false;
  const forceNoThink = options?.noThink      || false;
  const forceThink   = options?.allowThink   || false;
  const pinnedMemory = options?.pinnedMemory || [];
  const coreMemory   = options?.coreMemory   || [];

  let maxTokens = 4096;
  let effectiveModel = model || null;
  let selectedModel  = null;

  const rawUserMessage = messages[messages.length - 1]?.content || '';
  const recentMessages = sanitizeMessages(messages);

  const dissatisfaction = detectDissatisfaction(rawUserMessage, messages);
  if (dissatisfaction && messages.length >= 2) {
    const prevAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    const prevUser      = [...messages].reverse().filter(m => m.role === 'user')[1];
    if (prevAssistant && prevUser)
      logAutoFeedback(dissatisfaction, prevUser.content, prevAssistant.content, prevAssistant.code || null, model || 'unknown');
  }

  if (autoModel && options?.availableModels?.length) {
    try {
      const { text: choice } = await callAI([
        { role: 'system', content: 'Select the best AI model for this task. JSON only: {"modelId":"id"}' },
        { role: 'user', content: `Task: "${rawUserMessage.slice(0, 300)}"\nModels:\n${options.availableModels.map(m=>`${m.id} $${m.in}/$${m.out}`).join('\n')}` }
      ], 60, null, false, false, apiKey || null, groqKey || null);
      const m = choice.replace(/<think>[\s\S]*?<\/think>/g,'').trim().match(/\{[\s\S]*?\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (parsed.modelId && options.availableModels.find(x => x.id === parsed.modelId)) {
          effectiveModel = parsed.modelId; selectedModel = parsed.modelId;
        }
      }
    } catch {}
  }

  if (dynamicDepth) {
    try {
      const { text: assess } = await callAI([
        { role: 'system', content: 'Rate complexity 1-3: 1=simple, 2=moderate, 3=complex. JSON: {"level":1|2|3}' },
        { role: 'user', content: rawUserMessage.slice(0, 300) }
      ], 30, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
      const m = assess.match(/\{[\s\S]*?\}/);
      const level = m ? (JSON.parse(m[0]).level || 2) : 2;
      maxTokens = level >= 3 ? 8192 : level === 1 ? 2048 : 4096;
    } catch {}
  }

  // Start SSE early so agent events can stream
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const sse = (data) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  // Abort signal for client disconnect
  let clientAborted = false;
  req.on('close', () => { clientAborted = true; });

  // ── Deep Think: multi-stage agent pipeline ──────────────────────────────
  let agentResults = null;
  if (deepThink) {
    const lastUserIdx = recentMessages.map(m=>m.role).lastIndexOf('user');
    if (lastUserIdx !== -1) {
      const orig = recentMessages[lastUserIdx].content;
      const wbSnippet = (workbookData||'').slice(0, 3000);
      const aiCall = (msgs, tok) => callAI(msgs, tok, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
      const clean = t => t.replace(/<think>[\s\S]*?<\/think>/g,'').trim();
      const wbContext = workbookData ? [
        { role: 'user', content: `Current workbook state:\n${wbSnippet}` },
        { role: 'assistant', content: 'I can see the workbook data.' }
      ] : [];

      // Agent runner with SSE events
      let _agentId = 0;
      const allAgents = [];
      function nextId() { return ++_agentId; }
      async function runOne(role, focus, prompt, priorContext, tokLimit, preId) {
        if (clientAborted) return { id: preId || 0, role, focus, status: 'aborted', result: 'Aborted', ms: 0, tok: null };
        const id = preId || nextId();
        const agent = { id, role, focus, status: 'running', result: null, ms: null, tok: null };
        allAgents.push(agent);
        sse({ type: 'agent_start', id, focus: `[${role}] ${focus}` });
        const t0 = Date.now();
        try {
          const { text, usage: u } = await aiCall([
            { role: 'system', content: prompt },
            ...wbContext,
            ...(priorContext ? [
              { role: 'user', content: `Context from prior stages:\n\n${priorContext}` },
              { role: 'assistant', content: 'Understood. I will build on this.' }
            ] : []),
            { role: 'user', content: orig }
          ], tokLimit || 2048);
          agent.result = clean(text); agent.ms = Date.now() - t0; agent.tok = u?.completion_tokens || null; agent.status = 'done';
          sse({ type: 'agent_done', id, focus: `[${role}] ${focus}`, ms: agent.ms, tok: agent.tok });
          return agent;
        } catch (e) {
          agent.result = `Error: ${e.message}`; agent.ms = Date.now() - t0; agent.status = 'error';
          sse({ type: 'agent_done', id, focus: `[${role}] ${focus}`, ms: agent.ms, error: e.message });
          return agent;
        }
      }
      async function runMany(tasks) { return Promise.all(tasks.map(t => runOne(t.role, t.focus, t.prompt, t.ctx || '', t.tok, t.id))); }
      function fmt(agents) { return agents.filter(a=>a.status==='done').map(a=>`[${a.role.toUpperCase()}: ${a.focus}]\n${a.result}`).join('\n\n---\n\n'); }

      try {
        // ═══════════════════════════════════════════════════════════════════
        //  PHASE 1 — ORCHESTRATOR: analyze task, decide pipeline shape
        // ═══════════════════════════════════════════════════════════════════
        const { text: orchRaw } = await aiCall([
          { role: 'system', content: `You are the master orchestrator for an Excel AI agent pipeline. Analyze the task complexity and decide the pipeline configuration.

The pipeline has 6 stages. You decide HOW MANY agents run in each stage.

STAGE 1 — COUNCIL (diverse perspectives on the problem):
  Roles: "business_analyst", "technical_analyst", "ux_thinker", "devil_advocate", "domain_expert"
  Each examines the problem from their unique angle. They do NOT write code.

STAGE 2 — SPECIALISTS (implementation):
  Roles: "architect", "coder", "formatter", "formula_expert", "chart_expert", "data_expert", "perf_optimizer", "error_handler"
  They receive the council's unified understanding and produce code/solutions.

STAGE 3 — JURY (review gates):
  Roles: "code_reviewer", "security_auditor", "edge_case_tester", "api_compliance"
  Each independently reviews the specialists' output. They vote pass/fail.

STAGE 4 — DOCUMENTATION:
  Roles: "documenter"
  Produces a clear summary of what the code does, any assumptions, and limitations.

STAGE 5 — EXECUTIONER (final gate):
  Roles: "executioner"
  Tries to break everything. If they find ANY issue, they either send it back with fix instructions or reject entirely.

STAGE 6 — SYNTHESIS:
  Handled automatically — merges all findings into the final response.

Output JSON ONLY:
{
  "enhanced_prompt": "rewritten request referencing specific columns/sheets",
  "complexity": 1|2|3,
  "council": [{"role":"...", "focus":"what this member examines"}],
  "specialists": [{"role":"...", "focus":"what this specialist produces"}],
  "jury": [{"role":"...", "focus":"what this juror checks"}]
}

RULES:
- complexity 1: skip pipeline entirely, just enhance prompt. For trivial tasks (reading a cell, asking a question).
- complexity 2 (moderate): 2-3 council, 2-3 specialists (must include coder), 1-2 jury. ~6-8 agents total.
- complexity 3 (complex): 3-5 council, 3-5 specialists, 2-3 jury. ~10-14 agents total.
- Always include at least "coder" in specialists and "code_reviewer" in jury.
- The documenter and executioner always run (don't list them — they're automatic).
- Pick council/specialist/jury members that are RELEVANT to the specific task. Don't add chart_expert for a sorting task.` },
          { role: 'user', content: `Workbook:\n${wbSnippet}\n\nRequest: ${orig}` }
        ], 1200);

        const orchClean = clean(orchRaw);
        const orchMatch = orchClean.match(/\{[\s\S]*\}/);
        if (orchMatch) {
          const orch = JSON.parse(orchMatch[0]);
          recentMessages[lastUserIdx] = { ...recentMessages[lastUserIdx], content: orch.enhanced_prompt || orig };
          maxTokens = Math.max(maxTokens, 8192);

          const council = orch.council || [];
          const specialists = orch.specialists || [];
          const jury = orch.jury || [];

          if (council.length + specialists.length >= 2) {
            // Pre-assign IDs for all agents so agents_start matches agent_start events
            let idCounter = 0;
            const councilIds = council.map(() => ++idCounter);
            const specIds = specialists.map(() => ++idCounter);
            const juryIds = jury.map(() => ++idCounter);
            const docId = ++idCounter;
            const execId = ++idCounter;
            const totalAgents = idCounter;
            _agentId = 0; // reset so runOne's nextId() won't be used — we pass preId

            sse({ type: 'agents_start', total: totalAgents, subtasks: [
              ...council.map((c,i) => ({ id: councilIds[i], focus: `[council:${c.role}] ${c.focus}` })),
              ...specialists.map((s,i) => ({ id: specIds[i], focus: `[specialist:${s.role}] ${s.focus}` })),
              ...jury.map((j,i) => ({ id: juryIds[i], focus: `[jury:${j.role}] ${j.focus}` })),
              { id: docId, focus: '[documenter] Summary' },
              { id: execId, focus: '[executioner] Final gate' },
            ]});

            // ═══════════════════════════════════════════════════════
            //  STAGE 1 — COUNCIL: diverse perspectives (parallel)
            // ═══════════════════════════════════════════════════════
            const COUNCIL_PROMPTS = {
              business_analyst: `You are a BUSINESS ANALYST on the council. Examine this Excel task from a business perspective. What is the user actually trying to accomplish? What business logic is implied? What assumptions about the data should be validated? Are there business rules that should be enforced? Focus on the WHAT and WHY, not the HOW.`,
              technical_analyst: `You are a TECHNICAL ANALYST on the council. Examine the workbook structure: data types, ranges, formulas, formatting patterns, sheet relationships. Identify technical constraints: row/column limits, performance concerns with large datasets, API limitations. Map out exactly what data exists and how it's organized.`,
              ux_thinker: `You are a UX THINKER on the council. Consider: will the output be clear and useful to the user? Should results go on a new sheet or modify existing data? What about formatting — headers, colors, number formats? Would a chart or summary be helpful? Think about what the user will SEE after the code runs.`,
              devil_advocate: `You are the DEVIL'S ADVOCATE on the council. Your job is to find problems BEFORE they happen. What could go wrong? What if the data is messy — empty cells, wrong types, duplicates, special characters? What if the sheet structure changes? What if there are 100,000 rows? Challenge every assumption the other council members might make.`,
              domain_expert: `You are a DOMAIN EXPERT on the council (Excel/spreadsheet specialist). What's the best practice for this type of task in Excel? Are there native Excel features (tables, pivot tables, conditional formatting, named ranges) that would be better than raw code? What patterns do Excel power users use? Suggest the most idiomatic Excel approach.`,
            };
            const councilResults = await runMany(council.map((c,i) => ({
              id: councilIds[i], role: `council:${c.role}`, focus: c.focus,
              prompt: COUNCIL_PROMPTS[c.role] || COUNCIL_PROMPTS.technical_analyst,
            })));
            const councilSummary = fmt(councilResults);

            if (clientAborted) { sse({ type: 'agents_done', total: allAgents.length }); return res.end(); }
            // ═══════════════════════════════════════════════════════
            //  STAGE 2 — SPECIALISTS: implementation (parallel)
            // ═══════════════════════════════════════════════════════
            const SPEC_PROMPTS = {
              architect: `You are the ARCHITECT. Based on the council's analysis, design the code structure:\n- What operations in what order\n- What variables and data structures needed\n- How to handle edge cases identified by the council\n- Whether to use helpers or raw API calls\nOutput a detailed pseudocode plan. Do NOT write actual code.`,
              coder: `${SYSTEM_PROMPT}\n\nYou are the PRIMARY CODER. Write the complete Office JS code. Output a single CODE_JS block.\n- Use helper functions where possible\n- Every .load() MUST be followed by await context.sync()\n- Handle edge cases: empty data, 0 rows, missing columns\n- Use .values (2D array) for bulk operations\n- Keep code clean and well-structured\n- This code MUST work on the first try`,
              formatter: `${SYSTEM_PROMPT}\n\nYou are the FORMATTING SPECIALIST. Write a CODE_JS block that handles ONLY visual formatting:\n- Header styling (bold, background color, font color)\n- Number formats (currency, percentages, dates)\n- Column auto-fit widths\n- Borders and alignment\n- Conditional formatting where appropriate\nYour code will be MERGED into the main code block.`,
              formula_expert: `${SYSTEM_PROMPT}\n\nYou are the FORMULA EXPERT. If this task involves formulas:\n- Write the optimal Excel formulas\n- Use CODE_JS to set .formulas or .formulasR1C1\n- Prefer dynamic array formulas where supported\n- Consider VLOOKUP vs INDEX/MATCH vs XLOOKUP\nIf no formulas needed, just say "No formulas required for this task."`,
              chart_expert: `${SYSTEM_PROMPT}\n\nYou are the CHART EXPERT. If visualization would help:\n- Write CODE_JS to create an appropriate chart\n- Set title, legend, axis labels, data range\n- Choose the right chart type for the data\n- Position and size the chart appropriately\nIf no chart needed, say "No chart needed for this task."`,
              data_expert: `${SYSTEM_PROMPT}\n\nYou are the DATA OPERATIONS EXPERT. Handle:\n- Sorting, filtering, deduplication\n- Data transformations (text-to-columns, type conversion)\n- Aggregations (sum, average, count by group)\n- Pivot table creation via createPivotTable helper\nWrite CODE_JS if your expertise is needed.`,
              perf_optimizer: `You are the PERFORMANCE OPTIMIZER. Review the approach for performance:\n- Minimize context.sync() calls (batch operations)\n- Use .values arrays for bulk reads/writes instead of cell-by-cell\n- Watch for N+1 patterns (loop with sync inside)\n- Consider large dataset handling (>10k rows)\nOutput specific optimization recommendations.`,
              error_handler: `You are the ERROR HANDLING SPECIALIST. Design the error handling strategy:\n- What try/catch blocks are needed\n- What to do when a sheet/column doesn't exist\n- How to handle type mismatches\n- What validation to run before operations\n- What error messages to throw for the user\nOutput specific error handling code snippets.`,
            };
            const specResults = await runMany(specialists.map((s,i) => ({
              id: specIds[i], role: `specialist:${s.role}`, focus: s.focus,
              prompt: SPEC_PROMPTS[s.role] || SPEC_PROMPTS.coder,
              ctx: councilSummary,
              tok: s.role === 'coder' ? 4096 : 2048,
            })));
            const specSummary = fmt(specResults);
            const allPrior = councilSummary + '\n\n===\n\n' + specSummary;

            if (clientAborted) { sse({ type: 'agents_done', total: allAgents.length }); return res.end(); }
            // ═══════════════════════════════════════════════════════
            //  STAGE 3 — JURY: independent reviews (parallel)
            // ═══════════════════════════════════════════════════════
            const JURY_PROMPTS = {
              code_reviewer: `You are a CODE REVIEWER on the jury. Examine the code from the specialists. Check for:\n- Missing await context.sync() after .load()\n- Off-by-one errors in ranges\n- Wrong property names (.values not .value for ranges)\n- Missing .load() before reading properties\n- Hardcoded values that should be dynamic\n- Unused variables or dead code\n- Logic errors\n\nOutput JSON: {"verdict":"pass"|"fail","bugs":[{"issue":"...","fix":"..."}],"fixed_code":"corrected CODE_JS if verdict=fail"}`,
              security_auditor: `You are a SECURITY AUDITOR on the jury. Check the code for:\n- Injection risks (formula injection via user data)\n- Data exposure (writing sensitive data to wrong sheets)\n- Destructive operations without guards (deleting sheets/data)\n- Overwriting existing data without backup\n- Unbounded operations that could hang Excel\n\nOutput JSON: {"verdict":"pass"|"fail","concerns":[{"severity":"high"|"medium"|"low","issue":"...","mitigation":"..."}]}`,
              edge_case_tester: `You are an EDGE CASE TESTER on the jury. Think of every scenario that could break the code:\n- Empty worksheet (0 data rows)\n- Single row of data\n- Column headers with spaces/special chars\n- Cells with formulas vs values\n- Hidden rows or existing filters\n- Mixed data types in columns\n- Very large datasets (50k+ rows)\n- Sheet names with special characters\n\nOutput JSON: {"verdict":"pass"|"fail","cases":[{"scenario":"...","expected":"...","actual":"what the code would do","fix":"..."}]}`,
              api_compliance: `You are an API COMPLIANCE CHECKER. Verify the code uses only:\n- ExcelApi 1.1 through 1.17 (Excel Online compatible)\n- No deprecated APIs\n- No desktop-only APIs (no COM, no ActiveX)\n- Correct use of context.sync() patterns\n- Proper use of .load() with specific properties\n- No unsupported features in the add-in sandbox\n\nOutput JSON: {"verdict":"pass"|"fail","issues":[{"api":"...","problem":"...","alternative":"..."}]}`,
            };
            const juryResults = await runMany(jury.map((j,i) => ({
              id: juryIds[i], role: `jury:${j.role}`, focus: j.focus,
              prompt: JURY_PROMPTS[j.role] || JURY_PROMPTS.code_reviewer,
              ctx: allPrior,
            })));
            const jurySummary = fmt(juryResults);

            // Collect jury verdicts
            let juryFails = [];
            let juryFixedCode = null;
            for (const j of juryResults) {
              if (j.status !== 'done') continue;
              try {
                const m = j.result.match(/\{[\s\S]*\}/);
                if (m) {
                  const v = JSON.parse(m[0]);
                  if (v.verdict === 'fail') {
                    juryFails.push(j.role);
                    if (v.fixed_code && !juryFixedCode) juryFixedCode = v.fixed_code;
                  }
                }
              } catch {}
            }

            // ═══════════════════════════════════════════════════════
            //  STAGE 4 — DOCUMENTER
            // ═══════════════════════════════════════════════════════
            if (clientAborted) { sse({ type: 'agents_done', total: allAgents.length }); return res.end(); }
            const docResult = await runOne('documenter', 'Summary & documentation',
              `You are the DOCUMENTER. Produce a brief, clear summary:\n1. What the code does (2-3 sentences)\n2. Key assumptions made\n3. Edge cases handled\n4. Any limitations or caveats\n5. What the user should see after execution\nKeep it concise — this goes directly to the user.`,
              councilSummary + '\n\n' + specSummary, 1024, docId);

            // ═══════════════════════════════════════════════════════
            //  STAGE 5 — EXECUTIONER: final gate
            // ═══════════════════════════════════════════════════════
            const allContext = councilSummary + '\n\n===\n\n' + specSummary + '\n\n===\n\n' + jurySummary
              + (juryFails.length ? `\n\n⚠ JURY FAILURES: ${juryFails.join(', ')}` : '')
              + (juryFixedCode ? `\n\nJURY CORRECTED CODE:\n${juryFixedCode}` : '');

            const execResult = await runOne('executioner', 'Final gate',
              `You are the EXECUTIONER — the final quality gate. Your job is to try to BREAK this solution.

You receive all council analysis, specialist implementations, jury reviews, and documentation.

DO THIS:
1. Read the code carefully line by line
2. Mentally trace execution with the actual workbook data
3. Check if jury concerns were addressed
4. Verify the code actually solves what the user asked for
5. Check for subtle bugs the jury might have missed

OUTPUT JSON:
{
  "decision": "approve" | "revise" | "reject",
  "confidence": 1-10,
  "issues": [{"severity":"critical"|"major"|"minor", "description":"...", "fix":"..."}],
  "final_code": "if decision=revise, the corrected and complete CODE_JS block. if approve, copy the best code as-is.",
  "notes": "brief note to the user about what was changed or verified"
}

RULES:
- "approve": code is correct, efficient, handles edge cases. Ship it.
- "revise": fixable issues found. You MUST provide the corrected code in final_code.
- "reject": fundamentally flawed approach. Explain why so the synthesizer can start fresh.
- Be thorough but fair. Don't reject over style — only correctness matters.
- If the jury found bugs and provided fixed code, verify THAT code, not the original.`,
              allContext, 4096, execId);

            sse({ type: 'agents_done', total: allAgents.length });

            // Parse executioner decision
            let execDecision = 'approve', execCode = null, execNotes = '';
            try {
              const em = execResult.result.match(/\{[\s\S]*\}/);
              if (em) {
                const ev = JSON.parse(em[0]);
                execDecision = ev.decision || 'approve';
                execCode = ev.final_code || null;
                execNotes = ev.notes || '';
              }
            } catch {}

            // ═══════════════════════════════════════════════════════
            //  STAGE 6 — SYNTHESIS: inject everything for final AI
            // ═══════════════════════════════════════════════════════
            const pipelineReport = [
              `COUNCIL ANALYSIS (${councilResults.length} members):\n${councilSummary}`,
              `SPECIALIST IMPLEMENTATIONS (${specResults.length} specialists):\n${specSummary}`,
              `JURY REVIEWS (${juryResults.length} jurors, ${juryFails.length} failures):\n${jurySummary}`,
              `DOCUMENTATION:\n${docResult.result || ''}`,
              `EXECUTIONER (decision: ${execDecision.toUpperCase()}, confidence: ${execResult.result?.match(/"confidence":\s*(\d+)/)?.[1] || '?'}/10):\n${execResult.result || ''}`,
            ].join('\n\n════════════════════════════════════\n\n');

            agentResults = allAgents;

            const bestCode = execCode || juryFixedCode || null;
            recentMessages[lastUserIdx] = {
              ...recentMessages[lastUserIdx],
              content: recentMessages[lastUserIdx].content +
                `\n\nAGENT PIPELINE REPORT (${allAgents.length} agents across 5 stages):\n\n${pipelineReport}` +
                (bestCode ? `\n\n✅ APPROVED CODE (use this exactly):\n${bestCode}` : '') +
                (execDecision === 'reject' ? `\n\n❌ EXECUTIONER REJECTED — write a new solution from scratch addressing: ${execNotes}` : '') +
                `\n\nINSTRUCTIONS: Produce ONE final response for the user. Use the executioner's approved/revised code if available. Include a brief explanation of what was done. Output a SINGLE CODE_JS block. The documenter's summary can inform your explanation. Quality was verified by ${juryResults.length} jurors and the executioner.`
            };
          }
        }
      } catch {
        try {
          const { text: enhanced } = await aiCall([
            { role: 'system', content: 'Rewrite this Excel request to be maximally clear and precise. Reference specific columns/sheets from the workbook data. Output ONLY the rewritten prompt.' },
            { role: 'user', content: `Workbook context:\n${wbSnippet}\n\nOriginal request: ${orig}` }
          ], 700);
          recentMessages[lastUserIdx] = { ...recentMessages[lastUserIdx], content: clean(enhanced) };
        } catch {}
        maxTokens = Math.max(maxTokens, 8192);
      }
    }
  }

  // ── Plan First: generate plan for user approval ─────────────────────────
  let planText = null;
  if (planFirst && !isQuestion(rawUserMessage)) {
    try {
      const prefsSection_ = preferences ? `\n\nUSER PREFERENCES:\n${preferences}` : '';
      const contextMessages_ = workbookData ? [
        { role: 'user', content: `Here is the current state of the workbook.\n\nActive sheet: ${activeSheet}\n\n${workbookData}` },
        { role: 'assistant', content: 'I can see the full workbook. What would you like me to do?' }
      ] : [];
      const { text: planReply } = await callAI([
        { role: 'system', content: SYSTEM_PROMPT + prefsSection_ + '\n\nIMPORTANT: Output a short numbered plan (3-5 steps). No CODE_JS block. Be specific about which columns, sheets, and ranges you will modify.' },
        ...contextMessages_,
        ...(summary ? [{ role: 'user', content: `Conversation context: ${summary}` }, { role: 'assistant', content: 'Got it.' }] : []),
        { role: 'user', content: `Before executing, give me a brief plan for: ${rawUserMessage}` }
      ], 512, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
      planText = planReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    } catch {}
  }

  const lastIdx = recentMessages.map(m=>m.role).lastIndexOf('user');
  if (lastIdx !== -1) recentMessages[lastIdx] = { ...recentMessages[lastIdx],
    content: recentMessages[lastIdx].content + '\n\n[REMINDER: If making changes, output a CODE_JS block with Office JS code. Do not skip it.]' };

  const prefsSection = preferences ? `\n\nUSER PREFERENCES (always follow these):\n${preferences}` : '';
  const MAX_CONTEXT_TOKENS = 200000, CHARS_PER_TOKEN = 3.5;
  const overhead = Math.ceil((SYSTEM_PROMPT.length + recentMessages.reduce((s,m)=>s+(m.content||'').length,0) + (summary||'').length) / CHARS_PER_TOKEN) + maxTokens + 2000;
  const wbBudgetChars = Math.floor(Math.max(10000, MAX_CONTEXT_TOKENS - overhead) * CHARS_PER_TOKEN);
  let trimmedWbData = workbookData || '';
  if (trimmedWbData.length > wbBudgetChars) trimmedWbData = trimmedWbData.slice(0, wbBudgetChars) + '\n\n[...workbook data truncated to fit context window.]';

  const contextMessages = trimmedWbData ? [
    { role: 'user', content: `Here is the current state of the workbook (last synced before this message).\n\nActive sheet: ${activeSheet}\n\n${trimmedWbData}` },
    { role: 'assistant', content: 'I can see the full workbook. What would you like me to do?' }
  ] : [];
  const summaryMessages = summary ? [
    { role: 'user', content: `CONVERSATION HISTORY (what we've done so far in this chat):\n\n${summary}\n\nUse this context to understand what has already been done and what the user is referring to. The workbook data below shows the CURRENT state after all these changes.` },
    { role: 'assistant', content: 'I have the full context of our conversation — I know what we\'ve done, which sheets and columns were modified, and the current state of the workbook. I\'ll continue from here.' }
  ] : [];
  const allMemoryItems = [...pinnedMemory.map(p => p.text || p), ...coreMemory].filter(Boolean);
  const memorySection = allMemoryItems.length
    ? '\n\nPERMANENT MEMORY — always remember and follow these throughout the conversation:\n' + allMemoryItems.map(m=>`• ${m}`).join('\n')
    : '';
  const _allSkills = readSkills(uid(req));
  const _skillsSection = _allSkills.length
    ? '\n\nTRAINED SKILLS — the user has taught you the following. Apply them when relevant:\n'
      + _allSkills.map(s => {
        let entry = `• [${s.type}] ${s.title}: ${s.content}`;
        if (s.examples?.length) entry += '\n  Examples:\n' + s.examples.map(ex => `    User: ${ex.input}\n    You: ${ex.output}`).join('\n');
        return entry;
      }).join('\n')
    : '';
  let systemContent = SYSTEM_PROMPT + prefsSection + memorySection + _skillsSection;
  if (planText) systemContent += `\n\nYour plan for this request was:\n${planText}\nFollow this plan exactly.`;
  if (forceNoThink && !systemContent.includes('/no_think')) systemContent += '\n/no_think';
  if (forceThink) systemContent += '__ALLOW_THINK__';
  const allMessages = [{ role: 'system', content: systemContent }, ...contextMessages, ...summaryMessages, ...recentMessages];

  if (planText) sse({ type: 'plan', text: planText });

  // ── Think-tag parser: routes tokens to 'think' or 'token' SSE events ─────
  let tBuf = '', inThink = false, answerBuf = '';

  function feedToken(tok) {
    tBuf += tok;
    while (tBuf.length > 0) {
      if (!inThink) {
        const i = tBuf.indexOf('<think>');
        if (i === -1) {
          const safe = Math.max(0, tBuf.length - 6);
          if (safe > 0) { sse({ type: 'token', token: tBuf.slice(0, safe) }); answerBuf += tBuf.slice(0, safe); tBuf = tBuf.slice(safe); }
          break;
        }
        if (i > 0) { sse({ type: 'token', token: tBuf.slice(0, i) }); answerBuf += tBuf.slice(0, i); }
        tBuf = tBuf.slice(i + 7); inThink = true;
      } else {
        const i = tBuf.indexOf('</think>');
        if (i === -1) {
          const safe = Math.max(0, tBuf.length - 8);
          if (safe > 0) { sse({ type: 'think', token: tBuf.slice(0, safe) }); tBuf = tBuf.slice(safe); }
          break;
        }
        if (i > 0) sse({ type: 'think', token: tBuf.slice(0, i) });
        tBuf = tBuf.slice(i + 8); inThink = false;
        sse({ type: 'think_end' });
      }
    }
  }

  let finalUsage = null;
  try {
    for await (const { token, usage: u } of streamAI(allMessages, maxTokens, effectiveModel, pCfg)) {
      if (res.writableEnded) break;
      if (u) finalUsage = u;
      if (token) feedToken(token);
    }
    // Flush remaining buffer
    if (tBuf) { if (inThink) sse({ type: 'think', token: tBuf }); else { sse({ type: 'token', token: tBuf }); answerBuf += tBuf; } }

    const { code, vba, cleaned } = parseResponse(answerBuf);
    let finalCode = code;
    if (!vba && modelForgotCode(answerBuf, rawUserMessage)) {
      try {
        const { text: retryText } = await callAI([
          ...allMessages,
          { role: 'assistant', content: answerBuf },
          { role: 'user', content: 'You forgot the CODE_JS block. Output ONLY the CODE_JS block now. Start with CODE_JS:: and end with ::END_CODE.' }
        ], 2048, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
        const { code: rc } = parseResponse(retryText.replace(/<think>[\s\S]*?<\/think>/g,'').trim());
        if (rc) finalCode = rc;
      } catch {}
    }

    const danger = analyzeDanger(finalCode);
    if (danger) console.log(`[server] Danger classified: ${danger.level} — ${danger.reason}`);
    sse({ type: 'done', code: finalCode, vba, cleaned, usage: finalUsage, selectedModel, plan: planText, danger, agents: agentResults ? agentResults.length : 0 });
    res.end();
  } catch (err) {
    sse({ type: 'error', message: err.message });
    res.end();
  }
});

// ── Auth config (sends public Supabase keys to frontend) ─────────────────────
app.get('/api/auth/config', (req, res) => {
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL     || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
  });
});


// OAuth callback — Supabase redirects here after social sign-in
// Store tokens server-side so the add-in (different webview) can poll for them
let _pendingAuthTokens = null;
let _pendingAuthExpiry = 0;

app.get('/auth/callback', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Signing in…</title></head><body>
    <p>Signing in… you can close this window.</p>
    <script>
      var hash = window.location.hash;
      // Try postMessage to opener first (same-context popup flow)
      var sent = false;
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'supabase-auth-callback', hash: hash }, window.location.origin);
          sent = true;
          setTimeout(function(){ window.close(); }, 500);
        }
      } catch(e) {}
      // Always store tokens on server as fallback (for cross-context flows like Excel add-in)
      if (hash && hash.includes('access_token')) {
        fetch('/api/auth/pending-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hash: hash })
        }).then(function() {
          if (!sent) {
            document.body.innerHTML = '<p style="font-family:sans-serif;text-align:center;margin-top:40px">Signed in! You can close this tab and return to Excel.</p>';
          }
        });
      }
    <\/script>
    </body></html>`);
});

app.post('/api/auth/pending-token', (req, res) => {
  _pendingAuthTokens = req.body.hash || null;
  _pendingAuthExpiry = Date.now() + 120000; // expires in 2 minutes
  res.json({ ok: true });
});

app.get('/api/auth/pending-token', (req, res) => {
  if (_pendingAuthTokens && Date.now() < _pendingAuthExpiry) {
    const hash = _pendingAuthTokens;
    _pendingAuthTokens = null; // consume once
    res.json({ hash });
  } else {
    res.json({ hash: null });
  }
});

// ── App version endpoint (used by Electron updater UI) ───────────────────────
app.get('/api/app/version', (req, res) => {
  res.json({ version: process.env.EXCEL_AI_APP_VERSION || require('./package.json').version, electron: !!process.versions.electron });
});

function startServer(opts = {}) {
  const certDir  = opts.certDir || DEV_CERTS_DIR;
  const keyPath  = path.join(certDir, 'localhost.key');
  const certPath = path.join(certDir, 'localhost.crt');
  let serverPems;
  try {
    serverPems = { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
  } catch {
    // No cert found — generate a self-signed one so `npm start` works out of the box
    // instead of crashing. Excel still needs a TRUSTED cert to load the pane (see message below).
    console.log('No localhost cert found — generating a self-signed one at ' + certDir);
    const pems = require('selfsigned').generate(
      [{ name: 'commonName', value: 'localhost' }],
      { keySize: 2048, days: 365, algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames: [
          { type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }] }
    );
    try {
      fs.mkdirSync(certDir, { recursive: true });
      fs.writeFileSync(keyPath, pems.private);
      fs.writeFileSync(certPath, pems.cert);
    } catch (e) { console.warn('Could not save generated cert (' + e.message + ') — using it in memory only.'); }
    serverPems = { key: pems.private, cert: pems.cert };
    console.log('⚠  This cert is self-signed and NOT trusted by your OS/Excel yet.');
    console.log('   For Excel to load the add-in, run:  npx office-addin-dev-certs install');
  }
  const server = https.createServer(serverPems, app);
  server.listen(3000, () => {
    console.log('Excel AI Assistant running at https://localhost:3000');
    console.log(`Mode: ${USE_OPENROUTER ? 'OpenRouter' : USE_MLX ? 'MLX' : USE_GROQ ? 'Groq' : 'Ollama'}`);
    console.log(`Default model: ${DEFAULT_MODEL}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, app };
