# Excel AI Assistant

Office Add-in (TaskPaneApp) for Excel with AI-powered read/write access to workbooks.

## Architecture
- **server.js** — Node.js/Express HTTPS server (localhost:3000) with self-signed certs. Handles AI calls (OpenRouter/Groq/MLX/Ollama), chat persistence, multi-workbook endpoints, feedback/fine-tuning.
- **public/index.html** — Single-file frontend (HTML+CSS+JS). Runs inside Excel's task pane. Executes AI-generated CODE_JS blocks via Office JS API.
- **manifest.xml** — Office Add-in manifest.

## Key Patterns
- AI generates `CODE_JS::...::END_CODE` blocks that run inside `Excel.run()` with injected helper functions.
- External workbook operations use server-side `exceljs` library (not Office JS).
- Three-tier feedback: human (1.0 weight), auto-hard (0.7), auto-soft (0.4).

## Versioning Rules
- Current version: **v4.0** (defined as `APP_VERSION` in index.html and in the settings footer).
- The `CHANGELOG` array in index.html stores all versions with date and summary.
- **After every commit**: bump the version in `APP_VERSION`, the `#versionLabel` default text, and add a new entry to the top of `CHANGELOG` with the current date and a one-line summary of what changed.
- Version format: major.minor (bump major for new features, minor for fixes).

## Running
```
npm install
npm start
```
Requires `~/.office-addin-dev-certs/` with localhost.crt and localhost.key.

## Testing
1. Start server: `npm start`
2. Sideload manifest.xml in Excel (Insert > My Add-ins > Upload)
3. Open the Excel AI task pane from the Home ribbon tab
