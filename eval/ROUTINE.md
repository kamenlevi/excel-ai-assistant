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
This sends test prompts to the live Llama 3.3 70b API via OpenRouter and scores each
response 0–100. The budget hard limit is $0.50 — the script enforces this automatically.
The script also auto-patches `server.js` when categories fail (<70/100).

**6. Analyse results**
- Results are saved to `eval/results/<timestamp>.json`
- Compare to the previous run (the script prints deltas automatically)
- Note every test that scored below 70/100 and read WHY it failed

**7. Review auto-patch**
If the eval patched `server.js` (printed "SYSTEM PROMPT PATCHED"), review the change:
- Read the diff printed to stdout
- Verify it actually addresses the failures
- If it introduced anything wrong, fix it manually

**8. Update README scores table**
Update the "Latest eval scores" table in `README.md` with the scores from this run.

**9. Commit and push**
```
git add server.js eval/progress.json eval/generated-cases.json README.md
git commit -m "eval: $(date +%Y-%m-%d) — overall <X>/100, <brief summary of changes>"
git push
```

---

## What the eval tests

| Category | Level | What it checks |
|---|---|---|
| Filtering | 1+ | Uses `applyColumnFilter` helper, correct column name |
| Sorting | 1+ | Uses `sortByColumn` helper, correct direction |
| Formatting | 1+ | Generates valid format API calls |
| Formulas | 1+ | Correct formula syntax and cell references |
| Charts | 1+ | Uses `charts.add` correctly |
| Data manipulation | 1+ | `copyFrom`, `clear`, etc. |
| Conditional formatting | 1+ | Uses `conditionalFormats` API |
| Sheet operations | 1+ | `freezePanes`, `autofitColumns` |
| Question handling | 1+ | Does NOT generate code for pure questions |
| Edge cases | 1+ | Column not found → helpful error, not silent failure |

Each category advances to the next level when it averages 95+/100. Harder cases are
auto-generated when a level is mastered.

---

## Cost estimate per session

- ~19 test cases × ~1500 tokens in + ~400 tokens out = ~$0.004
- ~19 judge calls × ~800 tokens in + ~150 tokens out = ~$0.002
- Auto-patch generation (if needed) = ~$0.002
- **Total: ~$0.01–0.03 per session** (well under the $0.50 limit)
