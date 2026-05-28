# Automated Improvement Routine

Use this as the prompt for a scheduled Claude Code session.

---

## Prompt

Do the following in order:

**1. Clone / pull the repo**
```
git clone https://github.com/kamenlevi/excel-ai-assistant.git
cd excel-ai-assistant
```
If the directory already exists, run `git pull` instead.

**2. Set the API key**
The `OPENROUTER_KEY` is stored as a GitHub repository secret named `OPENROUTER_KEY`.
Write it to `.env` so the eval script can read it:
```
echo "OPENROUTER_KEY=$OPENROUTER_KEY" > .env
```
(The environment variable is injected automatically from the GitHub secret.)

**3. Install dependencies**
```
npm install
```

**4. Security check**
Read `server.js` and `public/index.html`. Flag any of these:
- API keys or secrets hardcoded in source files (not in .env)
- User input passed unsanitised into eval or shell commands
Fix anything you find and explain what you changed.

**5. Run the eval suite**
```
npm run eval
```
This sends test prompts to the Llama 3.1 8B API via OpenRouter and scores each
response 0–100. The budget hard limit is $0.03 — the script enforces this automatically.
The script auto-patches `eval/improvements.txt` when categories fail (<70/100); those
improvements are appended to the system prompt in `server.js` at runtime.

**6. Analyse results**
- Results are saved to `eval/results/<timestamp>.json`
- Compare to the previous run (the script prints deltas automatically)
- Note every test that scored below 70/100 and read WHY it failed

**7. Review auto-patch**
If the eval patched `server.js` (printed "SYSTEM PROMPT PATCHED"), review the change:
- Read the diff printed to stdout
- Verify it actually addresses the failures
- If it introduced anything wrong, fix it manually

**8. Commit and push**
```
git add server.js public/ eval/progress.json eval/generated-cases.json eval/RESULTS.md eval/last-run.txt eval/results/
git commit -m "eval: $(date +%Y-%m-%d) — overall <X>/100, <brief summary of changes>"
git push
```

---

## What the eval tests

| Category | Level | What it checks |
|---|---|---|
| Filtering | 1+ | Uses `applyColumnFilter` / `clearFilters` helpers |
| Sorting | 1+ | Uses `sortByColumn` helper, correct direction |
| Formatting | 1+ | Generates valid format API calls |
| Formulas | 1+ | Correct formula syntax and cell references |
| Charts | 1+ | Uses `charts.add` correctly |
| Data manipulation | 1+ | `copyFrom`, `clear`, etc. |
| Conditional formatting | 1+ | Uses `conditionalFormats` API |
| Sheet operations | 1+ | `freezePanes`, `autofitColumns` |
| Question handling | 1+ | Does NOT generate code for pure questions |
| Edge cases | 1+ | Column not found → helpful error, not silent failure |
| Data validation | 1+ | Uses `dataValidation` API |
| Tables | 1+ | `tables.add`, `showTotals`, etc. |
| Named ranges | 1+ | Uses `names.add` correctly |
| Hyperlinks | 1+ | Sets `range.hyperlink` correctly |
| Comments | 1+ | Uses `comments.add` / `comments.delete` |
| Sparklines | 1+ | Uses sparkline group APIs |
| Page Layout | 1+ | Uses `pageLayout` / `pageSetup` APIs |
| Shapes | 1+ | Uses `shapes.addGeometricShape` etc. |

Each category advances to the next level when it averages 95+/100. Harder cases are
auto-generated when a level is mastered. Max 5 cases run per category per level.

---

## Cost estimate per session

- ~76 test cases × ~1500 tokens in + ~400 tokens out = ~$0.017
- ~76 judge calls × ~800 tokens in + ~150 tokens out = ~$0.008
- Auto-patch generation (if needed) = ~$0.002
- **Total: ~$0.002–0.005 per session** (well under the $0.03 limit)

Schedule: runs weekly (every Monday, ~4 runs/month) to keep total cost under $1/month across all 3 repos.
