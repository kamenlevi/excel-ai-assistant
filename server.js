require('dotenv').config();
const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const selfsigned = require('selfsigned');
const fetch   = require('node-fetch');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems  = selfsigned.generate(attrs, { days: 365, keySize: 2048 });

// ── CONFIG ────────────────────────────────────────────────────────────────────
const MACBOOK_IP     = '192.168.1.206';
const MLX_PORT       = '8080';
const OLLAMA_PORT    = '11434';

const USE_OPENROUTER = true;
const USE_MLX        = false;
const USE_GROQ       = false;

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const GROQ_KEY       = process.env.GROQ_KEY;

const MODEL = USE_OPENROUTER
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
- Pivot tables cannot be created via Office JS. Write VBA instead and tell the user to press Alt+F11.
- Keep code simple and direct. No unnecessary abstractions.
- NEVER use console.log in your code.

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

READING DATA — when the user asks you to find, count, sum, or report information FROM the spreadsheet, generate code that reads it and returns the answer as a string. The system will display the return value directly in the chat.

User: "how many deposits and what is their total?"
Response:
Let me read the data now.
CODE_JS::
const sheet = workbook.worksheets.getActiveWorksheet();
const used = sheet.getUsedRange();
used.load("values");
await context.sync();
const rows = used.values.slice(1);
const deposits = rows.filter(r => String(r[2]).toLowerCase().includes("deposit"));
const total = deposits.reduce((sum, r) => sum + (Number(r[3]) || 0), 0);
return `Found ${deposits.length} deposits totalling $${total.toFixed(2)}.`;
::END_CODE

OTHER RULES:
- Be concise. One short sentence explaining what you're doing, then the CODE_JS block.
- Never tell the user to do something manually that you can do via code.
- For VBA macros: write complete code in triple backtick vba blocks and tell the user to press Alt+F11.
- Only skip CODE_JS if the user is purely asking a question with no changes needed.`
+ (MODEL.toLowerCase().includes('qwen') ? '\n/no_think' : '')
+ (() => {
    try {
      const imp = fs.readFileSync(path.join(__dirname, 'eval/improvements.txt'), 'utf8').trim();
      return imp ? '\n\nADDITIONAL RULES FROM EVAL:\n' + imp : '';
    } catch { return ''; }
  })();

// ── Call the AI ───────────────────────────────────────────────────────────────
async function callAI(messages, maxTokens = 4096) {
  if (USE_OPENROUTER) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://localhost:3000',
        'X-Title': 'Excel AI Assistant'
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.15,
        top_p: 0.9
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.choices[0].message.content;
  }

  if (USE_GROQ) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: maxTokens,
        temperature: 0.15,
        top_p: 0.9
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content;
  }

  if (USE_MLX) {
    const res = await fetch(`http://${MACBOOK_IP}:${MLX_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.15,
        top_p: 0.9
      })
    });
    const data = await res.json();
    return data.choices[0].message.content;
  } else {
    const res = await fetch(`http://${MACBOOK_IP}:${OLLAMA_PORT}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3:32b', messages, stream: false,
        options: { num_ctx: 4096, temperature: 0.15, top_p: 0.9, repeat_penalty: 1.1 }
      })
    });
    const data = await res.json();
    return data.message.content;
  }
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
  if (s.endsWith('?')) return true;
  const starters = ['what ', 'why ', 'how ', 'when ', 'where ', 'which ', 'who ', 'explain', 'tell me', 'describe', 'can you explain', 'can you tell', 'what is', 'what are'];
  return starters.some(q => s.startsWith(q));
}

function modelForgotCode(responseText, userMessage) {
  if (responseText.includes('CODE_JS::')) return false;
  return !isQuestion(userMessage);
}

// ── Feedback endpoint ────────────────────────────────────────────────────────
app.post("/api/feedback", (req, res) => {
  const entry = req.body;
  const filePath = path.join(__dirname, "feedback.jsonl");
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(filePath, line);
  console.log("[feedback] Saved entry for prompt:", entry.prompt?.slice(0, 60));
  res.json({ ok: true });
});

// ── Summarize endpoint ───────────────────────────────────────────────────────
app.post('/api/summarize', async (req, res) => {
  const { messages } = req.body;
  try {
    const text = await callAI([
      {
        role: 'system',
        content: 'You summarise Excel assistant conversations. Write one short paragraph (max 80 words) covering: what sheets exist, what data they contain, what changes were made, any important cell ranges or values. Be specific. No fluff.'
      },
      {
        role: 'user',
        content: `Summarise:\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n\n')}`
      }
    ], 200);
    res.json({ summary: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim() });
  } catch (err) {
    res.status(500).json({ error: 'Summarization failed' });
  }
});

// ── Main chat route ──────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, workbookData, activeSheet, summary } = req.body;

  const recentMessages = messages.slice(-6);

  // Inject reminder into the last user message
  if (recentMessages.length > 0) {
    const last = recentMessages[recentMessages.length - 1];
    if (last.role === 'user') {
      recentMessages[recentMessages.length - 1] = {
        role: 'user',
        content: last.content + '\n\n[REMINDER: If making changes, output a CODE_JS block with Office JS code. Do not skip it.]'
      };
    }
  }

  const contextMessages = workbookData ? [
    {
      role: 'user',
      content: `Here is the current state of the workbook (last synced before this message).\n\nActive sheet: ${activeSheet}\n\n${workbookData}`
    },
    {
      role: 'assistant',
      content: 'I can see the full workbook. What would you like me to do?'
    }
  ] : [];

  const summaryMessages = summary ? [
    {
      role: 'user',
      content: `Earlier in this session: ${summary}`
    },
    {
      role: 'assistant',
      content: 'Got it, I have the context of what we did earlier.'
    }
  ] : [];

  const allMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...contextMessages,
    ...summaryMessages,
    ...recentMessages
  ];

  const rawUserMessage = messages[messages.length - 1]?.content || '';

  try {
    let responseText = await callAI(allMessages);
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // Auto-retry if model forgot the code block for a non-question request
    if (modelForgotCode(responseText, rawUserMessage)) {
      console.log('[server] Model forgot CODE_JS — retrying...');
      const retryText = await callAI([
        ...allMessages,
        { role: 'assistant', content: responseText },
        { role: 'user', content: 'You forgot the CODE_JS block. Output ONLY the CODE_JS block now. Start with CODE_JS:: and end with ::END_CODE.' }
      ]);
      const retryClean = retryText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const { code: retryCode } = parseResponse(retryClean);
      if (retryCode) {
        console.log('[server] Retry code:\n' + retryCode);
        const { cleaned } = parseResponse(responseText);
        return res.json({ response: cleaned, code: retryCode });
      }
    }

    const { code, cleaned } = parseResponse(responseText);
    if (code) console.log('[server] Code to execute:\n' + code);
    res.json({ response: cleaned, code });

  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: `AI error: ${err.message}` });
  }
});

const server = https.createServer({ key: pems.private, cert: pems.cert }, app);
server.listen(3000, () => {
  console.log('Excel AI Assistant running at https://localhost:3000');
  console.log(`Mode: ${USE_OPENROUTER ? 'OpenRouter' : USE_MLX ? 'MLX' : USE_GROQ ? 'Groq' : 'Ollama'}`);
});
