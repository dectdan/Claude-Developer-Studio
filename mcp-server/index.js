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
//
// P3 (2026-11-11): load leads with the project's own state (the last handoff, the ground
// truth's Status and Next, the newest docs\Pn_OUTPUT.md) under a size budget; projects
// without a ground truth are offered claudedev_scaffold (templates\); claudedev_handoff and
// claudedev_record_decision write through the CLI. The scaffold writes into the user's
// project, not the memory, so it is the one tool that writes files itself.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { HOME, memoryRoot } from './cds-paths.js';

// The version is set in package.json beside this file (checked by tools\check-versions.ps1).
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || 'unknown'; }
  catch { return 'unknown'; }
})();
// The scaffold's templates (docs\GROUND_TRUTH.md, CONVENTIONS.md, HOW_WE_WORK.md for a project).
const TEMPLATES_DIR = fileURLToPath(new URL('./templates/', import.meta.url));
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
// Windows' Documents redirection (OneDrive). memoryRoot() (cds-paths.js, shared with
// workbench.js) asks Windows for the very same folder, once.

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

// " (HND004)" when the CLI's output names the new entry's ID.
const idIn = (r, prefix) => { const m = new RegExp(`\\b${prefix}\\d{3,}\\b`).exec(r.stdout); return m ? ` (${m[0]})` : ''; };

// A CLI from before v1.4 has no "handoff" record type.
const olderCliHint = (r) => /Unknown record type/i.test(cliMessage(r))
  ? 'The installed claudedev.exe is older than this server and has no handoffs: update ClaudeDevStudio.\n' : '';

const SCAFFOLD_FILES = ['GROUND_TRUTH.md', 'CONVENTIONS.md', 'HOW_WE_WORK.md'];

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

// ---------------------------------------------------------------------------
// The project's own docs (read-only): the ground truth and the newest Pn_OUTPUT.md
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localStamp = (d) => `${localDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// "just now", "5 minutes ago", "3 hours ago", "yesterday", "12 days ago".
function ago(d) {
  const mins = (Date.now() - d.getTime()) / 60000;
  if (!(mins >= 1.5)) return 'just now';
  if (mins < 60) return `${Math.round(mins)} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(mins / 1440);
  if (days <= 1) return 'yesterday';
  return days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`;
}

function readDoc(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); } catch { return null; }
}
function listMd(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && /\.md$/i.test(e.name)).map(e => e.name); }
  catch { return []; }
}
const mtimeMs = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const newestFirst = (files) => files.sort((a, b) => mtimeMs(b) - mtimeMs(a));

// The ground truth: docs\GROUND_TRUTH.md; else any docs\*GROUND*TRUTH*.md (the newest, for
// names like "NAME - GROUND TRUTH (READ FIRST).md"); else GROUND_TRUTH.md at the root.
function findGroundTruth(projectPath) {
  const docs = path.join(projectPath, 'docs');
  const names = listMd(docs);
  const exact = names.find(n => n.toLowerCase() === 'ground_truth.md');
  if (exact) return path.join(docs, exact);
  const loose = newestFirst(names.filter(n => /ground.*truth/i.test(n)).map(n => path.join(docs, n)));
  if (loose.length) return loose[0];
  const atRoot = listMd(projectPath).find(n => n.toLowerCase() === 'ground_truth.md');
  return atRoot ? path.join(projectPath, atRoot) : null;
}

// The newest docs\P*_OUTPUT.md, by modified time.
function findNewestOutput(projectPath) {
  const docs = path.join(projectPath, 'docs');
  return newestFirst(listMd(docs).filter(n => /^P.*_OUTPUT\.md$/i.test(n)).map(n => path.join(docs, n)))[0] || null;
}

// Markdown headings outside code fences: { i (line index), level, text }.
function mdHeadings(lines) {
  const out = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ i, level: m[1].length, text: m[2] });
  });
  return out;
}

// A section's lines: up to the next heading of the same or a higher level, or a "---" rule
// that comes right before a heading (the usual divider between sections).
function sectionLines(lines, heads, h) {
  const next = heads.find(x => x.i > h.i && x.level <= h.level);
  let end = next ? next.i : lines.length;
  for (let i = h.i + 1; i < end; i++) {
    if (!/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (heads.some(x => x.i === j)) { end = i; break; }
  }
  return lines.slice(h.i + 1, end);
}

function trimBlank(lines) {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

// The first lines within max characters. { text, cut }.
function headLines(lines, max) {
  lines = trimBlank(lines);
  const out = [];
  let size = 0;
  for (const l of lines) {
    if (size + l.length + 1 > max) {
      if (!out.length) out.push(l.slice(0, max) + '...');
      return { text: out.join('\n'), cut: true };
    }
    out.push(l);
    size += l.length + 1;
  }
  return { text: out.join('\n'), cut: false };
}

// The last lines within max characters, starting where an entry starts (not on an indented
// continuation line). Status logs grow downward, so the end is the news. { text, cut, from }.
function tailLines(lines, max) {
  lines = trimBlank(lines);
  const all = lines.join('\n');
  if (all.length <= max) return { text: all, cut: false, from: 0 };
  let start = lines.length, size = 0;
  while (start > 0 && size + lines[start - 1].length + 1 <= max) { start--; size += lines[start].length + 1; }
  let s = start;
  while (s < lines.length && (!lines[s].trim() || /^\s/.test(lines[s]))) s++;
  if (s >= lines.length) return { text: '...' + all.slice(-max), cut: true, from: lines.length - 1 };
  return { text: lines.slice(s).join('\n'), cut: true, from: s };
}

const GT_STATUS_MAX = 2500;
const GT_HEAD_MAX = 1500;
const GT_QUESTIONS_MAX = 800;
const OUTPUT_FIRST_MAX = 1500;
const HANDOFF_MAX = 2500;

// What load shows from the ground truth: the fixed part (path, title, Last updated, the end
// of Status and its Next line) and the Open questions (trimmable).
function groundTruthSection(projectPath) {
  const file = findGroundTruth(projectPath);
  if (!file) return null;
  const rel = path.relative(projectPath, file);
  const lines = (readDoc(file) || '').split('\n');
  const heads = mdHeadings(lines);
  const titleHead = heads.find(h => h.level === 1);
  const out = [`\n--- Ground truth: ${rel} ---`];
  if (titleHead) out.push(`# ${oneLine(titleHead.text, 200)}`);
  const updated = lines.slice(0, 40).find(l => /last updated/i.test(l));
  if (updated) out.push(oneLine(updated, 300));

  const statusHead = heads.find(h => h !== titleHead && /status/i.test(h.text));
  if (statusHead) {
    const body = sectionLines(lines, heads, statusHead);
    const tail = tailLines(body, GT_STATUS_MAX);
    out.push(`${'#'.repeat(statusHead.level)} ${statusHead.text}${tail.cut ? ' (the last lines)' : ''}`);
    if (tail.cut) out.push(`[... earlier lines: ${rel}, line ${statusHead.i + 1}]`);
    out.push(tail.text);
    // The Next line: the last one in Status; if Status has none, the last one in the file.
    const isNext = (l) => /\*\*Next:?\*\*/i.test(l);
    const trimmed = trimBlank(body);
    let nextIdx = -1;
    for (let k = trimmed.length - 1; k >= 0; k--) if (isNext(trimmed[k])) { nextIdx = k; break; }
    if (nextIdx >= 0) {
      if (nextIdx < tail.from) out.push(`Next: ${oneLine(trimmed[nextIdx].replace(/\*\*Next:?\*\*:?/i, ''), 500)}`);
    } else {
      let fence = false, nextLine = null;
      for (const l of lines) {
        if (/^\s*(```|~~~)/.test(l)) fence = !fence;
        else if (!fence && isNext(l)) nextLine = l;
      }
      if (nextLine) out.push(`Next (from elsewhere in the file): ${oneLine(nextLine.replace(/\*\*Next:?\*\*:?/i, ''), 500)}`);
    }
  } else {
    const start = titleHead ? titleHead.i + 1 : 0;
    const head = headLines(lines.slice(start), GT_HEAD_MAX);
    out.push('(No Status heading; the start of the file:)', head.text);
    if (head.cut) out.push(`[... the rest: ${rel}]`);
  }

  // Open questions: only items still open (a struck-through ~~item~~ is settled).
  let questions = null;
  const qHead = heads.find(h => /open questions?/i.test(h.text));
  if (qHead) {
    const kept = [];
    let skipping = false;
    for (const l of trimBlank(sectionLines(lines, heads, qHead))) {
      if (!l.trim()) continue;
      const item = /^(\s*)(\d+[.)]|[-*])\s+(.*)$/.exec(l);
      if (item && !item[1]) skipping = /^~~/.test(item[3]);
      else if (!/^\s/.test(l)) skipping = false;
      if (!skipping) kept.push(l);
    }
    const none = !kept.length || /^none\b/i.test(kept[0].replace(/[*_]/g, '').trim());
    if (!none) {
      const head = headLines(kept, GT_QUESTIONS_MAX);
      const title = `${'#'.repeat(qHead.level)} ${qHead.text} (still open)`;
      questions = [
        [title, head.text, ...(head.cut ? [`[... more: ${rel}, line ${qHead.i + 1}]`] : [])],
        [`(${qHead.text}: ${kept.length} open lines, not shown to keep load short: ${rel}, line ${qHead.i + 1})`],
      ];
    }
  }

  // The rest of the method, if missing: one line.
  const has = (name) => fs.existsSync(path.join(projectPath, 'docs', name)) || fs.existsSync(path.join(projectPath, name));
  const missing = ['CONVENTIONS.md', 'HOW_WE_WORK.md'].filter(n => !has(n));
  const note = missing.length
    ? `(No docs\\${missing.join(' or docs\\')}: claudedev_scaffold can add ${missing.length > 1 ? 'them' : 'it'}; it never overwrites. Offer it; don't just do it.)`
    : null;
  return { fixed: out, questions, note };
}

const NO_GROUND_TRUTH = [
  '\n--- No ground truth ---',
  'This project has no docs\\GROUND_TRUTH.md.',
  'One file for status, decisions and next steps lets any session pick up where the last one stopped,',
  'with fewer tokens spent re-explaining the project.',
  'Offer claudedev_scaffold to the user (it adds docs\\GROUND_TRUTH.md, CONVENTIONS.md and HOW_WE_WORK.md from templates, never overwriting). Create them only if the user agrees: it is their repository.',
];

// The newest Pn_OUTPUT.md: its title, its first section (usually the owner's steps), and a
// one-line list of its other sections. Variants, largest first.
function outputSection(projectPath) {
  const file = findNewestOutput(projectPath);
  if (!file) return null;
  const rel = path.relative(projectPath, file);
  const lines = (readDoc(file) || '').split('\n');
  const heads = mdHeadings(lines);
  const titleHead = heads.find(h => h.level === 1);
  const h2 = heads.filter(h => h.level === 2);
  const start = titleHead ? titleHead.i + 1 : 0;
  const end = h2.length >= 2 ? h2[1].i : lines.length;
  const others = h2.slice(h2.length >= 2 ? 1 : h2.length).map(h => oneLine(h.text, 80));
  const top = [`\n--- Newest output: ${rel} (${localDate(new Date(mtimeMs(file)))}) ---`];
  if (titleHead) top.push(`# ${oneLine(titleHead.text, 200)}`);
  const othersLine = others.length ? [`Other sections: ${oneLine(others.join(' · '), 500)}`] : [];
  const variant = (max) => {
    const head = headLines(lines.slice(start, end), max);
    return [...top, head.text, ...(head.cut ? [`[... the rest of this section: ${rel}]`] : []), ...othersLine];
  };
  return [variant(OUTPUT_FIRST_MAX), variant(700), [...top, `(Not shown to keep load short: ${rel})`, ...othersLine]];
}

// The latest handoff (session_handoff.md, written by the CLI), with its age.
function handoffSection(dir) {
  const file = path.join(dir, 'session_handoff.md');
  const raw = readDoc(file);
  if (!raw || !raw.trim()) return null;
  let lines = trimBlank(raw.split('\n'));
  const marker = /^<!--\s*cds-handoff:\s*(\w+)\s*-->$/.exec((lines[0] || '').trim());
  const kind = marker ? (marker[1] === 'explicit' ? 'explicit' : 'automatic') : 'automatic, older format';
  if (marker) lines = trimBlank(lines.slice(1));
  if (/^#\s/.test(lines[0] || '')) lines = lines.slice(1);
  let when = null;
  const at = lines.findIndex(l => /^\*(Written|Generated:?)\s+\d{4}-\d\d-\d\d/.test(l.trim()));
  if (at >= 0) {
    const m = /(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d)/.exec(lines[at]);
    if (m) when = new Date(`${m[1]}T${m[2]}:00`);
    lines.splice(at, 1);
  }
  if (!when || isNaN(when.getTime())) when = new Date(mtimeMs(file));
  const head = headLines(lines, HANDOFF_MAX);
  return [
    `\n--- Last handoff (${ago(when)}, ${localStamp(when)}, ${kind}) ---`,
    head.text,
    ...(head.cut ? [`[... the rest: ${file}]`] : []),
  ];
}

// ---------------------------------------------------------------------------
// load: the context Claude sees on walking in
// ---------------------------------------------------------------------------

// load aims at LOAD_TARGET characters and never passes LOAD_MAX. Sections are trimmed from the
// lowest up (activity, then patterns, ...); the handoff and the ground truth's Status never.
const LOAD_TARGET = 8000;
const LOAD_MAX = 12000;

function buildContext(projectPath, cliLoad, createdNow) {
  const dir = projectMemoryDir(projectPath);
  const legacy = legacyMemoryDir(projectPath);
  const name = projectName(projectPath);
  const memFile = (f) => path.join(dir, f);

  // Each section is a list of variants, largest first; a variant is { lines, shown }.
  const sections = [];
  const add = (key, ...variants) => sections.push({ key, variants: variants.map(v => (Array.isArray(v) ? { lines: v, shown: [] } : v)), at: 0 });

  const header = [`=== ClaudeDevStudio: ${name} ===`, `Memory folder: ${dir}`];
  if (createdNow) header.push('New project: memory was created just now. Record activities and mistakes as you work.');
  if (cliLoad.code !== 0) header.push(`(claudedev load failed: ${oneLine(cliMessage(cliLoad))})`);
  add('header', header);

  // Anything the CLI's load says beyond the session ID (a current task, pending decisions).
  const session = cliLoad.stdout.split('\n')
    .filter(l => l.trim() && !/Context loaded in|^Session:|^Started:/i.test(l.trim())).join('\n').trim();
  if (cliLoad.code === 0 && session) add('session', ['\n--- Session ---', oneLine(session, 1200)]);

  const handoff = handoffSection(dir);
  if (handoff) add('handoff', handoff);

  const gt = groundTruthSection(projectPath);
  if (gt) {
    add('ground_truth', gt.fixed);
    if (gt.questions) add('questions', ...gt.questions);
    if (gt.note) add('method_note', [gt.note]);
  } else {
    add('no_ground_truth', NO_GROUND_TRUTH);
  }

  const output = outputSection(projectPath);
  if (output) add('output', ...output);

  const dirs = legacy !== dir ? [dir, legacy] : [dir];
  const { activities, mistakes } = collectEntries(dirs);

  if (mistakes.length) {
    add('mistakes', ...[10, 5, 3].map(n => {
      const shown = mistakes.slice(0, n);
      const lines = [`\n--- Mistakes to avoid (newest ${shown.length} of ${mistakes.length}) ---`,
        ...shown.map(m => `- [${day(m.timestamp)}] ${oneLine(m.mistake, 160)} | lesson: ${oneLine(m.lesson, 160)}`)];
      if (shown.length < mistakes.length) lines.push(`(${mistakes.length - shown.length} older in ${memFile('MISTAKES.jsonl')}; claudedev_check_mistake checks them all.)`);
      return { lines, shown };
    }));
  }

  const decisions = readJsonLines(memFile('DECISIONS.jsonl'))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  if (decisions.length) {
    add('decisions', ...[5, 3, 1].map(n => {
      const shown = decisions.slice(0, n);
      const lines = [`\n--- Decisions (newest ${shown.length} of ${decisions.length}) ---`,
        ...shown.map(d => `- [${day(d.timestamp)}]${d.id ? ` ${d.id}` : ''} ${oneLine(d.decision || d.chose, 180)}${d.reasoning ? ` | why: ${oneLine(d.reasoning, 180)}` : ''}`)];
      if (shown.length < decisions.length) lines.push(`(${decisions.length - shown.length} older in ${memFile('DECISIONS.jsonl')}.)`);
      return lines;
    }));
  }

  for (const [label, file] of [['Facts', 'FACTS.md'], ['Uncertainties', 'UNCERTAINTIES.md']]) {
    const md = readText(memFile(file), 100000);
    if (md && hasRealContent(md)) {
      const head = headLines(md.split('\n'), 600);
      add(label.toLowerCase(),
        [`\n--- ${label} ---`, head.text, ...(head.cut ? [`[... the rest: ${memFile(file)}]`] : [])],
        [`\n(${label}: not shown to keep load short: ${memFile(file)})`]);
    }
  }

  const patterns = readJsonLines(memFile('PATTERNS.jsonl')).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  if (patterns.length) {
    add('patterns', ...[5, 2].map(n => {
      const shown = patterns.slice(0, n);
      const lines = [`\n--- Patterns (top ${shown.length} of ${patterns.length}) ---`, ...shown.map(p => `- (${p.confidence ?? '?'}%) ${oneLine(p.pattern, 180)}`)];
      if (shown.length < patterns.length) lines.push(`(All of them: ${memFile('PATTERNS.jsonl')}.)`);
      return lines;
    }), [`\n(${patterns.length} patterns, not shown to keep load short: ${memFile('PATTERNS.jsonl')})`]);
  }

  if (activities.length) {
    add('activity', ...[8, 4].map(n => {
      const shown = activities.slice(0, n);
      const lines = [`\n--- Recent activity (newest ${shown.length} of ${activities.length}) ---`,
        ...shown.map(a => `- [${day(a.timestamp)}] ${a.action || 'activity'}: ${oneLine(a.description, 200)}${a.file ? ` (${oneLine(a.file, 100)})` : ''}`)];
      if (shown.length < activities.length) lines.push(`(Older: ${path.join(dir, 'Activity')}; claudedev_stats counts them.)`);
      return { lines, shown };
    }), [`\n(${activities.length} activities, the latest on ${day(activities[0].timestamp)}; not shown to keep load short: ${path.join(dir, 'Activity')})`]);
  } else {
    add('activity', ['\n(No recorded activity yet.)']);
  }

  // Trim to the budget, lowest sections first. The handoff and the Status are never trimmed.
  const size = () => sections.reduce((n, s) => n + s.variants[s.at].lines.join('\n').length + 1, 0);
  for (const key of ['activity', 'patterns', 'uncertainties', 'facts', 'decisions', 'output', 'questions', 'mistakes']) {
    const s = sections.find(x => x.key === key);
    while (s && size() > LOAD_TARGET && s.at < s.variants.length - 1) s.at++;
  }

  const chosen = sections.map(s => s.variants[s.at]);
  // Only when something listed really came from the old store.
  const showsLegacy = legacy !== dir && chosen.some(v => v.shown.some(e => entrySource.get(e) === legacy));
  const parts = chosen.flatMap(v => v.lines);
  if (showsLegacy) parts.push(`\nNote: older entries were also read from ${legacy} (written by CDS v1.2.x). They are shown above; nothing there is changed.`);

  let out = parts.join('\n');
  if (out.length > LOAD_MAX) {
    const pointer = `\n[... load cut at ${LOAD_MAX} characters: the full files are in ${dir} and the project's docs\\]`;
    out = out.slice(0, LOAD_MAX - pointer.length) + pointer;
  }
  return out;
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

// Sent with every session: keep it short.
const INSTRUCTIONS =
  'ClaudeDevStudio keeps a software project\'s memory across sessions and teaches one way of working: ' +
  'a docs\\GROUND_TRUTH.md (status, decisions, next steps) and a handoff between sessions. ' +
  'At the start of work on a project, call claudedev_load with its folder: the last handoff, the ground truth\'s status, the newest output and the recorded mistakes. ' +
  'If it has no ground truth, offer claudedev_scaffold to the user; create it only if they agree. ' +
  'Before a risky step, call claudedev_check_mistake. ' +
  'As you go, record activities, mistakes (with the lesson) and decisions (with the reason). ' +
  'Before you stop, call claudedev_handoff: where you stopped and the next step.';

const PROJECT_PATH = { type: 'string', description: 'Full path to the project folder, e.g. C:\\Projects\\MyApp' };

const TOOLS = [
  {
    name: 'claudedev_init',
    description: 'Create CDS memory for a project. Optional: claudedev_load does this automatically the first time.',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_load',
    description: 'Start of work on a project: the last handoff, the ground truth\'s status, the newest output, mistakes and decisions. Creates the memory if new.',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_scaffold',
    description: 'Add docs\\GROUND_TRUTH.md, CONVENTIONS.md and HOW_WE_WORK.md from templates to a project without them. Never overwrites. Only if the user agrees.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        title: { type: 'string', description: 'Project name for the headings (default: the folder name)' },
        summary: { type: 'string', description: 'One paragraph: what the project is (optional)' },
      },
      required: ['project_path'],
    },
  },
  {
    name: 'claudedev_handoff',
    description: 'Before you stop: save where you stopped and the next step. The next claudedev_load shows it first.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        where_i_stopped: { type: 'string', description: 'What was done and where it stands' },
        next_step: { type: 'string', description: 'The very next thing to do' },
        open_questions: { type: 'array', items: { type: 'string' }, description: 'Questions waiting for the user (optional)' },
        notes: { type: 'string', description: 'Anything else the next session needs (optional)' },
      },
      required: ['project_path', 'where_i_stopped', 'next_step'],
    },
  },
  {
    name: 'claudedev_record_decision',
    description: 'Record a decision and why, so later sessions don\'t re-argue it.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        decision: { type: 'string', description: 'What was decided' },
        why: { type: 'string', description: 'The reason' },
        alternatives: { type: 'array', items: { type: 'string' }, description: 'Options not chosen (optional)' },
        file: { type: 'string', description: 'Main file involved (optional)' },
      },
      required: ['project_path', 'decision', 'why'],
    },
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
        case 'claudedev_scaffold':        result = this.handleScaffold(args); break;
        case 'claudedev_handoff':         result = await this.handleHandoff(args); break;
        case 'claudedev_record_decision': result = await this.handleRecordDecision(args); break;
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
      // "Created just now" only for a new memory folder; one without a session file (e.g.
      // filled by the store merge) just gets its session started.
      const existed = fs.existsSync(projectMemoryDir(p));
      const init = await runCli(['init', p]);
      if (init.code !== 0) return fail(`Could not create memory for ${projectName(p)}.\n${cliMessage(init)}`);
      createdNow = !existed;
    }
    const load = await runCli(['load', p]);
    return text(buildContext(p, load, createdNow));
  }

  // Writes the three method files into the user's project (not memory, so this server writes
  // them itself). Never overwrites: each file is created with the exclusive flag.
  handleScaffold(args) {
    const p = requireProjectPath(args);
    const templates = {};
    for (const name of SCAFFOLD_FILES) {
      const t = readDoc(path.join(TEMPLATES_DIR, name));
      if (t === null) return fail(`Nothing created: the template ${path.join(TEMPLATES_DIR, name)} is missing. Reinstall ClaudeDevStudio.`);
      templates[name] = t;
    }
    const title = oneLine(args.title || projectName(p), 120);
    const summary = args.summary && String(args.summary).trim()
      ? String(args.summary).trim()
      : '*(Not written yet: one paragraph on what this project is, who it is for, and what "done" looks like. Write it with the owner.)*';
    const date = localDate();
    const docs = path.join(p, 'docs');
    // A ground truth under another name (or at the root) is this project's: don't add a second one.
    const existingGt = findGroundTruth(p);
    const created = [], skipped = [];
    fs.mkdirSync(docs, { recursive: true });
    for (const name of SCAFFOLD_FILES) {
      const target = path.join(docs, name);
      const rel = path.relative(p, target);
      if (name === 'GROUND_TRUTH.md' && existingGt && path.resolve(existingGt).toLowerCase() !== target.toLowerCase()) {
        skipped.push(`${rel} (the project's ground truth is ${path.relative(p, existingGt)})`);
        continue;
      }
      const content = templates[name]
        .replace(/\{\{PROJECT\}\}/g, () => title)
        .replace(/\{\{DATE\}\}/g, () => date)
        .replace(/\{\{SUMMARY\}\}/g, () => summary)
        .replace(/\n/g, '\r\n');
      try {
        fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
        created.push(rel);
      } catch (e) {
        if (e.code !== 'EEXIST') return fail(`Stopped at ${rel}: ${e.message}\nCreated before that: ${created.join(', ') || 'nothing'}.`);
        skipped.push(`${rel} (already there, not changed)`);
      }
    }
    const out = [`Scaffold for ${title} (${docs}):`];
    out.push(created.length ? `Created: ${created.join(', ')}` : 'Created: nothing.');
    if (skipped.length) out.push(`Skipped: ${skipped.join('; ')}`);
    if (created.includes(path.join('docs', 'GROUND_TRUTH.md'))) {
      out.push('Next: fill in sections 1–3 of docs\\GROUND_TRUTH.md with the user (what this is, the status, where things are). claudedev_load shows its Status from now on.');
    } else if (created.length) {
      out.push('Next: read the new files with the user and add this project\'s own rules to docs\\CONVENTIONS.md.');
    }
    return text(out.join('\n'));
  }

  async handleHandoff(args) {
    const p = requireProjectPath(args);
    const where = String(args.where_i_stopped ?? '').trim();
    const next = String(args.next_step ?? '').trim();
    if (!where || !next) return fail('where_i_stopped and next_step are required.');
    let questions = args.open_questions ?? [];
    if (typeof questions === 'string') questions = questions.split(/\r?\n/);
    if (!Array.isArray(questions)) questions = [String(questions)];
    const entry = {
      where_i_stopped: where,
      next_step: next,
      open_questions: questions.map(q => String(q ?? '').trim()).filter(Boolean),
    };
    if (args.notes && String(args.notes).trim()) entry.notes = String(args.notes).trim();
    const r = await runCli(['record', p, 'handoff', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Handoff was NOT saved for ${projectName(p)}.\n${olderCliHint(r)}${cliMessage(r)}`);
    return text(`✓ Handoff saved for ${projectName(p)}${idIn(r, 'HND')}. The next claudedev_load shows it first.`);
  }

  async handleRecordDecision(args) {
    const p = requireProjectPath(args);
    const decision = String(args.decision ?? '').trim();
    const why = String(args.why ?? '').trim();
    if (!decision || !why) return fail('decision and why are required.');
    let alternatives = args.alternatives ?? [];
    if (typeof alternatives === 'string') alternatives = [alternatives];
    if (!Array.isArray(alternatives)) alternatives = [String(alternatives)];
    const entry = {
      decision, chose: decision, reasoning: why,
      alternatives_considered: alternatives.map(a => String(a ?? '').trim()).filter(Boolean),
    };
    if (args.file) entry.file = String(args.file);
    const r = await runCli(['record', p, 'decision', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Decision was NOT recorded for ${projectName(p)}.\n${cliMessage(r)}`);
    return text(`✓ Decision recorded for ${projectName(p)}${idIn(r, 'DEC')}: ${oneLine(decision, 80)}`);
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
