require('dotenv').config();
const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const selfsigned = require('selfsigned');
const fetch   = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');
const os = require('os');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── SSL cert — use office-addin-dev-certs (trusted by Excel desktop) ──
const DEV_CERTS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.office-addin-dev-certs');
const pems = {
  cert:    fs.readFileSync(path.join(DEV_CERTS_DIR, 'localhost.crt'), 'utf8'),
  private: fs.readFileSync(path.join(DEV_CERTS_DIR, 'localhost.key'), 'utf8'),
};

// ── Data dir for chat persistence ─────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const CHATS_FILE  = path.join(DATA_DIR, 'chats.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
function readChats() {
  try { return JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8')); } catch { return {}; }
}
function writeChats(chats) { fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2), 'utf8'); }

// ── CONFIG ────────────────────────────────────────────────────────────────────
const MACBOOK_IP     = '192.168.1.206';
const MLX_PORT       = '8080';
const OLLAMA_PORT    = '11434';

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
- Pivot tables: use context.workbook.worksheets to add a new sheet, then sheet.pivotTables.add(name, sourceRange, destinationCell) to create the pivot table. Use pivotTable.rowHierarchies, columnHierarchies, dataHierarchies, and filterHierarchies to configure fields.
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
- For VBA macros: write complete code in triple backtick vba blocks and tell the user to press Alt+F11.
- Only skip CODE_JS if the user is purely asking a question with no changes needed.

// EVAL-IMPROVEMENTS-START
When sorting, exclude the header row by using 'sheet.getRange("A2:A" + sheet.getLastRow())'.
'''javascript
const sheet = workbook.worksheets.getActiveWorksheet();
const range = sheet.getRange("A2:A" + sheet.getLastRow());
range.load("values");
await context.sync();
range.sort.apply({
  key: range,
  ascending: true
});
await context.sync();
'''
For column-specific sorting, use 'sheet.getRange(columnLetter + ":$" + columnLetter)' to sort by a specific column.
'''javascript
const columnLetter = "X";
const sheet = workbook.worksheets.getActiveWorksheet();
const range = sheet.getRange(columnLetter + ":$" + columnLetter);
range.load("values");
await context.sync();
range.sort.apply({
  key: range,
  ascending: true
});
await context.sync();
'''
When copying data, specify the destination range correctly using 'sheet.getRange("D1").getResize(sourceRange.rowCount, sourceRange.columnCount)'.
'''javascript
const sheet = workbook.worksheets.getActiveWorksheet();
const sourceRange = sheet.getRange("A:B");
const targetRange = sheet.getRange("D1").getResize(sourceRange.rowCount, sourceRange.columnCount);
sourceRange.copyFrom(targetRange, Excel.RangeCopyType.all, false, false);
await context.sync();
'''
For the VLOOKUP function, provide a clear description and example without including unnecessary code.
The VLOOKUP function looks up a value in a table and returns a value from another column.
When answering questions about functions, provide concrete examples and note potential caveats.
When counting rows with data in a specific column, use 'sheet.getRange(columnLetter + ":$" + columnLetter).getUsedRange().rowCount'.
'''javascript
const columnLetter = "A";
const sheet = workbook.worksheets.getActiveWorksheet();
const usedRange = sheet.getRange(columnLetter + ":$" + columnLetter).getUsedRange();
usedRange.load("rowCount");
await context.sync();
return "Found " + usedRange.rowCount + " rows with data in column " + columnLetter + ".";
'''
For filtering, use the correct API implementation with 'sheet.autoFilter.apply'.
'''javascript
const sheet = workbook.worksheets.getActiveWorksheet();
const range = sheet.getRange("A:A");
range.load("values");
await context.sync();
sheet.autoFilter.apply({
  range: range,
  criteria: {
    operator: Excel.FilterOperator.equals,
    values: ["Engineering"]
  }
});
await context.sync();
'''
When
// EVAL-IMPROVEMENTS-END
`
+ (DEFAULT_MODEL.toLowerCase().includes('qwen') ? '\n/no_think' : '');

// ── Call the AI ───────────────────────────────────────────────────────────────
function injectNoThink(messages, model) {
  if (!model.toLowerCase().includes('qwen')) return messages;
  return messages.map(m =>
    m.role === 'system' && !m.content.includes('/no_think')
      ? { ...m, content: m.content + '\n/no_think' }
      : m
  );
}

async function callAI(messages, maxTokens = 4096, model = null, useOllama = false, useGroq = false, apiKey = null, groqKey = null) {
  const effectiveModel = model || DEFAULT_MODEL;
  const orKey  = apiKey  || OPENROUTER_KEY;
  const gKey   = groqKey || GROQ_KEY;

  if (useOllama) {
    const msgsToSend = injectNoThink(messages, effectiveModel);
    const res = await fetch(`http://localhost:${OLLAMA_PORT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
      body: JSON.stringify({
        model: effectiveModel, messages: msgsToSend, stream: false,
        options: { num_ctx: 8192, num_predict: maxTokens, temperature: 0.15, top_p: 0.9, repeat_penalty: 1.1 }
      })
    });
    const data = await res.json();
    if (!data.message) throw new Error(data.error || 'Ollama returned no message — is the model loaded?');
    return { text: data.message.content, usage: null };
  }

  if (useGroq || USE_GROQ) {
    const groqModel = (useGroq && model) ? model : 'llama-3.3-70b-versatile';
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gKey}`
      },
      body: JSON.stringify({
        model: groqModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.15,
        top_p: 0.9
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { text: data.choices[0].message.content, usage: data.usage || null };
  }

  if (USE_OPENROUTER || orKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${orKey}`,
        'HTTP-Referer': 'https://localhost:3000',
        'X-Title': 'Excel AI Assistant'
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.15,
        top_p: 0.9
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return { text: data.choices[0].message.content, usage: data.usage || null };
  }

  if (USE_MLX) {
    const msgsToSend = injectNoThink(messages, effectiveModel);
    const res = await fetch(`http://${MACBOOK_IP}:${MLX_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
      body: JSON.stringify({
        model: effectiveModel,
        messages: msgsToSend,
        max_tokens: maxTokens,
        temperature: 0.15,
        top_p: 0.9
      })
    });
    const data = await res.json();
    if (!data.choices?.[0]?.message) throw new Error(data.error?.message || 'MLX returned no response');
    return { text: data.choices[0].message.content, usage: data.usage || null };
  }

  // Fallback: Ollama on MacBook
  const fallbackModel = 'qwen3:32b';
  const fallbackMsgs  = injectNoThink(messages, fallbackModel);
  const res = await fetch(`http://${MACBOOK_IP}:${OLLAMA_PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
    body: JSON.stringify({
      model: fallbackModel, messages: fallbackMsgs, stream: false,
      options: { num_ctx: 8192, num_predict: maxTokens, temperature: 0.15, top_p: 0.9, repeat_penalty: 1.1 }
    })
  });
  const data = await res.json();
  if (!data.message) throw new Error(data.error || 'Ollama returned no message — is the model loaded?');
  return { text: data.message.content, usage: null };
}

// ── Parse code from response ─────────────────────────────────────────────────
function parseResponse(text) {
  let code = null;
  const codeMatch = text.match(/CODE_JS::([\s\S]*?)::END_CODE/);
  if (codeMatch) {
    code = codeMatch[1].trim();
  }

  const cleaned = text
    .replace(/CODE_JS::[\s\S]*?::END_CODE/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();

  return { code, cleaned };
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

function modelForgotCode(responseText, userMessage) {
  if (responseText.includes('CODE_JS::')) return false;
  return !isQuestion(userMessage);
}

// ── Chat history endpoints ────────────────────────────────────────────────────
app.get('/api/chats', (req, res) => {
  const chats = readChats();
  const list = Object.values(chats)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(({ id, title, updatedAt, messageCount, totalTokens }) => ({ id, title, updatedAt, messageCount, totalTokens }));
  res.json(list);
});

app.post('/api/chats', (req, res) => {
  const chats = readChats();
  const id = uuidv4();
  const now = new Date().toISOString();
  chats[id] = { id, title: req.body.title || 'New Chat', messages: req.body.messages || [], summary: null, totalTokens: 0, messageCount: 0, createdAt: now, updatedAt: now };
  writeChats(chats);
  res.json(chats[id]);
});

app.get('/api/chats/:id', (req, res) => {
  const chats = readChats();
  const chat = chats[req.params.id];
  if (!chat) return res.status(404).json({ error: 'Not found' });
  res.json(chat);
});

app.patch('/api/chats/:id', (req, res) => {
  const chats = readChats();
  const chat = chats[req.params.id];
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const { title, messages, summary, totalTokens } = req.body;
  if (title !== undefined) chat.title = title;
  if (messages !== undefined) { chat.messages = messages; chat.messageCount = messages.length; }
  if (summary !== undefined) chat.summary = summary;
  if (totalTokens !== undefined) chat.totalTokens = totalTokens;
  chat.updatedAt = new Date().toISOString();
  writeChats(chats);
  res.json(chat);
});

app.delete('/api/chats/:id', (req, res) => {
  const chats = readChats();
  delete chats[req.params.id];
  writeChats(chats);
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
      const match = clean.match(/\{[\s\S]*\}/); // greedy — matches first { to last }
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
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
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
app.post('/api/summarize', async (req, res) => {
  const { messages, previousSummary, apiKey } = req.body;
  try {
    const prevContext = previousSummary ? `Previous context (already summarised):\n${previousSummary}\n\nNew messages to incorporate:\n` : 'Summarise:\n';
    const { text } = await callAI([
      {
        role: 'system',
        content: 'You summarise Excel assistant conversations. Write one short paragraph (max 100 words) covering: what sheets exist, what data they contain, what changes were made, any important cell ranges or values. If given a previous summary, merge it with the new messages into one updated summary. Be specific. No fluff.'
      },
      {
        role: 'user',
        content: `${prevContext}\n${messages.map(m => `${m.role}: ${m.content}`).join('\n\n')}`
      }
    ], 250, null, false, false, apiKey || null);
    res.json({ summary: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim() });
  } catch (err) {
    res.status(500).json({ error: 'Summarization failed' });
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
  const glob = require('path');
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

// ── Main chat route ──────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, workbookData, activeSheet, summary, model, useOllama, useGroq, apiKey, groqKey, options } = req.body;

  const preferences   = options?.preferences   || '';
  const deepThink     = options?.deepThink     || false;
  const dynamicDepth  = options?.dynamicDepth  || false;
  const autoModel     = options?.autoModel     || false;
  const planFirst     = options?.plan          || false;

  let maxTokens = 4096;
  let effectiveModel = model || null;
  let selectedModel = null;

  const rawUserMessage = messages[messages.length - 1]?.content || '';
  const recentMessages = messages.slice(-6).map(m => ({ ...m }));

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
      ], 30, null, false, false, apiKey || null, groqKey || null);
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
        ], 700, null, false, false, apiKey || null, groqKey || null);
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
    { role: 'user', content: `Earlier in this session: ${summary}` },
    { role: 'assistant', content: 'Got it, I have the context of what we did earlier.' }
  ] : [];

  const allMessages = [
    { role: 'system', content: SYSTEM_PROMPT + prefsSection },
    ...contextMessages,
    ...summaryMessages,
    ...recentMessages
  ];

  try {
    let { text: responseText, usage } = await callAI(allMessages, maxTokens, effectiveModel, useOllama || false, useGroq || false, apiKey || null, groqKey || null);
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    if (modelForgotCode(responseText, rawUserMessage)) {
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
        return res.json({ response: cleaned, code: retryCode, usage, selectedModel });
      }
    }

    const { code, cleaned } = parseResponse(responseText);
    if (code) console.log('[server] Code to execute:\n' + code);
    res.json({ response: cleaned, code, usage, selectedModel, plan: planText });

  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: `AI error: ${err.message}` });
  }
});

const server = https.createServer({ key: pems.private, cert: pems.cert }, app);
server.listen(3000, () => {
  console.log('Excel AI Assistant running at https://localhost:3000');
  console.log(`Mode: ${USE_OPENROUTER ? 'OpenRouter' : USE_MLX ? 'MLX' : USE_GROQ ? 'Groq' : 'Ollama'}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
});
