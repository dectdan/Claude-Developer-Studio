#!/usr/bin/env node
// ClaudeDevStudio core memory MCP server ("claudedevstudio").
//
// This server is a thin wrapper over the claudedev CLI. The CLI owns the memory
// format (Activity\YYYY-MM-DD.jsonl, MISTAKES.jsonl, DECISIONS.jsonl, PATTERNS.jsonl,
// session_state.json, FACTS.md, UNCERTAINTIES.md). Every write goes through the CLI;
// this server only reads the files to build the context it returns on load.
//
// v1.3.0 (2026-11-11): fixes the split-memory bug. Before this version the server
// called the CLI with the wrong arguments (so init, record and check never ran) and
// read/wrote %USERPROFILE%\Documents while the CLI used the real Documents folder
// (OneDrive-redirected on most Windows 11 PCs). See docs\GROUND_TRUTH.md.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile, execFileSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// The version is set in package.json beside this file (checked by tools\check-versions.ps1).
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || 'unknown'; }
  catch { return 'unknown'; }
})();
const HOME = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Default';
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
// CDS_CLI_PATH is for tests only (mcp-server\test\smoke.mjs --cli): it points the server at
// a freshly built claudedev.exe instead of the installed one. Normal use never sets it.
const CLAUDEDEV_PATH = process.env.CDS_CLI_PATH
  ? path.resolve(process.env.CDS_CLI_PATH)
  : path.join(LOCAL, 'ClaudeDevStudio', 'CLI', 'claudedev.exe');

// Where v1.2.x of this server wrote its own fallback files. Read-only from now on,
// so nothing written there in the past is lost before the stores are merged.
const LEGACY_ROOT = path.join(HOME, 'Documents', 'ClaudeDevStudio');

const MIRROR_MAX_LINES = 2000;
const MIRROR_TOOL_TTL_MS = 24 * 60 * 60 * 1000;
const MIRROR_CKPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// The CLI stores memory under Environment.SpecialFolder.MyDocuments, which follows
// Windows' Documents redirection (OneDrive). Resolve the very same folder here.
let _memoryRoot = null;
function memoryRoot() {
  if (_memoryRoot) return _memoryRoot;
  let docs = null;
  try {
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('MyDocuments')"],
      { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
    if (out && fs.existsSync(out)) docs = out;
  } catch { /* fall back below */ }
  if (!docs) {
    const oneDrive = path.join(HOME, 'OneDrive', 'Documents');
    docs = fs.existsSync(oneDrive) ? oneDrive : path.join(HOME, 'Documents');
  }
  _memoryRoot = path.join(docs, 'ClaudeDevStudio');
  return _memoryRoot;
}

const projectName = (projectPath) => path.basename(projectPath);
const projectMemoryDir = (projectPath) => path.join(memoryRoot(), 'Projects', projectName(projectPath));
const legacyMemoryDir = (projectPath) => path.join(LEGACY_ROOT, 'Projects', projectName(projectPath));
const mirrorPath = () => path.join(memoryRoot(), 'chat_mirror.jsonl');
const legacyMirrorPath = () => path.join(LEGACY_ROOT, 'chat_mirror.jsonl');

// Validates project_path and normalises it. The CLI uses Path.GetFileName(path) as the
// project name, so a trailing backslash would give it an empty name: path.resolve strips it.
function requireProjectPath(args) {
  const raw = args && args.project_path ? String(args.project_path).trim() : '';
  if (!raw) throw new Error('project_path is required: the full path to the project folder, e.g. C:\\Projects\\MyApp');
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) throw new Error(`Project folder not found: ${resolved}`);
  if (!projectName(resolved)) throw new Error(`Not a project folder (no folder name): ${resolved}`);
  return resolved;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

// The CLI's source files hold UTF-8 symbols that reach the console double-encoded.
// Map the known ones back so tool results read cleanly.
function cleanCliText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\u00e2\u0153\u201c/g, '\u2713')          // check mark
    .replace(/\u00e2\u0161\u00a0\u00ef\u00b8\u008f?/g, '\u26a0') // warning sign
    .replace(/\u00e2\u009d\u201c/g, '?')
    .replace(/^\uFFFD+\s*/gm, '')                       // undecodable symbol at a line start
    .replace(/\r\n/g, '\n')
    .trim();
}

// Runs claudedev.exe with an argument array (no shell, so paths with spaces and JSON
// with quotes are passed exactly). Never throws: returns { code, stdout, stderr }.
function runCli(args, timeout = 30000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(CLAUDEDEV_PATH)) {
      resolve({ code: -1, stdout: '', stderr: `claudedev.exe not found at ${CLAUDEDEV_PATH}. Reinstall ClaudeDevStudio.` });
      return;
    }
    execFile(CLAUDEDEV_PATH, args,
      { timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        let code = 0;
        let extra = '';
        if (err) {
          code = typeof err.code === 'number' ? err.code : -1;
          if (code === -1) extra = err.killed ? `timed out after ${timeout / 1000}s` : err.message;
        }
        resolve({ code, stdout: cleanCliText(stdout), stderr: cleanCliText(stderr || extra) });
      });
  });
}

const cliMessage = (r) => [r.stdout, r.stderr].filter(Boolean).join('\n') || `(no output, exit code ${r.code})`;

// ---------------------------------------------------------------------------
// Reading memory files (for load)
// ---------------------------------------------------------------------------

function readText(file, maxChars = 4000) {
  try {
    if (!fs.existsSync(file)) return '';
    const t = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    return t.length > maxChars ? t.slice(0, maxChars) + '\n[...truncated]' : t;
  } catch { return ''; }
}

function readJsonLines(file) {
  const out = [];
  try {
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* skip a bad line */ }
    }
  } catch { /* unreadable file */ }
  return out;
}

// A FACTS.md or UNCERTAINTIES.md that still holds only the CLI's template has no
// bullet other than the project path; don't spend context on it.
function hasRealContent(md) {
  return md.split('\n').some(l => /^\s*[-*]\s+\S/.test(l) && !/Project path:/i.test(l));
}

// Which memory folder each collected entry was read from (so load can tell whether
// anything it shows came from the old store).
const entrySource = new WeakMap();

// Activities and mistakes from the CLI's files plus v1.2.x's one-file-per-entry
// fallback files (Activity\<time>_activity.json / _mistake.json), from both stores.
function collectEntries(dirs) {
  const activities = [];
  const mistakes = [];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    const from = (list) => { for (const e of list) if (e && typeof e === 'object') entrySource.set(e, dir); return list; };
    mistakes.push(...from(readJsonLines(path.join(dir, 'MISTAKES.jsonl'))));
    const actDir = path.join(dir, 'Activity');
    if (!fs.existsSync(actDir)) continue;
    let files = [];
    try { files = fs.readdirSync(actDir); } catch { /* skip */ }
    for (const f of files) {
      const full = path.join(actDir, f);
      if (f.endsWith('.jsonl')) {
        activities.push(...from(readJsonLines(full)));
      } else if (f.endsWith('_activity.json') || f.endsWith('_mistake.json')) {
        try {
          const o = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
          (f.endsWith('_mistake.json') ? mistakes : activities).push(...from([o]));
        } catch { /* skip */ }
      }
    }
  }
  // The same entry can exist in both stores (or twice after a merge): keep one.
  const unique = (list, field) => {
    const seen = new Set();
    return list.filter(e => {
      const k = `${String(e.timestamp || '').slice(0, 19)}|${oneLine(e[field], 200)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const byNewest = (a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
  return {
    activities: unique(activities, 'description').sort(byNewest),
    mistakes: unique(mistakes, 'mistake').sort(byNewest),
  };
}

const oneLine = (s, n = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '...' : t;
};
const day = (ts) => (ts ? String(ts).slice(0, 10) : '????-??-??');

// Keyword overlap between a planned action and recorded mistakes. Words of 4+ letters,
// minus common ones; a mistake matches when it shares at least 3 such words with the
// plan and they make up at least 30% of the smaller of the two word sets.
// MUST STAY IN STEP with the CLI's MistakeMatching in MemorySchemas.cs: same word
// pattern, same stop words, same thresholds, so the CLI and MCP agree.
const STOP = new Set(('that this with from have been were into when then than they them their there these those ' +
  'what which while will would should could about after before because does done just only also very more most ' +
  'some such each other over same make made using used file files code instead').split(' '));
function keywords(s) {
  return new Set(String(s || '').toLowerCase().match(/[a-z0-9_.\-]{4,}/g)?.filter(w => !STOP.has(w)) || []);
}
function similarMistakes(plan, mistakes, max = 3) {
  const planWords = keywords(plan);
  const scored = [];
  const seen = new Set();
  for (const m of mistakes) {
    const key = oneLine(m.mistake, 400);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const words = keywords(`${m.mistake ?? ''} ${m.lesson ?? ''}`);
    if (words.size === 0) continue;
    const shared = [...words].filter(w => planWords.has(w));
    const score = shared.length / Math.max(1, Math.min(words.size, planWords.size));
    if (shared.length >= 3 && score >= 0.3) scored.push({ m, shared, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max);
}

function buildContext(projectPath, cliLoad, createdNow) {
  const dir = projectMemoryDir(projectPath);
  const legacy = legacyMemoryDir(projectPath);
  const name = projectName(projectPath);
  const parts = [`=== ClaudeDevStudio memory: ${name} ===`, `Memory folder: ${dir}`];
  if (createdNow) parts.push('New project: memory was created just now. Record activities and mistakes as you work.');

  const session = cliLoad.stdout.split('\n').filter(l => !/Context loaded in/i.test(l)).join('\n').trim();
  if (cliLoad.code !== 0) parts.push(`\n--- Session ---\n(claudedev load failed: ${oneLine(cliMessage(cliLoad))})`);
  else if (session) parts.push(`\n--- Session ---\n${session}`);

  const handoff = readText(path.join(dir, 'session_handoff.md'), 3000);
  if (handoff) parts.push(`\n--- Last handoff ---\n${handoff}`);
  for (const [label, file] of [['Facts', 'FACTS.md'], ['Uncertainties', 'UNCERTAINTIES.md']]) {
    const md = readText(path.join(dir, file));
    if (md && hasRealContent(md)) parts.push(`\n--- ${label} ---\n${md}`);
  }

  const dirs = legacy !== dir ? [dir, legacy] : [dir];
  const { activities, mistakes } = collectEntries(dirs);

  const shownMistakes = mistakes.slice(0, 25);
  const shownActivities = activities.slice(0, 15);

  if (mistakes.length) {
    parts.push(`\n--- Mistakes to avoid (${mistakes.length}, newest first) ---`);
    for (const m of shownMistakes) {
      parts.push(`- [${day(m.timestamp)}] ${oneLine(m.mistake, 200)} | lesson: ${oneLine(m.lesson, 200)}`);
    }
  }

  const decisions = readJsonLines(path.join(dir, 'DECISIONS.jsonl')).slice(-10).reverse();
  if (decisions.length) {
    parts.push(`\n--- Recent decisions ---`);
    for (const d of decisions) parts.push(`- [${day(d.timestamp)}] ${oneLine(d.decision, 200)}${d.reasoning ? ` (why: ${oneLine(d.reasoning, 150)})` : ''}`);
  }

  const patterns = readJsonLines(path.join(dir, 'PATTERNS.jsonl'))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 10);
  if (patterns.length) {
    parts.push(`\n--- Patterns ---`);
    for (const p of patterns) parts.push(`- (${p.confidence ?? '?'}%) ${oneLine(p.pattern, 200)}`);
  }

  if (activities.length) {
    parts.push(`\n--- Recent activity (${Math.min(15, activities.length)} of ${activities.length}, newest first) ---`);
    for (const a of shownActivities) {
      parts.push(`- [${day(a.timestamp)}] ${a.action || 'activity'}: ${oneLine(a.description, 250)}${a.file ? ` (${oneLine(a.file, 120)})` : ''}`);
    }
  } else {
    parts.push('\n(No recorded activity yet.)');
  }

  // Only when something listed above really came from the old store.
  const showsLegacy = legacy !== dir &&
    [...shownMistakes, ...shownActivities].some(e => entrySource.get(e) === legacy);
  if (showsLegacy) {
    parts.push(`\nNote: older entries were also read from ${legacy} (written by CDS v1.2.x). They are shown above; nothing there is changed.`);
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Chat mirror (checkpoint / resume)
// ---------------------------------------------------------------------------

function mirrorLog(type, data) {
  try {
    const file = mirrorPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n', 'utf8');
    const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean);
    if (lines.length > MIRROR_MAX_LINES) mirrorTrim(file, lines);
  } catch { /* never break a tool call over logging */ }
}

function mirrorTrim(file, lines) {
  try {
    const now = Date.now();
    const kept = lines.filter(line => {
      try {
        const e = JSON.parse(line);
        const age = now - new Date(e.ts).getTime();
        return e.type === 'checkpoint' ? age < MIRROR_CKPT_TTL_MS : age < MIRROR_TOOL_TTL_MS;
      } catch { return false; }
    });
    fs.writeFileSync(file, kept.join('\n') + '\n', 'utf8');
  } catch { /* silent */ }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const INSTRUCTIONS =
  'ClaudeDevStudio gives Claude persistent memory of a software project across sessions. ' +
  'At the start of work on a project, call claudedev_load with the project folder (it creates the memory the first time). ' +
  'Before a risky or repeated step, call claudedev_check_mistake. ' +
  'After meaningful work, call claudedev_record_activity; when something goes wrong, call claudedev_record_mistake with the lesson.';

const PROJECT_PATH = { type: 'string', description: 'Full path to the project folder, e.g. C:\\Projects\\MyApp' };

const TOOLS = [
  {
    name: 'claudedev_init',
    description: 'Create CDS memory for a project. Optional: claudedev_load does this automatically the first time.',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_load',
    description: 'Load the project\'s memory (recent work, mistakes, decisions) at the start of a session. Creates the memory if it is new.',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_record_activity',
    description: 'Record work done to the project\'s memory. Call after meaningful tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        action: { type: 'string', description: 'Kind of work: code_change, fix, debug, build, release, decision, etc.' },
        description: { type: 'string', description: 'What was done and why' },
        file: { type: 'string', description: 'Main file involved (optional)' },
        outcome: { type: 'string', description: 'success (default) or failed' },
      },
      required: ['project_path', 'action', 'description'],
    },
  },
  {
    name: 'claudedev_record_mistake',
    description: 'Record a mistake and its lesson so it is not repeated.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        mistake: { type: 'string', description: 'What went wrong' },
        impact: { type: 'string', description: 'What it caused' },
        fix: { type: 'string', description: 'How it was fixed' },
        lesson: { type: 'string', description: 'What to do differently' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Default medium' },
      },
      required: ['project_path', 'mistake', 'impact', 'fix', 'lesson'],
    },
  },
  {
    name: 'claudedev_check_mistake',
    description: 'Check a planned action against the project\'s recorded mistakes before doing it.',
    inputSchema: {
      type: 'object',
      properties: { project_path: PROJECT_PATH, action_description: { type: 'string', description: 'The action you plan to take' } },
      required: ['project_path', 'action_description'],
    },
  },
  {
    name: 'claudedev_stats',
    description: 'Show memory statistics for a project.',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_monitor_start',
    description: 'Start capturing Visual Studio debug output into the project\'s memory (needs Sysinternals DebugView installed).',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_chat_checkpoint',
    description: 'Save a short checkpoint to the session log. Survives context drops.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'What to record (under 300 characters)' } },
      required: ['text'],
    },
  },
  {
    name: 'claudedev_chat_resume',
    description: 'Recover context after a session drop: recent checkpoints and tool activity.',
    inputSchema: {
      type: 'object',
      properties: { hours: { type: 'number', description: 'Hours of tool history to show (default 4)' } },
      required: [],
    },
  },
];

class ClaudeDevStudioServer {
  constructor() {
    this.server = new Server(
      { name: 'claudedevstudio', version: VERSION },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
    );
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    this.server.setRequestHandler(CallToolRequestSchema, (request) => this.callTool(request));
  }

  async callTool(request) {
    const { name, arguments: args } = request.params;
    let result;
    try {
      switch (name) {
        case 'claudedev_init':            result = await this.handleInit(args); break;
        case 'claudedev_load':            result = await this.handleLoad(args); break;
        case 'claudedev_record_activity': result = await this.handleRecordActivity(args); break;
        case 'claudedev_record_mistake':  result = await this.handleRecordMistake(args); break;
        case 'claudedev_check_mistake':   result = await this.handleCheckMistake(args); break;
        case 'claudedev_stats':           result = await this.handleStats(args); break;
        case 'claudedev_monitor_start':   result = await this.handleMonitorStart(args); break;
        case 'claudedev_chat_checkpoint': return this.handleChatCheckpoint(args);
        case 'claudedev_chat_resume':     return this.handleChatResume(args);
        default: return fail(`Unknown tool: ${name}`);
      }
    } catch (error) {
      result = fail(`Error: ${error.message}`);
    }
    const summary = (result?.content?.[0]?.text ?? '').slice(0, 120).replace(/\n/g, ' ');
    mirrorLog('tool', { tool: name, summary });
    return result;
  }

  async handleInit(args) {
    const p = requireProjectPath(args);
    const r = await runCli(['init', p]);
    if (r.code !== 0) return fail(`Could not create memory for ${projectName(p)}.\n${cliMessage(r)}`);
    return text(`\u2713 Memory ready for ${projectName(p)}.\nMemory folder: ${projectMemoryDir(p)}\nNext: call claudedev_load.`);
  }

  async handleLoad(args) {
    const p = requireProjectPath(args);
    let createdNow = false;
    if (!fs.existsSync(path.join(projectMemoryDir(p), 'session_state.json'))) {
      const init = await runCli(['init', p]);
      if (init.code !== 0) return fail(`Could not create memory for ${projectName(p)}.\n${cliMessage(init)}`);
      createdNow = true;
    }
    const load = await runCli(['load', p]);
    return text(buildContext(p, load, createdNow));
  }

  async handleRecordActivity(args) {
    const p = requireProjectPath(args);
    if (!args.action || !args.description) return fail('action and description are required.');
    const outcome = args.outcome ? String(args.outcome).trim() : '';
    const description = outcome && outcome.toLowerCase() !== 'success'
      ? `${args.description} [outcome: ${outcome}]` : String(args.description);
    const entry = { action: String(args.action), description };
    if (args.file) entry.file = String(args.file);
    const r = await runCli(['record', p, 'activity', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Activity was NOT recorded for ${projectName(p)}.\n${cliMessage(r)}`);
    return text(`\u2713 Activity recorded for ${projectName(p)}: ${oneLine(args.action, 60)}`);
  }

  async handleRecordMistake(args) {
    const p = requireProjectPath(args);
    for (const k of ['mistake', 'impact', 'fix', 'lesson']) {
      if (!args[k]) return fail(`${k} is required.`);
    }
    const entry = {
      mistake: String(args.mistake), impact: String(args.impact),
      fix: String(args.fix), lesson: String(args.lesson),
      severity: ['low', 'medium', 'high', 'critical'].includes(args.severity) ? args.severity : 'medium',
    };
    const r = await runCli(['record', p, 'mistake', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Mistake was NOT recorded for ${projectName(p)}.\n${cliMessage(r)}`);
    return text(`\u2713 Mistake recorded for ${projectName(p)}. claudedev_check_mistake will now warn on similar actions.`);
  }

  // Two checks: the CLI's (it matches only when the planned action contains a recorded
  // mistake's whole sentence) and a keyword-overlap check here, which also covers the
  // v1.2.x store. A real fix of the CLI's matching is planned (docs\GROUND_TRUTH.md).
  async handleCheckMistake(args) {
    const p = requireProjectPath(args);
    if (!args.action_description) return fail('action_description is required.');
    const plan = String(args.action_description);
    const r = await runCli(['check', p, plan]);
    const cliHit = /Mistake ID:/i.test(r.stdout);
    if (!cliHit && r.code !== 0) return fail(`The mistake check could not run.\n${cliMessage(r)}`);

    const dirs = [...new Set([projectMemoryDir(p), legacyMemoryDir(p)])];
    const hits = similarMistakes(plan, collectEntries(dirs).mistakes);
    if (!cliHit && hits.length === 0) return text(`\u2713 No recorded mistake matches this action in ${projectName(p)}.`);

    const out = [`\u26a0 This plan resembles ${cliHit ? 'a' : hits.length} recorded mistake${hits.length > 1 ? 's' : ''} in ${projectName(p)}:`];
    if (cliHit) out.push(r.stdout);
    for (const { m, shared } of hits) {
      out.push(`- [${day(m.timestamp)}] ${oneLine(m.mistake, 220)}\n  lesson: ${oneLine(m.lesson, 220)}\n  fix: ${oneLine(m.fix, 220)}\n  (shared words: ${shared.join(', ')})`);
    }
    return text(out.join('\n'));
  }

  // Counts what is actually stored. (The CLI's own stats report uptime, a token counter
  // that is never updated, and today's activity only.)
  async handleStats(args) {
    const p = requireProjectPath(args);
    const dir = projectMemoryDir(p);
    const legacy = legacyMemoryDir(p);
    if (!fs.existsSync(dir) && !fs.existsSync(legacy)) {
      return text(`No memory yet for ${projectName(p)}. claudedev_load creates it.`);
    }
    const { activities, mistakes } = collectEntries([...new Set([dir, legacy])]);
    const decisions = readJsonLines(path.join(dir, 'DECISIONS.jsonl'));
    const patterns = readJsonLines(path.join(dir, 'PATTERNS.jsonl'));
    let session = '';
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'session_state.json'), 'utf8').replace(/^\uFEFF/, ''));
      session = s.sessionId || s.session_id || '';
    } catch { /* none */ }
    const lines = [
      `=== ClaudeDevStudio memory stats: ${projectName(p)} ===`,
      `Memory folder: ${dir}`,
      `Activities: ${activities.length}${activities.length ? ` (latest ${day(activities[0].timestamp)}, first ${day(activities[activities.length - 1].timestamp)})` : ''}`,
      `Mistakes:   ${mistakes.length}`,
      `Decisions:  ${decisions.length}`,
      `Patterns:   ${patterns.length}`,
    ];
    if (session) lines.push(`Session:    ${session}`);
    // Only when an old-store entry was counted (same source tracking as buildContext).
    const countsLegacy = legacy !== dir &&
      [...activities, ...mistakes].some(e => entrySource.get(e) === legacy);
    if (countsLegacy) lines.push(`(Includes older entries from ${legacy}.)`);
    return text(lines.join('\n'));
  }

  // The CLI's monitor runs until stopped, so it is started detached with its output in
  // a log file. Before v1.3.0 it ran under a 30-second timeout that killed it.
  async handleMonitorStart(args) {
    const p = requireProjectPath(args);
    if (!fs.existsSync(CLAUDEDEV_PATH)) return fail(`claudedev.exe not found at ${CLAUDEDEV_PATH}.`);
    const dir = projectMemoryDir(p);
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, 'monitor.log');
    const fd = fs.openSync(logPath, 'w');
    let child;
    try {
      child = spawn(CLAUDEDEV_PATH, ['monitor', p], { detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    let exitCode = null;
    child.on('exit', (code) => { exitCode = code; });
    child.unref();
    await new Promise(r => setTimeout(r, 3000));
    const log = cleanCliText(readText(logPath, 2000));
    if (exitCode !== null) return fail(`The debug monitor stopped right away (exit code ${exitCode}).\n${log}`);
    return text(`\u2713 Debug monitor running (PID ${child.pid}). Log: ${logPath}\n${log}`);
  }

  handleChatCheckpoint(args) {
    const t = (args && args.text) ? String(args.text).trim() : '';
    if (!t) return fail('[mirror] No text provided.');
    mirrorLog('checkpoint', { text: t });
    return text(`[mirror] Checkpoint saved: "${t.slice(0, 80)}${t.length > 80 ? '...' : ''}"`);
  }

  // Reads the current log and, until the stores are merged, the v1.2.x log as well.
  handleChatResume(args) {
    try {
      const hours = (args && args.hours) ? Number(args.hours) : 4;
      const toolCutoff = Date.now() - hours * 60 * 60 * 1000;
      const ckptCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const files = [...new Set([mirrorPath(), legacyMirrorPath()])].filter(f => fs.existsSync(f));
      if (files.length === 0) return text('[mirror] No chat mirror log found. Starting fresh.');
      const seen = new Set();
      const entries = [];
      for (const f of files) {
        for (const e of readJsonLines(f)) {
          const ts = new Date(e.ts).getTime();
          const key = `${e.ts}|${e.type}|${e.text || e.tool || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if ((e.type === 'checkpoint' && ts >= ckptCutoff) || (e.type === 'tool' && ts >= toolCutoff)) entries.push(e);
        }
      }
      if (entries.length === 0) return text('[mirror] No recent entries found.');
      entries.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      const lines = entries.map(e => {
        const when = new Date(e.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return e.type === 'checkpoint' ? `[${when}] * CHECKPOINT: ${e.text}` : `[${when}]   tool: ${e.tool} -> ${e.summary}`;
      });
      return text(`=== Chat Mirror Resume (checkpoints: 7 days, tools: ${hours}h) ===\n` + lines.join('\n'));
    } catch (err) {
      return fail(`[mirror] Error reading log: ${err.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`ClaudeDevStudio MCP server v${VERSION} running on stdio`);
  }
}

new ClaudeDevStudioServer().run().catch(console.error);
