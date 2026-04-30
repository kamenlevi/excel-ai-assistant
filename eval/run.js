#!/usr/bin/env node
/**
 * ExcelAI Eval Runner
 *
 * - Scores AI responses 0–100 using an LLM judge
 * - Tracks per-category levels in progress.json
 * - When a category averages >= 95, auto-generates harder cases for it
 * - When ALL categories hit 95, also generates cases for brand-new Excel domains
 * - Hard budget limit: $0.50 per session
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OPENROUTER_KEY   = process.env.OPENROUTER_KEY;
const MODEL            = 'meta-llama/llama-3.3-70b-instruct';
const JUDGE_MODEL      = 'meta-llama/llama-3.3-70b-instruct';
const COST_PER_1M_IN   = 0.07;
const COST_PER_1M_OUT  = 0.30;
const BUDGET_USD       = 0.50;
const MASTERY_THRESHOLD = 95;

const PATHS = {
  cases:     path.join(__dirname, 'cases.json'),
  generated: path.join(__dirname, 'generated-cases.json'),
  progress:  path.join(__dirname, 'progress.json'),
  results:   path.join(__dirname, 'results'),
};

if (!fs.existsSync(PATHS.results)) fs.mkdirSync(PATHS.results, { recursive: true });

// ── Cost tracking ─────────────────────────────────────────────────────────────
let totalCostUSD = 0;
function trackCost(inTok, outTok) {
  const c = (inTok / 1e6) * COST_PER_1M_IN + (outTok / 1e6) * COST_PER_1M_OUT;
  totalCostUSD += c;
  if (totalCostUSD > BUDGET_USD) throw new Error(`BUDGET_EXCEEDED: $${totalCostUSD.toFixed(4)} > $${BUDGET_USD}`);
}

// ── OpenRouter call ───────────────────────────────────────────────────────────
async function callLLM(messages, model = MODEL, maxTokens = 1024) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer':  'https://localhost:3000',
      'X-Title':       'ExcelAI Eval',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.1 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  const u = data.usage || {};
  trackCost(u.prompt_tokens || 600, u.completion_tokens || 250);
  return data.choices[0].message.content;
}

// ── Load files ────────────────────────────────────────────────────────────────
function loadCases() {
  const base = JSON.parse(fs.readFileSync(PATHS.cases, 'utf8'));
  const gen  = fs.existsSync(PATHS.generated)
    ? JSON.parse(fs.readFileSync(PATHS.generated, 'utf8'))
    : [];
  return [...base, ...gen];
}

function loadProgress() {
  if (!fs.existsSync(PATHS.progress)) return {};
  return JSON.parse(fs.readFileSync(PATHS.progress, 'utf8'));
}

function saveProgress(p) {
  fs.writeFileSync(PATHS.progress, JSON.stringify(p, null, 2));
}

function loadLastResults() {
  const files = fs.readdirSync(PATHS.results).filter(f => f.endsWith('.json')).sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(PATHS.results, files[files.length - 1]), 'utf8'));
}

// ── System prompt extractor ───────────────────────────────────────────────────
function loadSystemPrompt() {
  const src       = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const startMark = 'const SYSTEM_PROMPT = `';
  const startIdx  = src.indexOf(startMark);
  if (startIdx === -1) throw new Error('Cannot find SYSTEM_PROMPT in server.js');
  const from = startIdx + startMark.length;
  let i = from;
  while (i < src.length) {
    i = src.indexOf('`', i);
    if (i === -1) throw new Error('Cannot find end of SYSTEM_PROMPT');
    const after = src.slice(i + 1).trimStart();
    if (after.startsWith('+') || after.startsWith(';')) break;
    i++;
  }
  return src.slice(from, i);
}

// ── Extract CODE_JS block ─────────────────────────────────────────────────────
function extractCode(text) {
  const m = text.match(/CODE_JS::([\s\S]*?)::END_CODE/);
  return m ? m[1].trim() : null;
}

// ── Pattern checks ────────────────────────────────────────────────────────────
function checkPatterns(code, required, forbidden) {
  if (!code) return { passed: false, missing: required, badFound: [] };
  const missing  = required.filter(p => !code.includes(p));
  const badFound = forbidden.filter(p => code.includes(p));
  return { passed: !missing.length && !badFound.length, missing, badFound };
}

// ── LLM judge ────────────────────────────────────────────────────────────────
async function judge(tc, aiResponse, code) {
  const isQuestion = tc.mustHaveCode === false;
  const resp = await callLLM([
    { role: 'system', content: 'You are a strict expert evaluator of Office JavaScript API code for Excel Online. You score precisely — never give round multiples of 10 unless exactly right.' },
    {
      role: 'user',
      content: `Score this AI assistant response on FOUR dimensions, each out of 25 points.

USER REQUEST: "${tc.prompt}"
WORKBOOK CONTEXT: ${tc.workbook}
${tc.note ? `SPECIAL NOTE: ${tc.note}` : ''}

AI RESPONSE:
${aiResponse}

${code ? `GENERATED CODE:\n${code}` : 'NO CODE WAS GENERATED.'}

${isQuestion
  ? `This is a QUESTION — no code expected. Score:
A) ACCURACY (0-25): Is the answer factually correct and complete?
B) CLARITY (0-25): Is it clear and easy to understand?
C) RELEVANCE (0-25): Does it directly address the question without padding?
D) BONUS (0-25): Extra credit for examples, useful context, or noting Excel-specific caveats.`
  : `Score each dimension carefully. Deduct proportionally for each flaw:
A) API_CORRECTNESS (0-25): Does the code use real Office JS APIs? Penalise hallucinated methods (e.g. worksheet.autoFilter.add, Range.sort, context.workbook.styles).
B) COMPLETENESS (0-25): Does the code fully address the request? Partial solutions lose points.
C) WOULD_IT_WORK (0-25): Would this code actually execute in Excel Online without runtime errors? Check load/sync order, variable scope, correct method signatures.
D) APPROACH (0-25): Does it use best practices and the available helpers (applyColumnFilter, clearFilters, sortByColumn) instead of re-implementing them manually?`}

Deduct points specifically for each issue you identify. Do NOT round to multiples of 5 — use precise values like 18, 22, 7.

Reply with exactly this format:
A: <number>
B: <number>
C: <number>
D: <number>
REASON: <one sentence summarising the main flaw or strength>`,
    },
  ], JUDGE_MODEL, 150);

  const aM = resp.match(/^A:\s*(\d+)/im);
  const bM = resp.match(/^B:\s*(\d+)/im);
  const cM = resp.match(/^C:\s*(\d+)/im);
  const dM = resp.match(/^D:\s*(\d+)/im);
  const reasonM = resp.match(/REASON:\s*(.+)/i);

  const a = aM ? Math.min(25, parseInt(aM[1])) : 0;
  const b = bM ? Math.min(25, parseInt(bM[1])) : 0;
  const c = cM ? Math.min(25, parseInt(cM[1])) : 0;
  const d = dM ? Math.min(25, parseInt(dM[1])) : 0;

  return {
    score:  a + b + c + d,
    reason: reasonM ? reasonM[1].trim() : resp.slice(0, 120),
    breakdown: { a, b, c, d },
  };
}

// ── Auto-patch: generate system prompt improvements for failing categories ────
async function generateFix(failingResults, currentImprovements) {
  const cases = failingResults.map(r =>
    `  [${r.id}] score=${r.score}/100\n  prompt: "${r.prompt}"\n  reason: ${r.reason}\n  code:\n${(r.generatedCode || 'NONE').split('\n').map(l => '    ' + l).join('\n')}`
  ).join('\n\n');

  const resp = await callLLM([
    { role: 'system', content: 'You are an expert at improving system prompts for an Excel AI assistant that generates Office JavaScript code.' },
    {
      role: 'user',
      content: `The following test cases are FAILING (score < 70). Analyse the errors and generate new rules or examples to add to the system prompt so the AI handles these cases correctly.

FAILING CASES:
${cases}

EXISTING IMPROVEMENTS ALREADY IN PROMPT:
${currentImprovements || '(none)'}

Constraints:
- Only add rules or examples that would fix the specific failures above
- Use the same format as the existing prompt (plain text rules or CODE_JS examples)
- Be concise — 3–8 lines max
- Do NOT duplicate existing rules

Return ONLY the new text to add. No explanation, no preamble.`,
    },
  ], MODEL, 512);

  // Strip markdown code fences — backticks inside the template literal would break server.js
  return resp.trim().replace(/```[a-z]*\n?/g, '').replace(/```/g, '');
}

// ── Apply improvements to server.js between the marker comments ───────────────
function applyImprovements(newText) {
  const src       = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const startMark = '// EVAL-IMPROVEMENTS-START';
  const endMark   = '// EVAL-IMPROVEMENTS-END';
  const startIdx  = src.indexOf(startMark);
  const endIdx    = src.indexOf(endMark);
  if (startIdx === -1 || endIdx === -1) throw new Error('Improvement markers not found in server.js');

  const before  = src.slice(0, startIdx + startMark.length);
  const after   = src.slice(endIdx);
  const oldBlock = src.slice(startIdx + startMark.length, endIdx).trim();

  const updated = `${before}\n${newText}\n${after}`;
  fs.writeFileSync(path.join(__dirname, '../server.js'), updated);

  // Print visible diff
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SYSTEM PROMPT PATCHED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (oldBlock) {
    console.log('BEFORE:');
    for (const line of oldBlock.split('\n')) console.log(`  - ${line}`);
  } else {
    console.log('BEFORE: (empty)');
  }
  console.log('AFTER:');
  for (const line of newText.split('\n')) console.log(`  + ${line}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ── Run one test ──────────────────────────────────────────────────────────────
async function runCase(tc, systemPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',      content: `Workbook state:\n\n${tc.workbook}` },
    { role: 'assistant', content: 'I can see the workbook. What would you like me to do?' },
    { role: 'user',      content: tc.prompt + '\n\n[REMINDER: If making changes, output a CODE_JS block. Do not skip it.]' },
  ];

  let aiResponse, code, patterns, verdict;
  try {
    aiResponse = await callLLM(messages, MODEL, 1024);
    code       = extractCode(aiResponse);
    patterns   = checkPatterns(code, tc.requiredPatterns, tc.forbiddenPatterns);
    verdict    = await judge(tc, aiResponse, code);
  } catch (err) {
    if (err.message.startsWith('BUDGET_EXCEEDED')) throw err;
    aiResponse = `ERROR: ${err.message}`;
    code       = null;
    patterns   = { passed: false, missing: tc.requiredPatterns, badFound: [] };
    verdict    = { score: 0, reason: `Runtime error: ${err.message}` };
  }

  return {
    id:              tc.id,
    level:           tc.level,
    category:        tc.category,
    prompt:          tc.prompt,
    score:           verdict.score,
    reason:          verdict.reason,
    hasCode:         code !== null,
    codeExpected:    tc.mustHaveCode !== false,
    patternPass:     patterns.passed,
    missingPatterns: patterns.missing,
    generatedCode:   code,
  };
}

// ── Generate harder cases for a category ─────────────────────────────────────
async function generateHarderCases(category, currentLevel, existingCases, allCategories) {
  const nextLevel     = currentLevel + 1;
  const masteredCases = existingCases
    .filter(c => c.category === category)
    .map(c => `  - [${c.id}] "${c.prompt}"`)
    .join('\n');

  const isAllMastered = allCategories.every(cat => cat.mastered);
  const newCatHint    = isAllMastered
    ? `\nSince ALL categories are mastered, also include 1–2 cases for brand-new Excel domains not yet tested (e.g. data validation, named ranges, table objects, workbook protection, sparklines, custom number formats, etc.)`
    : '';

  const prompt = `You generate test cases for an Excel AI assistant evaluation suite.

The AI just scored 95+/100 on ALL these level ${currentLevel} "${category}" cases:
${masteredCases}

Generate exactly 4 NEW test cases at level ${nextLevel} for the "${category}" category that are SIGNIFICANTLY HARDER. They must:
1. Be in the same category but test more complex, realistic, or edge-case scenarios
2. Not repeat any existing test idea
3. Be solvable via Office JavaScript API (no VBA, no pivot tables)
4. Include realistic workbook data
${newCatHint}

Return ONLY a valid JSON array, no explanation. Each object must have:
{
  "id": "gen-L${nextLevel}-${category.replace(/\s+/g, '-')}-NNN",
  "level": ${nextLevel},
  "category": "${category}",
  "prompt": "...",
  "workbook": "Headers: A1=X | B1=Y\\nData:\\nA2:val | B2:val",
  "mustHaveCode": true,
  "requiredPatterns": ["pattern1"],
  "forbiddenPatterns": []
}`;

  console.log(`\n  Generating level ${nextLevel} cases for "${category}"...`);
  const raw = await callLLM([
    { role: 'system', content: 'You generate JSON test cases. Return only valid JSON arrays.' },
    { role: 'user',   content: prompt },
  ], MODEL, 2048);

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found in response');
    const newCases = JSON.parse(jsonMatch[0]);
    console.log(`  Generated ${newCases.length} new cases for "${category}" at level ${nextLevel}`);
    return newCases;
  } catch (err) {
    console.warn(`  Failed to parse generated cases for "${category}": ${err.message}`);
    return [];
  }
}

// ── Print results ─────────────────────────────────────────────────────────────
function printResults(results, prev) {
  const prevById = {};
  if (prev) for (const r of prev.results) prevById[r.id] = r;

  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }

  console.log('\n════════════════════════════════════════════════════');
  console.log('  EVAL RESULTS');
  console.log('════════════════════════════════════════════════════\n');

  for (const [cat, items] of Object.entries(byCategory)) {
    const avg     = items.reduce((s, r) => s + r.score, 0) / items.length;
    const prevAvg = prev
      ? items.map(r => prevById[r.id]?.score ?? r.score).reduce((a, b) => a + b, 0) / items.length
      : null;
    const delta   = prevAvg !== null ? avg - prevAvg : null;
    const trend   = delta === null ? '' : delta > 2 ? ' ↑' : delta < -2 ? ' ↓' : ' →';
    const mastMark = avg >= MASTERY_THRESHOLD ? ' ✓ MASTERED' : '';
    console.log(`${cat.toUpperCase()} — ${avg.toFixed(1)}/100${trend}${mastMark}`);
    for (const r of items) {
      const d    = prevById[r.id] ? r.score - prevById[r.id].score : null;
      const diff = d !== null && Math.abs(d) >= 1 ? ` (${d > 0 ? '+' : ''}${d})` : '';
      const warn = r.score < 60 ? ' ⚠' : '';
      const bar  = '█'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
      console.log(`  ${r.id.padEnd(28)} ${bar} ${String(r.score).padStart(3)}${diff}${warn}`);
      if (r.score < 70) console.log(`    → ${r.reason}`);
      if (r.missingPatterns.length) console.log(`    missing: ${r.missingPatterns.join(', ')}`);
    }
    console.log();
  }

  const overall    = results.reduce((s, r) => s + r.score, 0) / results.length;
  const prevOverall = prev
    ? prev.results.reduce((s, r) => s + r.score, 0) / prev.results.length
    : null;

  console.log(`OVERALL: ${overall.toFixed(1)}/100${prevOverall !== null ? `  (prev: ${prevOverall.toFixed(1)})` : ''}`);
  console.log(`SESSION COST: $${totalCostUSD.toFixed(4)}`);
  console.log('════════════════════════════════════════════════════\n');

  const failing = results.filter(r => r.score < 60).sort((a, b) => a.score - b.score);
  if (failing.length) {
    console.log('NEEDS IMMEDIATE ATTENTION:');
    for (const r of failing) {
      console.log(`  [${r.id}]  score=${r.score}  "${r.prompt}"`);
      console.log(`    ${r.reason}`);
    }
    console.log();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!OPENROUTER_KEY) { console.error('OPENROUTER_KEY not set'); process.exit(1); }

  const allCases     = loadCases();
  const systemPrompt = loadSystemPrompt();
  const prev         = loadLastResults();
  const progress     = loadProgress();

  console.log(`\nRunning ${allCases.length} eval cases  |  model: ${MODEL}  |  budget: $${BUDGET_USD}\n`);

  const results = [];
  for (const tc of allCases) {
    process.stdout.write(`  ${tc.id.padEnd(30)} `);
    try {
      const r = await runCase(tc, systemPrompt);
      results.push(r);
      const bar = '█'.repeat(Math.round(r.score / 10)) + '░'.repeat(10 - Math.round(r.score / 10));
      console.log(`${bar} ${r.score}/100`);
    } catch (err) {
      if (err.message.startsWith('BUDGET_EXCEEDED')) {
        console.log('\n⚠ Budget limit hit — saving partial results and stopping.');
        break;
      }
      console.log(`ERROR: ${err.message}`);
    }
  }

  // ── Save results ────────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath   = path.join(PATHS.results, `${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ timestamp, model: MODEL, totalCostUSD, results }, null, 2));

  printResults(results, prev);

  // ── Per-category mastery check & generation ─────────────────────────────────
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }

  let newCasesGenerated = [];
  const categoryStatus  = Object.entries(byCategory).map(([cat, items]) => {
    const currentLevel = progress[cat]?.level ?? 1;
    // Only look at cases at the current level for this category
    const currentItems = items.filter(r => r.level === currentLevel);
    const avg          = currentItems.length
      ? currentItems.reduce((s, r) => s + r.score, 0) / currentItems.length
      : 0;
    return { cat, avg, currentLevel, mastered: avg >= MASTERY_THRESHOLD };
  });

  for (const { cat, avg, currentLevel, mastered } of categoryStatus) {
    if (!progress[cat]) progress[cat] = { level: 1, masteredAt: null };
    progress[cat].lastScore = Math.round(avg * 10) / 10;
    progress[cat].lastRun   = timestamp;

    if (mastered) {
      console.log(`✓ "${cat}" mastered at level ${currentLevel} (avg ${avg.toFixed(1)}) — generating level ${currentLevel + 1} cases`);
      try {
        const newCases = await generateHarderCases(cat, currentLevel, allCases, categoryStatus);
        newCasesGenerated = [...newCasesGenerated, ...newCases];
        progress[cat].level      = currentLevel + 1;
        progress[cat].masteredAt = timestamp;
      } catch (err) {
        if (err.message.startsWith('BUDGET_EXCEEDED')) {
          console.log('Budget hit during generation — skipping remaining generations.');
          break;
        }
        console.warn(`Generation failed for "${cat}": ${err.message}`);
      }
    }
  }

  if (newCasesGenerated.length > 0) {
    const existing  = fs.existsSync(PATHS.generated)
      ? JSON.parse(fs.readFileSync(PATHS.generated, 'utf8'))
      : [];
    fs.writeFileSync(PATHS.generated, JSON.stringify([...existing, ...newCasesGenerated], null, 2));
    console.log(`\nSaved ${newCasesGenerated.length} new generated cases to eval/generated-cases.json`);
  }

  saveProgress(progress);

  // ── Auto-patch server.js when categories are failing ───────────────────────
  const failingResults = results.filter(r => r.score < 70);
  if (failingResults.length > 0) {
    console.log(`\n⚡ ${failingResults.length} test(s) failed (<70) — generating system prompt patch...`);
    try {
      const src         = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
      const startMark   = '// EVAL-IMPROVEMENTS-START';
      const endMark     = '// EVAL-IMPROVEMENTS-END';
      const startIdx    = src.indexOf(startMark);
      const endIdx      = src.indexOf(endMark);
      const currentImprovements = startIdx !== -1 && endIdx !== -1
        ? src.slice(startIdx + startMark.length, endIdx).trim()
        : '';

      const fix = await generateFix(failingResults, currentImprovements);
      applyImprovements(fix);
    } catch (err) {
      if (err.message.startsWith('BUDGET_EXCEEDED')) {
        console.log('Budget hit — skipping auto-patch.');
      } else {
        console.warn(`Auto-patch failed: ${err.message}`);
      }
    }
  } else {
    console.log('\n✓ All tests passed (>=70) — no system prompt patch needed.');
  }

  console.log(`\nResults → eval/results/${timestamp}.json`);
  console.log(`Total cost: $${totalCostUSD.toFixed(4)}\n`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
