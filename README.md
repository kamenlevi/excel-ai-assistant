# Excel AI Assistant

A Microsoft Excel task pane add-in that lets you control your spreadsheet using plain English. Powered by any LLM via OpenRouter, Groq, or a local model (Ollama/MLX).

## What it does

Type a message like _"filter the Status column to Active"_ or _"make the headers bold with a green background"_ and the AI writes and executes the Office JS code directly inside Excel — no copy-pasting, no manual steps.

**Supported operations:**
- Filter columns by value
- Sort by any column
- Format cells, ranges, and headers
- Add charts
- Write formulas
- Copy/move data
- Conditional formatting
- VBA macro generation (shown as code, run with Alt+F11)

## Requirements

- Node.js 18+
- Microsoft Excel (desktop or online)
- An [OpenRouter](https://openrouter.ai) API key (free tier works)

## Installation

```bash
git clone https://github.com/your-username/excel-ai-assistant
cd excel-ai-assistant
npm install
```

Copy the example env file and add your key:

```bash
cp .env.example .env
```

Edit `.env`:

```
OPENROUTER_KEY=sk-or-v1-...
```

## Running

```bash
npm start
```

The server starts at `https://localhost:3000`. Because it uses a self-signed certificate, you need to trust it once:

1. Open `https://localhost:3000` in your browser
2. Click **Advanced → Proceed to localhost**

## Sideloading into Excel

1. Open Excel
2. Go to **Insert → Add-ins → My Add-ins**
3. Click **Upload My Add-in**
4. Select `manifest.xml` from this folder
5. The AI Assistant panel will open on the right

## Configuration

Edit the config block at the top of `server.js`:

```js
const USE_OPENROUTER = true;   // OpenRouter (default)
const USE_MLX        = false;  // Local MLX server (Mac)
const USE_GROQ       = false;  // Groq

const MODEL = USE_OPENROUTER
  ? 'google/gemini-2.0-flash-001'   // change to any OpenRouter model
  : ...
```

**Recommended free models on OpenRouter:**
- `google/gemini-2.0-flash-001` — fast, free, great at code
- `meta-llama/llama-3.3-70b-instruct:free` — solid alternative

## Project structure

```
├── server.js          # Express server, AI proxy, prompt logic
├── manifest.xml       # Office add-in manifest
├── public/
│   └── index.html     # Task pane UI (chat interface + Office JS execution)
├── .env               # Your API keys (never committed)
├── .env.example       # Key names without values
└── package.json
```

## How it works

1. When the task pane loads, it reads the entire workbook and keeps a live sync via Office JS change listeners
2. Your message + the workbook snapshot are sent to the AI
3. The AI responds with a plain-English sentence and a `CODE_JS::...::END_CODE` block
4. The frontend executes that code directly inside `Excel.run()` — changes appear instantly
5. If execution fails, it automatically retries with the error message

## Automated eval & improvement

An LLM-based test suite lives in `eval/`. It sends realistic prompts to the live API, scores the responses 0–10, and compares against the previous run.

```bash
npm run eval
```

Results are saved to `eval/results/<timestamp>.json`. A scheduled Claude Code session reads these, finds regressions, improves the system prompt or helpers, and commits the changes automatically. See [`eval/ROUTINE.md`](eval/ROUTINE.md) for the full routine prompt.

### Latest eval scores

| Category | Score |
|---|---|
| Filtering | — |
| Sorting | — |
| Formatting | — |
| Formulas | — |
| Question handling | — |
| Charts | — |
| Data manipulation | — |
| Conditional formatting | — |
| Edge cases | — |

*Run `npm run eval` to populate.*

## License

MIT
