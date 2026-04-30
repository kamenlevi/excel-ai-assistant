#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
const MODEL          = 'meta-llama/llama-3.3-70b-instruct';
const JUDGE_MODEL    = 'meta-llama/llama-3.3-70b-instruct';
const COST_PER_1M_IN  = 0.07;  // $ per 1M input tokens  (llama 3.3 70b on OpenRouter)
const COST_PER_1M_OUT = 0.30;  // $ per 1M output tokens
const BUDGET_LIMIT    = 0.50;  // hard stop

const cases      = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const resultsDir = path.join(__dirname, 'results');
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

// ── Load system prompt from server.js ─────────────────────────────────────────
function loadSystemPrompt() {
  const src       = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const startMark = 'const SYSTEM_PROMPT = `';
  const startIdx  = src.indexOf(startMark);
  if (startIdx === -1) throw new Error('Could not find SYSTEM_PROMPT in server.js');
  const contentStart = startIdx + startMark.length;
  // Find closing backtick — the one directly followed by whitespace then + or ;
  let i = contentStart;
  while (i < src.length) {
    i = src.indexOf('`', i);
    if (i === -1) throw new Error('Could not find end of SYSTEM_PROMPT');
    const after = src.slice(i + 1).trimStart();
    if (after.startsWith('+') || after.startsWith(';')) break;
    i++;
  }
  return src.slice(contentStart, i);
}

// ── Estimate token cost ────────────────────────────────────────────────────────
let totalCostUSD = 0;
function trackCost(inputTokens, outputTokens) {
  const cost = (inputTokens / 1_000_000) * COST_PER_1M_IN + (outputTokens / 1_000_000) * COST_PER_1M_OUT;
  totalCostUSD += cost;
  if (totalCostUSD > BUDGET_LIMIT) throw new Error(`Budget limit $${BUDGET_LIMIT} exceeded — stopping.`);
  return cost;
}

// ── Call OpenRouter ────────────────────────────────────────────────────────────
async function callLLM(messages, model = MODEL) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://localhost:3000',
      'X-Title': 'ExcelAI Eval'
    },
    body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0.1 })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  const usage = data.usage || {};
  trackCost(usage.prompt_tokens || 500, usage.completion_tokens || 200);
  return data.choices[0].message.content;
}

// ── Parse CODE_JS block ────────────────────────────────────────────────────────
function extractCode(text) {
  const m = text.match(/CODE_JS::([\s\S]*?)::END_CODE/);
  return m ? m[1].trim() : null;
}

// ── Pattern checks ─────────────────────────────────────────────────────────────
function checkPatterns(code, required, forbidden) {
  if (!code) return { passed: false, missing: required, forbidden: [] };
  const missing   = required.filter(p => !code.includes(p));
  const foundBad  = forbidden.filter(p => code.includes(p));
  return { passed: missing.length === 0 && foundBad.length === 0, missing, forbidden: foundBad };
}

// ── LLM judge: rate the generated code ─────────────────────────────────────────
async function judgeCode(testCase, aiResponse, generatedCode) {
  const prompt = `You are an expert in Office JavaScript API for Excel Online. Rate this AI assistant response.

USER ASKED: "${testCase.prompt}"
WORKBOOK STATE: ${testCase.workbook}

AI RESPONSE:
${aiResponse}

${generatedCode ? `GENERATED CODE:\n${generatedCode}` : 'NO CODE WAS GENERATED.'}

Rate this response from 0 to 10:
- 10: Perfect. Correct code, uses the right APIs, would work in Excel.
- 7-9: Good. Minor issues but fundamentally correct.
- 4-6: Partial. Code generated but has bugs or wrong approach.
- 1-3: Poor. Wrong approach or missing code when it was needed.
- 0: Complete failure. Lied about doing something, no code, or harmful code.

${testCase.mustHaveCode === false ? 'NOTE: This is a question — code is NOT required. Score based on answer quality.' : ''}
${testCase.note ? `CONTEXT: ${testCase.note}` : ''}

Reply with ONLY: SCORE: <number>\nREASON: <one sentence>`;

  const judgeResp = await callLLM([
    { role: 'system', content: 'You are a code quality evaluator. Be strict and objective.' },
    { role: 'user', content: prompt }
  ], JUDGE_MODEL);

  const scoreMatch = judgeResp.match(/SCORE:\s*(\d+)/i);
  const reasonMatch = judgeResp.match(/REASON:\s*(.+)/i);
  return {
    score:  scoreMatch  ? parseInt(scoreMatch[1])       : 0,
    reason: reasonMatch ? reasonMatch[1].trim()         : judgeResp.trim()
  };
}

// ── Run one test case ──────────────────────────────────────────────────────────
async function runCase(testCase, systemPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Here is the current state of the workbook.\n\nActive sheet: Sheet1\n\n${testCase.workbook}`
    },
    { role: 'assistant', content: 'I can see the workbook. What would you like me to do?' },
    {
      role: 'user',
      content: testCase.prompt + '\n\n[REMINDER: If making changes, output a CODE_JS block with Office JS code. Do not skip it.]'
    }
  ];

  let aiResponse, generatedCode, patternResult, judgeResult;
  try {
    aiResponse    = await callLLM(messages);
    generatedCode = extractCode(aiResponse);
    patternResult = checkPatterns(generatedCode, testCase.requiredPatterns, testCase.forbiddenPatterns);
    judgeResult   = await judgeCode(testCase, aiResponse, generatedCode);
  } catch (err) {
    if (err.message.includes('Budget limit')) throw err;
    aiResponse    = `ERROR: ${err.message}`;
    generatedCode = null;
    patternResult = { passed: false, missing: testCase.requiredPatterns, forbidden: [] };
    judgeResult   = { score: 0, reason: `Execution error: ${err.message}` };
  }

  const hasCode      = generatedCode !== null;
  const codeExpected = testCase.mustHaveCode !== false;
  const codePass     = codeExpected ? hasCode : true;

  return {
    id:            testCase.id,
    tier:          testCase.tier,
    category:      testCase.category,
    prompt:        testCase.prompt,
    hasCode,
    codeExpected,
    codePass,
    patternPass:   patternResult.passed,
    missingPatterns: patternResult.missing,
    score:         judgeResult.score,
    reason:        judgeResult.reason,
    generatedCode: generatedCode || null
  };
}

// ── Load last results for comparison ──────────────────────────────────────────
function loadLastResults() {
  const files = fs.readdirSync(resultsDir)
    .filter(f => f.endsWith('.json'))
    .sort();
  if (files.length === 0) return null;
  return JSON.parse(fs.readFileSync(path.join(resultsDir, files[files.length - 1]), 'utf8'));
}

// ── Print summary ──────────────────────────────────────────────────────────────
function printSummary(results, prev) {
  console.log('\n════════════════════════════════════════');
  console.log('  EVAL RESULTS');
  console.log('════════════════════════════════════════\n');

  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }

  const prevById = {};
  if (prev) {
    for (const r of prev.results) prevById[r.id] = r;
  }

  for (const [cat, items] of Object.entries(byCategory)) {
    const avg    = items.reduce((s, r) => s + r.score, 0) / items.length;
    const prevAvg = prev
      ? items.reduce((s, r) => s + (prevById[r.id]?.score ?? r.score), 0) / items.length
      : null;
    const delta  = prevAvg !== null ? avg - prevAvg : null;
    const arrow  = delta === null ? '' : delta > 0.4 ? ' ↑' : delta < -0.4 ? ' ↓' : ' →';
    console.log(`${cat.toUpperCase()} — avg ${avg.toFixed(1)}/10${arrow}`);
    for (const r of items) {
      const prev_ = prevById[r.id];
      const d     = prev_ ? r.score - prev_.score : null;
      const flag  = r.score < 6 ? ' ⚠' : '';
      const diff  = d !== null && Math.abs(d) > 0 ? ` (${d > 0 ? '+' : ''}${d})` : '';
      console.log(`  ${r.id}  ${r.score}/10${diff}${flag}  ${r.reason}`);
      if (r.missingPatterns.length > 0) console.log(`    missing: ${r.missingPatterns.join(', ')}`);
    }
    console.log();
  }

  const overall    = results.reduce((s, r) => s + r.score, 0) / results.length;
  const prevOverall = prev
    ? prev.results.reduce((s, r) => s + r.score, 0) / prev.results.length
    : null;

  console.log(`OVERALL: ${overall.toFixed(2)}/10${prevOverall !== null ? ` (prev ${prevOverall.toFixed(2)})` : ''}`);
  console.log(`COST THIS SESSION: $${totalCostUSD.toFixed(4)}`);
  console.log('════════════════════════════════════════\n');

  // Flag worst performers
  const failing = results.filter(r => r.score < 6).sort((a, b) => a.score - b.score);
  if (failing.length > 0) {
    console.log('NEEDS IMPROVEMENT:');
    for (const r of failing) {
      console.log(`  [${r.id}] ${r.prompt}`);
      console.log(`    → ${r.reason}`);
    }
    console.log();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  if (!OPENROUTER_KEY) {
    console.error('ERROR: OPENROUTER_KEY not set in .env');
    process.exit(1);
  }

  console.log(`Running ${cases.length} eval cases with ${MODEL}...`);
  console.log(`Budget limit: $${BUDGET_LIMIT}\n`);

  const systemPrompt = loadSystemPrompt();
  const prev         = loadLastResults();
  const results      = [];

  for (const testCase of cases) {
    process.stdout.write(`  ${testCase.id.padEnd(20)} `);
    try {
      const result = await runCase(testCase, systemPrompt);
      results.push(result);
      const bar = '█'.repeat(Math.round(result.score)) + '░'.repeat(10 - Math.round(result.score));
      console.log(`${bar} ${result.score}/10`);
    } catch (err) {
      if (err.message.includes('Budget limit')) {
        console.log('\n⚠ Budget limit hit — saving partial results.');
        break;
      }
      console.log(`ERROR: ${err.message}`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile   = path.join(resultsDir, `${timestamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ timestamp, model: MODEL, totalCostUSD, results }, null, 2));

  printSummary(results, prev);
  console.log(`Results saved → eval/results/${timestamp}.json`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
