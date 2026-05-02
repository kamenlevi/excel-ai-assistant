require('dotenv').config();
const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const selfsigned = require('selfsigned');
const fetch   = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

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
used.sort.apply([{ key: 2, ascending: false }]);
await context.sync();
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

OTHER RULES:
- Be concise. One short sentence explaining what you're doing, then the CODE_JS block.
- Never tell the user to do something manually that you can do via code.
- If a requested column does not exist, throw a clear error: throw new Error("Column 'X' not found. Check the column name and try again.");
- For VBA macros: write complete code in triple backtick vba blocks and tell the user to press Alt+F11.
- Only skip CODE_JS if the user is purely asking a question with no changes needed.`
+ (DEFAULT_MODEL.toLowerCase().includes('qwen') ? '\n/no_think' : '')
+ (() => {
    try {
      const imp = fs.readFileSync(path.join(__dirname, 'eval/improvements.txt'), 'utf8').trim();
      return imp ? '\n\nADDITIONAL RULES FROM EVAL:\n' + imp : '';
    } catch { return ''; }
  })();

// ── Call the AI ───────────────────────────────────────────────────────────────
async function callAI(messages, maxTokens = 4096, model = null, useOllama = false, useGroq = false, apiKey = null, groqKey = null) {
  const effectiveModel = model || DEFAULT_MODEL;
  const orKey  = apiKey  || OPENROUTER_KEY;
  const gKey   = groqKey || GROQ_KEY;

  if (useOllama) {
    const res = await fetch(`http://localhost:${OLLAMA_PORT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: effectiveModel, messages, stream: false,
        options: { num_ctx: 4096, temperature: 0.15, top_p: 0.9, repeat_penalty: 1.1 }
      })
    });
    const data = await res.json();
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
    const res = await fetch(`http://${MACBOOK_IP}:${MLX_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: effectiveModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.15,
        top_p: 0.9
      })
    });
    const data = await res.json();
    return { text: data.choices[0].message.content, usage: data.usage || null };
  }

  // Fallback: Ollama on MacBook
  const res = await fetch(`http://${MACBOOK_IP}:${OLLAMA_PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3:32b', messages, stream: false,
      options: { num_ctx: 4096, temperature: 0.15, top_p: 0.9, repeat_penalty: 1.1 }
    })
  });
  const data = await res.json();
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
  const questionStarters = ['why ', 'explain', 'tell me', 'describe', 'can you explain', 'can you tell', 'what does', 'what is a ', 'what are the', 'how do i', 'how does', 'what is vlookup', 'what is pivot', 'what is a', 'is there ', 'are there ', 'does excel'];
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

// ── Feedback endpoint ────────────────────────────────────────────────────────
app.post("/api/feedback", (req, res) => {
  const entry = req.body;
  const filePath = path.join(__dirname, "feedback.jsonl");
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(filePath, line);
  console.log("[feedback] Saved entry for prompt:", entry.prompt?.slice(0, 60));
  res.json({ ok: true });
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

  const contextMessages = workbookData ? [
    { role: 'user', content: `Here is the current state of the workbook (last synced before this message).\n\nActive sheet: ${activeSheet}\n\n${workbookData}` },
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
