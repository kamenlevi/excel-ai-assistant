# Automated Improvement Routine

Use this as the prompt for a scheduled Claude Code session.

---

## Prompt

Open the project at `C:\Users\kamen\OneDrive\Desktop\ExcelAIv3`.

Do the following in order:

**1. Pull latest changes**
Run `git pull` to get the latest code.

**2. Security check**
Read `server.js` and `public/index.html`. Flag any of these:
- API keys or secrets hardcoded in source files (not in .env)
- User input passed unsanitised into eval or shell commands
- Any dependency in package.json with a known vulnerability (check with `npm audit`)
Fix anything you find and explain what you changed.

**3. Run the eval suite**
Run `npm run eval`. This sends ~16 test prompts to the live Llama 3.3 70b API
(using the OPENROUTER_KEY from .env) and scores each response 0–10.
Budget hard limit is $0.50 for the entire session — the script enforces this.

**4. Analyse results**
- Compare scores to the previous run (stored in eval/results/)
- List every test that scored below 7
- For each failure, read the generated code and understand WHY it failed
  (wrong API call, missing code block, wrong pattern, etc.)

**5. Improve**
Based on failures, make targeted changes to ONE OR MORE of:
- The `SYSTEM_PROMPT` in `server.js` — add a clearer rule or better example
- The helper functions in `public/index.html` — fix a bug or add a new helper
- `eval/cases.json` — add harder test cases if all current ones score 9–10

Rules for improvements:
- Only change what the evidence says is broken
- Do not touch formatting or working features
- After changing the system prompt, re-run ONLY the failing cases to verify improvement
  (use a small targeted script, not the full suite, to save API cost)

**6. Update README**
Add or update a "Latest eval scores" table in README.md with the scores from this session.

**7. Commit and push**
```
git add -A
git commit -m "eval: <date> — overall <score>/10, <summary of what changed>"
git push
```

---

## What the eval tests

| Category | Tier | What it checks |
|---|---|---|
| Filtering | 1 | Uses `applyColumnFilter` helper, correct column name |
| Sorting | 1 | Uses `sortByColumn` helper, correct direction |
| Formatting | 1 | Generates valid format API calls |
| Formulas | 1 | Correct formula syntax and cell references |
| Question handling | 1 | Does NOT generate code for pure questions |
| Charts | 2 | Uses `charts.add` correctly |
| Data manipulation | 2 | `copyFrom` and similar |
| Conditional formatting | 2 | Uses `conditionalFormats` API |
| Edge cases | 2 | Column not found → helpful error, not silent failure |

Tier 1 must be 9+/10 before focusing on Tier 2.
Once all cases score 9+/10 consistently, add new harder cases to `eval/cases.json`.

---

## Cost estimate per session

- 16 test cases × ~1500 tokens in + ~400 tokens out = ~$0.003
- 16 judge calls × ~800 tokens in + ~100 tokens out = ~$0.001
- Re-running 5 failing cases after fix = ~$0.001
- **Total: ~$0.005–0.02 per session** (well under the $0.50 limit)
