# Excel AI Assistant

Office Add-in (TaskPaneApp) for Excel with AI-powered read/write access to workbooks. Also ships as an Electron desktop app that auto-generates certs, starts the server, and sideloads the manifest.

## Architecture
- **server.js** — Node.js/Express HTTPS server (localhost:3000) with self-signed certs, plus a plain-HTTP OAuth callback listener on 127.0.0.1:3001. Handles AI calls (OpenRouter/Groq/OpenAI/Anthropic/Google/Mistral/Together/MLX/Ollama/custom via `providerConfig`), streaming SSE chat with a multi-agent Deep Think pipeline, chat/skills/usage persistence (per-user dirs under `data/users/<id>`, keyed by `x-user-id` header), multi-workbook endpoints (exceljs), feedback/fine-tuning export, Supabase auth config + OAuth pending-token relay.
- **public/index.html** — Single-file frontend (HTML+CSS+JS). Runs inside Excel's task pane. Executes AI-generated CODE_JS blocks via Office JS API. Supabase auth (email/password + Google/Microsoft OAuth) and cross-device cloud sync of chats/skills (tables in docs/SETUP_AUTH.md).
- **electron/** — Desktop app wrapper: cert generation/trust, server boot, manifest sideload, tray, auto-updater (GitHub Releases).
- **eval/** — Automated eval harness (`npm run eval`). Auto-patches the system prompt between `EVAL-IMPROVEMENTS` markers in server.js; patches are validated (balanced delimiters, length cap) before being applied.
- **manifest.xml** — Office Add-in manifest.

## Key Patterns
- AI generates `CODE_JS::...::END_CODE` blocks that run inside `Excel.run()` with injected helper functions (applyColumnFilter, sortByColumn, createPivotTable, dedupeRows, multi-workbook helpers, …).
- External workbook operations use server-side `exceljs` (not Office JS), restricted to allowed directories.
- Three-tier feedback: human (1.0 weight), auto-hard (0.7), auto-soft (0.4).
- All `/api/*` calls from the frontend carry `x-user-id` when signed in; server stores data per user with one-time migration from shared files.
- Every provider request has a hard timeout (`PROVIDER_TIMEOUT_MS`); Anthropic requests hoist system messages to the top-level `system` param.

## Versioning Rules
- Current version: **v9.2.0** (defined as `APP_VERSION` in index.html; also keep `package.json` version in sync — the Electron updater compares against it).
- The `CHANGELOG` array in index.html stores all versions with date and summary.
- **After every commit**: bump `APP_VERSION`, sync `package.json` version, and add a new entry to the top of `CHANGELOG` with the current date and a summary of what changed.
- Version format: **x.y.z** — x = major feature/breaking change, y = medium feature/improvement, z = small fix/QoL.

## Running
```
npm install
npm start
```
Requires `~/.office-addin-dev-certs/` with localhost.crt and localhost.key (or set `EXCEL_AI_CERTS_DIR`).

## Testing
1. Start server: `npm start`
2. Sideload manifest.xml in Excel (Insert > My Add-ins > Upload)
3. Open the Excel AI task pane from the Home ribbon tab
- Server can be smoke-tested headless: set `EXCEL_AI_CERTS_DIR`/`EXCEL_AI_DATA_DIR`, then curl the API; point `providerConfig.endpoint` at a mock OpenAI-compatible server to test the chat pipeline without real keys.
