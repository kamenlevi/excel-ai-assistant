#!/usr/bin/env node
// Fallback runner — called by Task Scheduler every 8h05m.
// Pulls from GitHub, checks if Actions ran in the last 8 hours.
// If not, runs the eval locally so nothing is ever skipped.

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT           = path.join(__dirname, '..');
const LAST_RUN_FILE  = path.join(__dirname, 'last-run.txt');
const THRESHOLD_MS   = 8 * 60 * 60 * 1000;

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

log('Watchdog started — pulling latest from GitHub...');
try {
  execSync('git pull', { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  log('git pull failed — proceeding with local state');
}

if (!fs.existsSync(LAST_RUN_FILE)) {
  log('No last-run.txt found — GitHub Actions has never run. Running eval locally...');
  execSync('node eval/run.js', { cwd: ROOT, stdio: 'inherit' });
  process.exit(0);
}

const lastRunStr = fs.readFileSync(LAST_RUN_FILE, 'utf8').trim();
const elapsed    = Date.now() - new Date(lastRunStr).getTime();
const minutesAgo = Math.round(elapsed / 60000);

if (elapsed > THRESHOLD_MS) {
  log(`Last run was ${minutesAgo} minutes ago — GitHub Actions missed its window. Running locally...`);
  execSync('node eval/run.js', { cwd: ROOT, stdio: 'inherit' });
} else {
  log(`Last run was ${minutesAgo} minutes ago — GitHub Actions is on schedule. Nothing to do.`);
}
