#!/usr/bin/env node
// cds-hook.js -- ClaudeDevStudio's Claude Code hook. Claude Code runs it (exec form, no shell) as
//
//   node.exe <install>\mcp-server\cds-hook.js <event>        with the hook input (JSON) on stdin
//
// Events (set up by `claudedev claude-code setup`, Installer\cds-claude-code.js):
//   session-start  prints the same context as claudedev_load (capped at 9,500 characters, under
//                  Claude Code's 10,000); creates the project's memory on first use, like load.
//   pre-compact    an automatic handoff (CLI: record <path> handoff <json> --auto) from the
//   session-end    transcript: the last request, the files edited, Claude's last reply. It never
//                  replaces an explicit handoff (the CLI keeps that rule). Prints nothing: a
//                  PreCompact hook's stdout would become instructions for the compaction summary.
//   post-tool-use  one activity line (file_edit, the path relative to the project) per file per
//                  session, through the CLI.
//
// Rules: always exit 0 (exit 2 would block a tool or the compaction); nothing on stdout except
// session-start's context; errors go to %LOCALAPPDATA%\ClaudeDevStudio\hooks.log (capped);
// folders that aren't projects, the home folder, Windows, Program Files and drive roots are
// skipped quietly, with no memory created. Every memory write goes through the CLI.

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { HOME, documentsDir } from './cds-paths.js';
import { runCli, cliMessage, loadProject, projectName, oneLine } from './cds-context.js';

const SESSION_START_MAX = 9500;          // Claude Code keeps 10,000 characters of a hook's stdout
const STDIN_WAIT_MS = 3000;               // Claude Code writes the input and closes stdin at once
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const CDS_LOCAL = path.join(LOCAL, 'ClaudeDevStudio');
// CDS_HOOK_LOG is for tests only (mcp-server\test\smoke.mjs), so they never write to the install folder.
const LOG_FILE = process.env.CDS_HOOK_LOG ? path.resolve(process.env.CDS_HOOK_LOG) : path.join(CDS_LOCAL, 'hooks.log');
const LOG_MAX = 256 * 1024;
const CACHE_FILE = path.join(path.dirname(LOG_FILE), 'hook_cache.json');
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// ---------------------------------------------------------------------------
// The log (never stdout)
// ---------------------------------------------------------------------------

function log(event, msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    try {
      // Capped: past LOG_MAX keep the newest half.
      if (fs.statSync(LOG_FILE).size > LOG_MAX) {
        const buf = fs.readFileSync(LOG_FILE);
        let keep = buf.subarray(buf.length - LOG_MAX / 2);
        const nl = keep.indexOf(10);
        if (nl >= 0) keep = keep.subarray(nl + 1);
        fs.writeFileSync(LOG_FILE, keep);
      }
    } catch { /* no log yet */ }
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()}  ${event || '?'}  ${String(msg).replace(/\r?\n/g, ' | ')}\r\n`, 'utf8');
  } catch { /* logging must never fail a hook */ }
}

// ---------------------------------------------------------------------------
// Input and the project
// ---------------------------------------------------------------------------

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    const chunks = [];
    const done = () => {
      clearTimeout(timer);
      try { process.stdin.pause(); process.stdin.destroy(); } catch { /* already closed */ }
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(done, STDIN_WAIT_MS);
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const isUnder = (p, root) => { const a = norm(p), b = norm(root); return a === b || a.startsWith(b + path.sep); };

// Folders that are never a project: the user's home (and the folder holding it), Windows,
// Program Files, ProgramData, and drive roots (claudedev stats once ran in system32 and made a
// memory folder named "system32": docs\GROUND_TRUTH.md section 7, item 1).
function isExcluded(p) {
  const resolved = path.resolve(p);
  if (path.parse(resolved).root.replace(/[\\/]+$/, '').toLowerCase() === norm(resolved)) return true;
  if (norm(resolved) === norm(HOME) || norm(resolved) === norm(path.dirname(HOME))) return true;
  const env = process.env;
  const trees = [env.SystemRoot, env.windir, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData]
    .filter(Boolean);
  return trees.some(t => isUnder(resolved, t));
}

const PROJECT_FILES = new Set(['.git', 'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod']);
// A folder looks like a project if it holds .git, docs\, a solution or project file, or one of
// the usual package manifests.
function looksLikeProject(p) {
  let entries;
  try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return false; }
  return entries.some(e => {
    const n = e.name.toLowerCase();
    if (PROJECT_FILES.has(n)) return true;
    if (n === 'docs' && e.isDirectory()) return true;
    return e.isFile() && /\.(sln|slnx|[a-z]{2,6}proj)$/.test(n);
  });
}

function projectFrom(input) {
  const raw = process.env.CLAUDE_PROJECT_DIR || input.cwd || '';
  if (!raw) return null;
  const p = path.resolve(String(raw));
  try { if (!fs.statSync(p).isDirectory()) return null; } catch { return null; }
  if (!projectName(p) || isExcluded(p) || !looksLikeProject(p)) return null;
  return p;
}

// The memory folder, as the CLI computes it ([Documents]\ClaudeDevStudio\Projects\<name>).
// post-tool-use runs often, so it reads Documents from a cache that session-start refreshes.
function memoryDirFor(p, { fresh = false } = {}) {
  // Tests only (smoke.mjs): a throwaway memory root, as in cds-paths.js and the CLI.
  if (process.env.CDS_MEMORY_ROOT) return path.join(path.resolve(process.env.CDS_MEMORY_ROOT), 'Projects', projectName(p));
  let docs = null;
  if (!fresh) {
    try {
      const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (c && c.documents && fs.existsSync(c.documents)) docs = c.documents;
    } catch { /* no cache */ }
  }
  if (!docs) {
    docs = documentsDir();
    try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify({ documents: docs, written: new Date().toISOString() }), 'utf8'); } catch { /* best effort */ }
  }
  return path.join(docs, 'ClaudeDevStudio', 'Projects', projectName(p));
}

// ---------------------------------------------------------------------------
// session-start
// ---------------------------------------------------------------------------

const FOOTER = '\n(Loaded at session start by the ClaudeDevStudio hook; claudedev_load would show the same.)';

async function sessionStart(p) {
  memoryDirFor(p, { fresh: true }); // refresh the Documents cache for post-tool-use
  const r = await loadProject(p, { max: SESSION_START_MAX - FOOTER.length });
  if (!r.ok) { log('session-start', `${p}: ${r.text}`); return; }
  const out = r.text + FOOTER;
  process.stdout.write(out.length > SESSION_START_MAX ? out.slice(0, SESSION_START_MAX) : out);
  pruneEditMarkers(p);
}

// ---------------------------------------------------------------------------
// post-tool-use: one activity line per file per session
// ---------------------------------------------------------------------------

const safeId = (s) => String(s || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);

async function postToolUse(p, input) {
  if (!EDIT_TOOLS.has(input.tool_name)) return;
  const ti = input.tool_input || {};
  const file = ti.file_path || ti.notebook_path;
  if (!file) return;
  const tr = input.tool_response;
  if (tr && typeof tr === 'object' && (tr.success === false || tr.error)) return;
  const rel = path.relative(p, path.resolve(p, String(file)));
  // Only this project's files (an edit elsewhere belongs to some other project, or none).
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;

  // The marker's exclusive create makes "once per file per session" hold even when several of
  // these async hooks run at the same time.
  const dir = path.join(memoryDirFor(p), 'hook_state', safeId(input.session_id));
  const marker = path.join(dir, crypto.createHash('sha1').update(rel.toLowerCase()).digest('hex').slice(0, 16));
  fs.mkdirSync(dir, { recursive: true });
  try { fs.writeFileSync(marker, rel, { flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') return; throw e; }

  const entry = { action: 'file_edit', description: `Edited ${rel} (Claude Code, ${input.tool_name})`, file: rel };
  const r = await runCli(['record', p, 'activity', JSON.stringify(entry)], 15000);
  if (r.code !== 0) {
    try { fs.unlinkSync(marker); } catch { /* leave it */ }
    log('post-tool-use', `${p}: activity NOT recorded for ${rel}: ${cliMessage(r)}`);
  }
}

// Markers of other sessions older than two days are removed at session start.
function pruneEditMarkers(p) {
  try {
    const root = path.join(memoryDirFor(p), 'hook_state');
    const cutoff = Date.now() - 2 * 86400000;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const d = path.join(root, e.name);
      if (e.isDirectory() && fs.statSync(d).mtimeMs < cutoff) fs.rmSync(d, { recursive: true, force: true });
    }
  } catch { /* nothing to prune */ }
}

// ---------------------------------------------------------------------------
// pre-compact and session-end: an automatic handoff from the transcript
// ---------------------------------------------------------------------------

const TRANSCRIPT_MAX = 32 * 1024 * 1024; // read at most the last 32 MB of a long session

// The transcript is JSON lines: { type: "user" | "assistant", message: { role, content }, ... },
// content a string or blocks ({ type: "text", text }, { type: "tool_use", name, input }, ...).
function readTranscript(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TRANSCRIPT_MAX);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // a partial first line
    return text.split('\n');
  } finally { fs.closeSync(fd); }
}

const blocks = (msg) => {
  const c = msg && msg.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c : [];
};
const textOf = (msg) => blocks(msg).filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
// Text a person typed, without the reminders and command wrappers Claude Code adds.
function cleanRequest(t) {
  return String(t || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<(command-[a-z-]+|local-command-[a-z-]+|bash-[a-z-]+)>[\s\S]*?<\/\1>/g, ' ')
    .trim();
}

function summarise(lines, p) {
  const files = [];
  const seen = new Set();
  let request = '', reply = '';
  for (const line of lines) {
    if (!line.includes('"tool_use"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'assistant' || e.isSidechain) continue;
    for (const b of blocks(e.message)) {
      if (!b || b.type !== 'tool_use' || !EDIT_TOOLS.has(b.name)) continue;
      const f = b.input && (b.input.file_path || b.input.notebook_path);
      if (!f) continue;
      const abs = path.resolve(p, String(f));
      const rel = path.relative(p, abs);
      const shown = !rel || rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel;
      if (!seen.has(shown.toLowerCase())) { seen.add(shown.toLowerCase()); files.push(shown); }
    }
  }
  for (let i = lines.length - 1; i >= 0 && (!request || !reply); i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain || e.isMeta) continue;
    if (!reply && e.type === 'assistant') {
      const t = textOf(e.message).trim();
      if (t) reply = t;
    } else if (!request && e.type === 'user') {
      if (blocks(e.message).some(b => b && b.type === 'tool_result')) continue;
      const t = cleanRequest(textOf(e.message));
      if (t) request = t;
    }
  }
  return { request, reply, files };
}

async function autoHandoff(event, p, input) {
  const file = input.transcript_path;
  let lines;
  try {
    if (!file) throw new Error('no transcript_path in the hook input');
    lines = readTranscript(String(file));
  } catch (e) {
    log(event, `${p}: no handoff written, the transcript could not be read: ${e.message}`);
    return;
  }
  const { request, reply, files } = summarise(lines, p);
  if (!request && !reply && !files.length) { log(event, `${p}: no handoff written, the transcript holds no conversation`); return; }

  const when = event === 'pre-compact' ? 'before the context was compacted' : `when the session ended${input.reason ? ` (${input.reason})` : ''}`;
  const where = request
    ? `Claude Code session, ${when}. The last request: "${oneLine(request, 400)}"`
    : `Claude Code session, ${when}. (No request found in the transcript.)`;
  const notes = [];
  if (files.length) notes.push(`Files edited in this session (${files.length}): ${oneLine(files.slice(0, 30).join(', '), 1200)}${files.length > 30 ? ', ...' : ''}`);
  if (reply) notes.push(`Claude's last reply: "${oneLine(reply, 500)}"`);
  if (input.session_id) notes.push(`Resume that session with: claude --resume ${input.session_id}`);
  const entry = {
    where_i_stopped: where,
    next_step: 'Not stated (an automatic handoff): pick up from the last request and reply above, or the ground truth\'s Next.',
    open_questions: [],
    notes: notes.join('\n'),
    origin: `from the Claude Code session (${event === 'pre-compact' ? 'before compaction' : 'session end'})`,
  };
  const r = await runCli(['record', p, 'handoff', JSON.stringify(entry), '--auto'], 8000);
  if (r.code !== 0) log(event, `${p}: handoff NOT saved: ${cliMessage(r)}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const event = String(process.argv[2] || '').toLowerCase();
  try {
    const raw = await readStdin();
    let input = {};
    if (raw.trim()) {
      try { input = JSON.parse(raw); } catch (e) { log(event, `the hook input is not JSON: ${e.message}`); return; }
    }
    if (!input || typeof input !== 'object') input = {};
    const p = projectFrom(input);
    if (!p) return; // not a project: skip quietly, create nothing
    switch (event) {
      case 'session-start': await sessionStart(p); break;
      case 'post-tool-use': await postToolUse(p, input); break;
      case 'pre-compact':
      case 'session-end': await autoHandoff(event, p, input); break;
      default: log(event, `unknown event "${event}" (expected session-start, pre-compact, session-end or post-tool-use)`);
    }
  } catch (e) {
    log(event, e && e.stack ? e.stack : String(e));
  }
}

main().finally(() => { process.exitCode = 0; });
