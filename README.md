# Excel AI Assistant

A Microsoft Excel task-pane add-in that turns plain English into real spreadsheet actions. It runs entirely on your own machine, talks to whichever LLM you choose (OpenRouter, Groq, Ollama, or MLX), and has full read/write access to whatever workbook you have open.

> **Type:** _"filter Status to Active, sort by Date descending, and bold the headers"_ — it writes the Office JS code, runs it inside Excel, and shows you the result. No copy-paste, no macros.

---

## Table of contents

1. [What it can do](#what-it-can-do)
2. [How it works](#how-it-works)
3. [Requirements](#requirements)
4. [Installation — step by step](#installation--step-by-step)
5. [Where to put your API key](#where-to-put-your-api-key)
6. [Choosing a model / provider](#choosing-a-model--provider)
7. [Sideloading into Excel](#sideloading-into-excel)
8. [Slash commands](#slash-commands)
9. [Safety: the danger-confirmation system](#safety-the-danger-confirmation-system)
10. [Optional: cloud chat sync (Supabase)](#optional-cloud-chat-sync-supabase)
11. [Troubleshooting](#troubleshooting)
12. [FAQ](#faq)
13. [Project structure](#project-structure)
14. [Privacy](#privacy)
15. [License](#license)

---

## What it can do

### Spreadsheet actions (any current workbook)
- **Filter & sort** by any column, by header name (no need to know letters)
- **Format** cells, headers, ranges, conditional formatting, number formats (currency, %, dates)
- **Write formulas** — SUM, XLOOKUP, INDEX/MATCH, cross-sheet references, array formulas
- **Pivot Tables** built natively with Office JS — no VBA shim
- **Excel Tables (ListObjects)** — convert any range with one ask
- **Data cleaning** — dedupe rows, fill-down blanks, trim whitespace
- **Charts** — line, bar, pie, scatter, combo
- **Copy / move / transpose** ranges and sheets
- **VBA macro generation** for the things Office JS can't do
- **Read & explain formulas** already in the sheet
- **Multi-sheet operations** in one prompt

### Beyond the active workbook
- **Read other `.xlsx` / `.xlsm` files** on your computer by path (via the server-side ExcelJS engine)
- **Search workbooks** by filename or by cell content across folders you allow
- **Attach a workbook to chat** — drop an `.xlsx` in and the AI sees a compact "Cell:value" view of it
- **Open files in Excel** from the chat

### Productivity & quality-of-life
- **Undo button** on every change — restores formulas + number formats, deletes orphan sheets, clears cells added outside the original range
- **Streaming responses** with token-by-token output
- **"Plan First" mode** — see a written plan before any code runs
- **Auto Model** — the AI picks the cheapest/fastest model that can handle each prompt
- **Cost limits** — per-prompt or per-session ceilings; confirmation prompts when exceeded
- **Pinned memory** — facts about your work that persist across chats (e.g. "I work in EUR, fiscal year starts April")
- **Auto-extracted memory** — the assistant remembers preferences you imply
- **Chat history** — saved locally; optional cloud sync via Supabase
- **File attachments** — `.txt`, `.csv`, `.json`, `.md`, `.xlsx`, `.xlsm`
- **Light / dark theme**
- **Slash commands** for fast toggles — `/help`, `/clear`, `/set deep`, `/reset cost`, etc.

### Power-user
- **Fine-tune export** — every interaction with feedback is exported as JSONL ready for fine-tuning
- **Auto-eval pipeline** (GitHub Actions or local) — weekly regression tests against a benchmark of real Excel tasks
- **Three-tier feedback** — explicit thumbs (1.0 weight), auto-soft (0.4), auto-hard (0.7) when the AI fails or self-corrects

---

## How it works

```
   You type in the task pane
            │
            ▼
   Workbook snapshot + chat history
            │
            ▼
   Local Node server  ───►  LLM (OpenRouter / Groq / Ollama / MLX)
            │
            ▼
   Streaming reply with a CODE_JS block
            │
            ▼
   Frontend runs the code inside Excel.run()
            │
            ▼
   ✓ Done   +   ↩ Undo button (snapshot is restorable)
```

1. **The task pane reads the workbook on open** and stays in sync via Office JS change listeners.
2. **Your message + the workbook context are sent to the local server.** The server adds a system prompt that teaches the LLM the helper functions (`applyColumnFilter`, `createPivotTable`, `dedupeRows`, etc.).
3. **The LLM streams back** a plain-English reply and a `CODE_JS::…::END_CODE` block.
4. **Before running**, the server classifies the code (`null` / `high` / `critical` danger). High and critical actions require an in-pane confirmation.
5. **The frontend snapshots every sheet** (formulas + number formats + sheet names) and then executes the code inside `Excel.run()`.
6. **If it fails**, the server automatically retries with the error message included.
7. **An ↩ Undo button** is attached to every action — one click restores the snapshot exactly.

API keys never leave your machine. The local server is the only thing that talks to the LLM provider.

---

## Requirements

| What | Why |
|---|---|
| **Node.js 18+** | Runs the local server |
| **Microsoft Excel** | Desktop (Mac/Windows) or Excel on the Web |
| **An LLM key OR a local model** | OpenRouter has a free tier; Groq is free; Ollama is fully local |

That's it. No build step, no bundler, no Docker.

---

## Installation — step by step

### 1. Clone and install

```bash
git clone https://github.com/kamenlevi/excel-ai-assistant
cd excel-ai-assistant
npm install
```

### 2. Install the localhost SSL certificate

Excel will only load a task pane from `https://`. You need a trusted certificate for `localhost`. **Pick one of two paths:**

#### Path A — Microsoft's official dev cert tool (recommended, one command)

```bash
npx office-addin-dev-certs install
```

This drops `localhost.crt` and `localhost.key` into `~/.office-addin-dev-certs/` and adds the cert to your OS trust store. The server expects them at exactly that path. Done.

> On Windows the home folder is `C:\Users\<you>\.office-addin-dev-certs\`.

#### Path B — Generate your own self-signed cert

If you'd rather not use Microsoft's tool:

```bash
# 1. Create the folder the server looks in
mkdir -p ~/.office-addin-dev-certs

# 2. Generate a cert
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout ~/.office-addin-dev-certs/localhost.key \
  -out    ~/.office-addin-dev-certs/localhost.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# 3. Trust it
# macOS:
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain \
  ~/.office-addin-dev-certs/localhost.crt
# Windows (PowerShell as admin):
Import-Certificate -FilePath "$env:USERPROFILE\.office-addin-dev-certs\localhost.crt" \
  -CertStoreLocation Cert:\LocalMachine\Root
# Linux (Ubuntu/Debian):
sudo cp ~/.office-addin-dev-certs/localhost.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

### 3. (Optional) Set up your API key in `.env`

```bash
cp .env.example .env
```

Open `.env` and paste your key — see **[Where to put your API key](#where-to-put-your-api-key)** below.

> **You can skip this step** and paste your key into the in-app Settings panel after starting up. The `.env` route is just convenient if you want the same key available every time.

### 4. Start the server

```bash
npm start
```

You'll see `Server listening on https://localhost:3000`. Leave this terminal open while you use Excel.

### 5. Sideload the add-in into Excel

See **[Sideloading into Excel](#sideloading-into-excel)** below.

---

## Where to put your API key

You have **two equivalent paths**. Pick whichever fits your workflow.

### Path A — In-app Settings panel (no file editing)

1. Start the server (`npm start`).
2. Open the add-in in Excel.
3. Click the ⚙️ Settings tab in the task pane.
4. Paste your **OpenRouter** or **Groq** key into the matching field.
5. Saved automatically to your browser's localStorage; never touches disk on the server.

✅ Good for: quickly trying it out, sharing the install with someone else without sharing your key, switching keys often.

### Path B — `.env` file (server-wide default)

Copy the template and edit it:

```bash
cp .env.example .env
```

`.env`:
```env
OPENROUTER_KEY=sk-or-v1-your-actual-key-here
GROQ_KEY=gsk_your-actual-key-here
```

The server reads this on startup. **`.env` is gitignored** — it will never be committed.

✅ Good for: solo use on your own machine, always-on default, headless servers.

### Where to get keys (all free tiers available)

| Provider | Sign-up link | Free tier? |
|---|---|---|
| **OpenRouter** | https://openrouter.ai/keys | ✅ Yes — many models marked `:free` |
| **Groq** | https://console.groq.com/keys | ✅ Yes — very generous |
| **Ollama** | https://ollama.com | ✅ Free, runs locally — no key |
| **MLX** (Mac) | https://github.com/ml-explore/mlx-lm | ✅ Free, runs locally — no key |

**Order of precedence:** the in-app key (if set) wins over `.env`. So you can have a default in `.env` and override per-session in the UI.

---

## Choosing a model / provider

You can switch providers anytime from the **Settings → Provider** dropdown in the task pane. No server restart needed.

### OpenRouter (default — easiest)
- Hundreds of models behind one key
- Recommended free models:
  - `google/gemini-2.0-flash-001` — fast, free, great at code
  - `meta-llama/llama-3.3-70b-instruct:free` — solid fallback
- Recommended paid models for top quality:
  - `anthropic/claude-sonnet-4` — best Office-JS author
  - `openai/gpt-4o` — strong all-rounder

### Groq
- Free, but the fastest inference you'll find anywhere
- Set `GROQ_KEY` and pick a Groq-hosted model in Settings
- Great for the snappy "feel-like-magic" experience

### Ollama (fully local)
- Install Ollama, then `ollama pull qwen2.5-coder:32b`
- Set `OLLAMA_HOST=127.0.0.1` (default) in `.env` if Ollama is on the same machine, or e.g. `OLLAMA_HOST=192.168.1.50` if it runs on another computer on your LAN
- Toggle **"Use Ollama"** in Settings
- Zero network calls, zero cost, your data never leaves the box

### MLX (Mac, local, fast)
- For Apple Silicon — uses Metal for inference
- Run `mlx-lm-server` on the host, set `MLX_PORT` in `.env`

### Auto Model
Toggle **Auto Model** in Settings and the assistant routes each prompt to the cheapest model that's still capable for the task. Useful when you want quality on hard things and speed on easy ones, without thinking about it.

---

## Sideloading into Excel

### Excel desktop (Windows / Mac)

1. Open Excel with any workbook.
2. **Insert → Add-ins → My Add-ins → Upload My Add-in**.
3. Select `manifest.xml` from this folder.
4. The "Excel AI" button now lives on the **Home** ribbon — click it to open the task pane.

> Sideloading is per-user and persists across Excel restarts.

### Excel on the Web

1. Open a workbook in Excel for the Web.
2. **Insert → Office Add-ins → Upload My Add-in**.
3. Select `manifest.xml`.

### Quick test that it's wired up

Open the task pane and type:
```
read A1 and tell me what's there
```
If you get back a sentence with your cell value, every piece — cert, server, Office JS, LLM — is working.

---

## Slash commands

Type `/` in the chat input to see the full menu. The big ones:

| Command | Does |
|---|---|
| `/help` | Lists all commands |
| `/status` | Current model, toggles, cost, memory size |
| `/clear` | Clear chat history (this conversation only) |
| `/memory` | Show pinned + auto-extracted memory |
| `/set deep` | Toggle Deep Think — refines your prompt + max reasoning budget |
| `/set plan` | Toggle "Plan First" — shows the plan before executing |
| `/set auto` | Toggle Auto Model |
| `/set dynamic` | Toggle Dynamic Depth — AI picks its own reasoning budget |
| `/set no_think` / `/set think` / `/set auto_think` | Local-model thinking controls |
| `/set theme_light` / `/set theme_dark` | Theme |
| `/set code_show` / `/set code_hide` | Show or hide the generated code blocks |
| `/set sync_on` / `/set sync_off` | Workbook auto-sync on every message |
| `/set cost_prompt` / `/set cost_session` / `/set cost_off` | Cost-limit mode |
| `/reset cost` | Reset the session-cost counter |
| `/reset memory` | Wipe pinned + auto-extracted memory |
| `/reset prefs` | Clear the saved preferences text |
| `/think` / `/no_think` | Shortcuts for the matching `/set` |

---

## Safety: the danger-confirmation system

Some operations are irreversible (deleting files, running shell commands) or risky (bulk renames, drive-wide search). Every generated code block is classified before execution:

| Level | Examples | What happens |
|---|---|---|
| **(none)** | `applyColumnFilter`, format, sort, formula | Runs immediately |
| **High** | bulk file move, mkdir, recursive walk, drive-root search | Confirmation prompt — one-click "Yes, do it" / "Cancel" |
| **Critical** | file deletion, shell exec, `rm -rf`, server-side delete endpoint | Confirmation + (optional) password prompt |

You can set an optional **session password** in Settings — critical operations then require that password instead of just a confirmation. It's stored only in your browser, never on the server.

Plus: every workbook write is **snapshot + Undo**. Even if you confirm something you didn't mean to, one click brings the sheet back.

---

## Optional: cloud chat sync (Supabase)

Skip this section if you only use one machine.

1. Create a free Supabase project at https://supabase.com.
2. Enable email auth (or any provider you like).
3. Copy the **Project URL** and **anon key** from `Project Settings → API`.
4. Add them to `.env`:
   ```env
   SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
5. Restart the server. Sign in from the task pane's **Account** tab. Chats now sync.

> The anon key is **safe to expose in client code** — that's what it's designed for. Supabase enforces row-level security so each signed-in user only sees their own chats.

---

## Troubleshooting

### "Can't reach localhost:3000" inside Excel
- Is `npm start` running in a terminal?
- Did you install the localhost cert (Step 2)? Excel won't load an untrusted https origin.
- Open `https://localhost:3000` in your browser. If you see a cert warning there, the cert isn't trusted — re-run `npx office-addin-dev-certs install` or follow Path B above.

### "Cannot find module 'localhost.crt'"
Server can't find the cert files. They must be at:
- macOS / Linux: `~/.office-addin-dev-certs/localhost.crt` + `localhost.key`
- Windows: `C:\Users\<you>\.office-addin-dev-certs\localhost.crt` + `localhost.key`

Run `npx office-addin-dev-certs install` to create them.

### "OPENROUTER_KEY is not set"
Either:
- Add it to `.env` and restart, **or**
- Paste it into Settings → API Keys in the task pane (no restart needed).

### "401 Unauthorized" from OpenRouter / Groq
Your key is wrong, expired, or out of credits. Test it:
```bash
curl https://openrouter.ai/api/v1/auth/key -H "Authorization: Bearer $OPENROUTER_KEY"
```

### The add-in loads but nothing happens when I type
- Open the browser-style devtools: right-click inside the task pane → **Inspect**.
- Check the **Console** tab for errors.
- Check the **Network** tab — calls to `/api/chat` should return 200.

### Ollama is on another computer and not responding
Set `OLLAMA_HOST` in `.env` to that machine's LAN IP:
```env
OLLAMA_HOST=192.168.1.50
```
Make sure Ollama is bound to `0.0.0.0` on that machine (`OLLAMA_HOST=0.0.0.0 ollama serve`), not the default `127.0.0.1`.

### Undo button is missing
- Read-only operations ("how many active customers?") don't get an Undo button — there's nothing to undo.
- If your sheet has more than ~200k cells in the used range it isn't snapshotted (too large) — the button won't appear.

### "Bad headers / cert warning" in browser
Trust the cert (Step 2 again). Excel uses the same OS-level trust store as your browser.

### Excel says "This add-in could not be started"
- Make sure the server is running and reachable at `https://localhost:3000/index.html` in your browser.
- Re-upload `manifest.xml` (Insert → My Add-ins → Upload).

---

## FAQ

**Does my workbook data go to the LLM provider?**
The current workbook context (sheet names, headers, a sample of cells) plus your message go to whichever provider you've selected. If you want zero data egress, use **Ollama** or **MLX** — both run fully local.

**Are my API keys ever exposed?**
No. `.env` is gitignored. Keys you paste into the UI live in your browser's `localStorage` and are sent only to your own `localhost:3000` server.

**Can I use this with Excel on the Web?**
Yes — see [Sideloading into Excel](#sideloading-into-excel).

**Does it work on Mac?**
Yes — Excel for Mac, Excel for Windows, and Excel on the Web all work.

**What happens if the LLM generates bad code?**
The server retries automatically with the error message. If the retry also fails, you get a clear error in the chat and an auto-feedback signal goes into the fine-tune log so the prompt can be improved.

**Can I add custom helper functions?**
Yes — they're defined inside `execCode()` in `public/index.html` (look for the `Tier-2 power helpers` block). Add yours, then teach the LLM about it in the system prompt in `server.js`.

**How do I see what the AI actually did?**
Toggle **Show code** in Settings (or `/set code_show`) to see the generated `CODE_JS` block under every reply.

**Is there a way to share an install with my team?**
Each user runs their own local server and adds their own key. The add-in itself (manifest + this repo) can be shared freely — no secrets in it.

---

## Project structure

```
excel-ai-assistant/
├── server.js                    # Express HTTPS server: LLM proxy, prompts, helpers,
│                                # chat persistence, file/workbook endpoints,
│                                # danger classification, Supabase auth
├── public/
│   └── index.html               # Single-file task pane (HTML+CSS+JS).
│                                # Office.js code execution, chat UI, settings,
│                                # slash commands, snapshots/undo
├── manifest.xml                 # Office Add-in manifest (sideloaded into Excel)
├── eval/                        # Weekly self-improvement: runs benchmark prompts,
│                                # measures pass rate, can auto-tune the system prompt
│   ├── run.js
│   ├── watchdog.js              # Local fallback runner (Task Scheduler)
│   └── RESULTS.md               # Latest pass-rate report
├── .github/workflows/eval.yml   # Same eval, weekly via GitHub Actions
├── .env.example                 # Template for your keys
├── .env                         # YOUR keys (gitignored, never committed)
├── CLAUDE.md                    # Architecture notes for AI code assistants
└── package.json
```

---

## Privacy

- **API keys**: stored in `.env` (gitignored) or in your browser's `localStorage`. Never sent anywhere except the LLM provider you've selected.
- **Workbook data**: sent only to the LLM provider you've selected. Use Ollama / MLX for zero egress.
- **Chat history**: saved to `data/chats.json` on your machine. Optional Supabase sync if you set it up yourself.
- **Self-signed certificate**: stays in your home folder, trusted only on your own machine.
- **No telemetry, no analytics, no phone-home.** The server has no outbound calls other than to your chosen LLM provider.

---

## License

MIT
