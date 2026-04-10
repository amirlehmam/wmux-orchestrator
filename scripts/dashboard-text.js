#!/usr/bin/env node
/**
 * dashboard-text.js — ANSI-art dashboard for wmux-orchestrator runs.
 * Used in two places:
 *   1. Fallback mode (no wmux): the orchestrate skill calls this at wave
 *      transitions to print a status block into Claude Code's conversation.
 *   2. wmux mode: can be called manually by the user to get a one-shot view.
 *
 * Usage: node dashboard-text.js <orch-dir> [--no-color] [--compact]
 * Prints a single rendered block to stdout and exits.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const orchDir = args.find((a) => !a.startsWith('--'));
const noColor = args.includes('--no-color') || process.env.NO_COLOR === '1';
const compact = args.includes('--compact');

if (!orchDir) {
  console.error('Usage: node dashboard-text.js <orch-dir> [--no-color] [--compact]');
  process.exit(1);
}

const stateFile = path.join(orchDir, 'state.json');
let state;
try {
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch (e) {
  console.error(`dashboard: cannot read ${stateFile}: ${e.message}`);
  process.exit(1);
}

// ─── Colors ────────────────────────────────────────────────────────────────

const c = noColor
  ? new Proxy({}, { get: () => (s) => s })
  : {
      reset: '\x1b[0m',
      bold: (s) => `\x1b[1m${s}\x1b[22m`,
      dim: (s) => `\x1b[2m${s}\x1b[22m`,
      amber: (s) => `\x1b[38;2;245;179;1m${s}\x1b[39m`,
      green: (s) => `\x1b[38;2;74;222;128m${s}\x1b[39m`,
      red: (s) => `\x1b[38;2;239;68;68m${s}\x1b[39m`,
      grey: (s) => `\x1b[38;2;140;140;140m${s}\x1b[39m`,
      faint: (s) => `\x1b[38;2;90;90;90m${s}\x1b[39m`,
      white: (s) => `\x1b[38;2;242;242;242m${s}\x1b[39m`,
    };

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseIso(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function fmtElapsed(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function fmtShort(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// visible length ignoring ANSI escape sequences
function vlen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padRight(s, n) {
  const diff = n - vlen(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

function progressBar(frac, width) {
  const filled = Math.round(frac * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function agentDot(status, exitCode) {
  const isFail = status === 'failed' || (status === 'exited' && exitCode && exitCode !== 0);
  if (isFail) return c.red('✗');
  if (status === 'exited') return c.green('✓');
  if (status === 'running') return c.amber('●');
  return c.faint('·');
}

function waveStatusLabel(status) {
  if (status === 'complete') return c.green('complete');
  if (status === 'running') return c.amber('running');
  if (status === 'failed') return c.red('failed');
  return c.faint('pending');
}

function runStatusLabel(status) {
  if (status === 'complete') return c.green('COMPLETE');
  if (status === 'running') return c.amber('RUNNING');
  if (status === 'failed') return c.red('FAILED');
  return c.faint('PENDING');
}

// ─── Render ────────────────────────────────────────────────────────────────

const WIDTH = compact ? 58 : 68;
const INNER = WIDTH - 2; // minus the two border chars

const now = Date.now();
const startedAt = parseIso(state.startedAt);
const elapsed = startedAt > 0 ? fmtElapsed(now - startedAt) : '—';

const totalAgents = (state.waves || []).reduce((sum, w) => sum + (w.agents || []).length, 0);
const doneAgents = (state.waves || []).reduce((sum, w) =>
  sum + (w.agents || []).filter((a) => a.status === 'exited' || a.status === 'failed').length, 0);
const runningAgents = (state.waves || []).reduce((sum, w) =>
  sum + (w.agents || []).filter((a) => a.status === 'running').length, 0);
const currentWaveIdx = (() => {
  const waves = state.waves || [];
  for (let i = 0; i < waves.length; i++) if (waves[i].status === 'running') return i;
  for (let i = 0; i < waves.length; i++) if (waves[i].status === 'pending') return i;
  return Math.max(0, waves.length - 1);
})();

const lines = [];

// ─── Header ─────────────────────────────────
const titleLeft = `${c.bold(c.amber('wmux'))} ${c.faint('•')} ${c.amber('orchestration')}`;
const statusRight = runStatusLabel(state.status);
const topHeaderText = `${titleLeft}   ${statusRight}`;
const headerPadding = INNER - vlen(topHeaderText) - 2;
lines.push(c.faint('┌─ ') + topHeaderText + ' ' + c.faint('─'.repeat(Math.max(1, headerPadding))) + c.faint(' ┐'));

// ─── Task ───────────────────────────────────
const taskText = (state.task || '').slice(0, INNER - 4);
lines.push(c.faint('│ ') + padRight(c.white(taskText), INNER - 2) + c.faint(' │'));

// ─── Meta row ───────────────────────────────
const totalWaves = (state.waves || []).length;
const metaParts = [
  c.amber(elapsed),
  c.faint('·'),
  c.grey(`wave ${currentWaveIdx + 1}/${totalWaves}`),
  c.faint('·'),
  c.grey(`${doneAgents}/${totalAgents} done`),
];
if (runningAgents > 0) {
  metaParts.push(c.faint('·'));
  metaParts.push(c.amber(`${runningAgents} running`));
}
const metaText = metaParts.join(' ');
lines.push(c.faint('│ ') + padRight(metaText, INNER - 2) + c.faint(' │'));

// ─── Waves ──────────────────────────────────
for (const wave of state.waves || []) {
  // Blank separator
  lines.push(c.faint('│ ') + ' '.repeat(INNER - 2) + c.faint(' │'));

  const agents = wave.agents || [];
  const done = agents.filter((a) => a.status === 'exited' || a.status === 'failed').length;
  const frac = agents.length > 0 ? done / agents.length : 0;
  const pct = `${Math.round(frac * 100)}%`;

  const waveLabel = c.bold(c.grey(`wave ${wave.index + 1}`));
  const statusLab = waveStatusLabel(wave.status);
  const barWidth = INNER - vlen(waveLabel) - vlen(statusLab) - vlen(pct) - 7;
  const bar = wave.status === 'complete'
    ? c.green(progressBar(frac, barWidth))
    : wave.status === 'running'
      ? c.amber(progressBar(frac, barWidth))
      : c.faint(progressBar(frac, barWidth));
  const waveHead = `${waveLabel} ${statusLab} ${bar} ${c.grey(pct)}`;
  lines.push(c.faint('│ ') + padRight(waveHead, INNER - 2) + c.faint(' │'));

  for (const agent of agents) {
    const dot = agentDot(agent.status, agent.exitCode);
    const label = (agent.label || agent.id || '').slice(0, 26);
    const started = agent.startedAt ? parseIso(agent.startedAt) : 0;
    const finished = agent.finishedAt ? parseIso(agent.finishedAt) : null;
    const durMs = started > 0 ? (finished ?? now) - started : 0;
    const tools = agent.toolUses ?? 0;

    let metaStr;
    if (agent.status === 'pending') {
      metaStr = c.faint('waiting');
    } else if (started > 0) {
      metaStr = c.grey(`↦${String(tools).padStart(3)}  ${fmtShort(durMs).padStart(5)}`);
    } else {
      metaStr = c.faint('—');
    }

    const labelColored = agent.status === 'running'
      ? c.white(padRight(label, 26))
      : agent.status === 'exited'
        ? c.grey(padRight(label, 26))
        : c.faint(padRight(label, 26));

    const row = `  ${dot} ${labelColored}${metaStr}`;
    lines.push(c.faint('│ ') + padRight(row, INNER - 2) + c.faint(' │'));
  }
}

// ─── Reviewer ───────────────────────────────
if (state.reviewer && state.reviewer.status && state.reviewer.status !== 'pending') {
  lines.push(c.faint('│ ') + ' '.repeat(INNER - 2) + c.faint(' │'));
  const revDot = state.reviewer.status === 'complete' ? c.green('✓')
    : state.reviewer.status === 'running' ? c.amber('●')
    : state.reviewer.status === 'failed' ? c.red('✗')
    : c.faint('·');
  const revLabel = c.bold(c.grey('reviewer'));
  const revStatus = state.reviewer.status === 'complete' ? c.green('complete')
    : state.reviewer.status === 'running' ? c.amber('running')
    : state.reviewer.status === 'failed' ? c.red('failed')
    : c.faint(state.reviewer.status);
  const revRow = `  ${revDot} ${revLabel}   ${revStatus}`;
  lines.push(c.faint('│ ') + padRight(revRow, INNER - 2) + c.faint(' │'));
}

// ─── Footer ─────────────────────────────────
lines.push(c.faint('└' + '─'.repeat(INNER) + '┘'));

process.stdout.write(lines.join('\n') + '\n');
