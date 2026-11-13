// cds-context.js -- the context Claude sees on walking into a project, shared by the memory
// MCP server (index.js, claudedev_load) and the Claude Code hook (cds-hook.js, session-start).
//
// Moved out of index.js unchanged in P4 (2026-11-11): reading the memory files and the project's
// docs\, calling the CLI, and buildContext with its size budget. loadProject() is what
// claudedev_load does: create the memory on first use (CLI init), then CLI load, then buildContext.
// The CLI owns the memory format and does every write; this module only reads files.

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { HOME, memoryRoot, conflictCopyOf } from './cds-paths.js';

const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
// CDS_CLI_PATH is for tests only (mcp-server\test\smoke.mjs --cli): it points the server at
// a freshly built claudedev.exe instead of the installed one. Normal use never sets it.
const CLAUDEDEV_PATH = process.env.CDS_CLI_PATH
  ? path.resolve(process.env.CDS_CLI_PATH)
  : path.join(LOCAL, 'ClaudeDevStudio', 'CLI', 'claudedev.exe');

// Where v1.2.x of this server wrote its own fallback files. Read-only from now on,
// so nothing written there in the past is lost before the stores are merged.
// CDS_LEGACY_ROOT is for tests only (smoke.mjs, P5): a throwaway old store. Normal use never sets it.
const LEGACY_ROOT = process.env.CDS_LEGACY_ROOT
  ? path.resolve(process.env.CDS_LEGACY_ROOT)
  : path.join(HOME, 'Documents', 'ClaudeDevStudio');

// The lessons for every project (P5): one machine-wide file at the memory root, written by the
// CLI (claudedev lesson add|edit|remove). load shows them in every project; check_mistake checks them.
const lessonsFile = () => path.join(memoryRoot(), 'LESSONS.jsonl');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// The CLI stores memory under Environment.SpecialFolder.MyDocuments, which follows
// Windows' Documents redirection (OneDrive). memoryRoot() (cds-paths.js, shared with
// workbench.js) asks Windows for the very same folder, once.

const projectName = (projectPath) => path.basename(projectPath);
const projectMemoryDir = (projectPath) => path.join(memoryRoot(), 'Projects', projectName(projectPath));
const legacyMemoryDir = (projectPath) => path.join(LEGACY_ROOT, 'Projects', projectName(projectPath));

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

// The file and any OneDrive conflict copies of it beside it (P10). The 1.7 CLI merges the copies on
// load before this reads; with an older CLI they are still read, so no entry is missing (duplicates
// are dropped by the readers).
function withConflictCopies(dir, file) {
  const out = [path.join(dir, file)];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* none */ }
  const base = file.replace(/\.jsonl$/i, '').toLowerCase();
  for (const n of names) {
    const c = conflictCopyOf(n);
    if (c && c.base.toLowerCase() === base && /\.jsonl$/i.test(n)) out.push(path.join(dir, n));
  }
  return out;
}

// The conflict copies still in a project's memory folder (after the CLI's load, which merges them).
function conflictCopiesIn(dir) {
  const out = [];
  for (const d of [dir, path.join(dir, 'Activity')]) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) if (conflictCopyOf(n)) out.push(n);
  }
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
    for (const f of withConflictCopies(dir, 'MISTAKES.jsonl')) mistakes.push(...from(readJsonLines(f)));
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

// Words of 4+ characters from [a-z0-9_.-], lower-cased, minus common ones: the mistake-matching
// rule's words (cds-search.js has the rule). MUST STAY IN STEP with MistakeMatching in
// MemorySchemas.cs (same pattern, same stop words).
const STOP = new Set(('that this with from have been were into when then than they them their there these those ' +
  'what which while will would should could about after before because does done just only also very more most ' +
  'some such each other over same make made using used file files code instead').split(' '));
function keywords(s) {
  return new Set(String(s || '').toLowerCase().match(/[a-z0-9_.\-]{4,}/g)?.filter(w => !STOP.has(w)) || []);
}

// The lessons for every project, newest first (entries without a lesson are skipped).
const readLessons = () => readJsonLines(lessonsFile())
  .filter(l => l && typeof l === 'object' && String(l.lesson ?? '').trim())
  .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
const day = (ts) => (ts ? String(ts).slice(0, 10) : '????-??-??');

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

  // The rest of the method: one line for the rules that are there (P12), one for those missing.
  const { rules, missing } = methodFiles(projectPath);
  const note = missing.length
    ? `(No docs\\${missing.join(' or docs\\')}: claudedev_scaffold can add ${missing.length > 1 ? 'them' : 'it'}; it never overwrites. Offer it; don't just do it.)`
    : null;
  return { fixed: out, questions, rules, note };
}

// The method's rule files, in docs\ or at the root (docs\ first): the line that points a session at
// those that exist (P12: an ordinary chat or Claude Code session reads them before changing
// anything; a phase gets them through its prompt), and the names of those missing.
const METHOD_FILES = ['CONVENTIONS.md', 'HOW_WE_WORK.md'];
function methodFiles(projectPath) {
  const where = (name) => [path.join('docs', name), name].find(rel => fs.existsSync(path.join(projectPath, rel)));
  const found = METHOD_FILES.map(where).filter(Boolean);
  const missing = METHOD_FILES.filter(n => !where(n));
  const rules = found.length
    ? `Rules: read ${found.join(' and ')} before changing anything (how this project works).`
    : null;
  return { rules, missing };
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
const LESSONS_MAX = 1200; // the "Lessons for every project" section (P5)

// max: the hard cap (claudedev_load: LOAD_MAX; the Claude Code hook passes less, for its limit).
function buildContext(projectPath, cliLoad, createdNow, max = LOAD_MAX) {
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
  // OneDrive conflict copies the CLI's load merged (P10): one short line each, at most two.
  const merged = cliLoad.stdout.split('\n').map(l => l.trim()).filter(l => /^OneDrive:\s/.test(l)).map(l => l.replace(/^OneDrive:\s*/, ''));
  for (const note of merged.slice(0, 2)) header.push(`OneDrive: ${oneLine(note, 300)}`);
  if (merged.length > 2) header.push(`OneDrive: ${merged.length - 2} more conflict copies merged (the copies: ${path.join(memoryRoot(), 'Backups', 'conflicts')}).`);
  const unmerged = conflictCopiesIn(dir);
  if (unmerged.length) header.push(`OneDrive: conflict copies from another PC are here, not merged yet (${oneLine(unmerged.join(', '), 200)}); their entries are read below. ClaudeDevStudio 1.7's CLI merges them on load.`);
  add('header', header);

  // Anything the CLI's load says beyond the session ID (a current task, pending decisions).
  const session = cliLoad.stdout.split('\n')
    .filter(l => l.trim() && !/Context loaded in|^Session:|^Started:|^OneDrive:\s/i.test(l.trim())).join('\n').trim();
  if (cliLoad.code === 0 && session) add('session', ['\n--- Session ---', oneLine(session, 1200)]);

  const handoff = handoffSection(dir);
  if (handoff) add('handoff', handoff);

  const gt = groundTruthSection(projectPath);
  if (gt) {
    add('ground_truth', gt.fixed);
    // The rules line and the note for missing files are one line each and never trimmed.
    if (gt.rules) add('method_rules', [gt.rules]);
    if (gt.questions) add('questions', ...gt.questions);
    if (gt.note) add('method_note', [gt.note]);
  } else {
    add('no_ground_truth', NO_GROUND_TRUTH);
    const { rules } = methodFiles(projectPath);
    if (rules) add('method_rules', [rules]);
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

  // The lessons for every project (P5): right after this project's own mistakes, which come first.
  // At most LESSONS_MAX characters. The most relevant first: the most of a lesson's words found in
  // this project's ground truth and mistakes; then the newest. No file (or no lessons): no section.
  let lessons = readLessons();
  if (lessons.length) {
    const gtFile = findGroundTruth(projectPath);
    const own = keywords(`${gtFile ? readDoc(gtFile) || '' : ''} ${mistakes.map(m => `${m.mistake ?? ''} ${m.lesson ?? ''}`).join(' ')}`);
    const relevance = (l) => [...keywords(l.lesson)].filter(w => own.has(w)).length;
    const ranked = own.size > 0;
    lessons = lessons.map((l, i) => ({ l, i, r: ranked ? relevance(l) : 0 }))
      .sort((a, b) => b.r - a.r || a.i - b.i).map(x => x.l); // a.i: readLessons' newest-first order
    const variant = (maxChars) => {
      const head = (k) => `\n--- Lessons for every project (${k} of ${lessons.length}${ranked ? ', the most relevant here first' : ', newest first'}) ---`;
      const more = (k) => `(${lessons.length - k} more in ${lessonsFile()}; claudedev_check_mistake checks them all.)`;
      const lines = [];
      let size = 0;
      for (const l of lessons) {
        const line = `- ${oneLine(l.lesson, 220)}${l.id ? ` (${l.id})` : ''}`;
        const k = lines.length + 1;
        const total = head(k).length + 1 + size + line.length + (k < lessons.length ? 1 + more(k).length : 0);
        if (lines.length && total > maxChars) break;
        lines.push(line);
        size += line.length + 1;
      }
      const out = [head(lines.length), ...lines];
      if (lines.length < lessons.length) out.push(more(lines.length));
      return out;
    };
    add('lessons', variant(LESSONS_MAX), variant(LESSONS_MAX / 2),
      [`\n(${lessons.length} lessons for every project, not shown to keep load short: ${lessonsFile()}; claudedev_check_mistake checks them.)`]);
  }

  const decSeen = new Set();
  const decisions = withConflictCopies(dir, 'DECISIONS.jsonl').flatMap(readJsonLines)
    .filter(d => { const k = `${String(d.timestamp || '').slice(0, 19)}|${oneLine(d.decision || d.chose, 200)}`; if (decSeen.has(k)) return false; decSeen.add(k); return true; })
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
  for (const key of ['activity', 'patterns', 'uncertainties', 'facts', 'decisions', 'lessons', 'output', 'questions', 'mistakes']) {
    const s = sections.find(x => x.key === key);
    while (s && size() > LOAD_TARGET && s.at < s.variants.length - 1) s.at++;
  }

  const chosen = sections.map(s => s.variants[s.at]);
  // Only when something listed really came from the old store.
  const showsLegacy = legacy !== dir && chosen.some(v => v.shown.some(e => entrySource.get(e) === legacy));
  const parts = chosen.flatMap(v => v.lines);
  if (showsLegacy) parts.push(`\nNote: older entries were also read from ${legacy} (written by CDS v1.2.x). They are shown above; nothing there is changed.`);

  let out = parts.join('\n');
  if (out.length > max) {
    const pointer = `\n[... load cut at ${max} characters: the full files are in ${dir} and the project's docs\\]`;
    out = out.slice(0, max - pointer.length) + pointer;
  }
  return out;
}

// What claudedev_load does: create the memory the first time (CLI init), load it (CLI load, which
// saves the session), and build the context. { ok, text }; never throws for a CLI failure.
async function loadProject(projectPath, { max = LOAD_MAX } = {}) {
  let createdNow = false;
  if (!fs.existsSync(path.join(projectMemoryDir(projectPath), 'session_state.json'))) {
    // "Created just now" only for a new memory folder; one without a session file (e.g.
    // filled by the store merge) just gets its session started.
    const existed = fs.existsSync(projectMemoryDir(projectPath));
    const init = await runCli(['init', projectPath]);
    if (init.code !== 0) return { ok: false, text: `Could not create memory for ${projectName(projectPath)}.\n${cliMessage(init)}` };
    createdNow = !existed;
  }
  const load = await runCli(['load', projectPath]);
  return { ok: true, text: buildContext(projectPath, load, createdNow, max) };
}

export {
  CLAUDEDEV_PATH, LEGACY_ROOT, LOAD_TARGET, LOAD_MAX, LESSONS_MAX,
  projectName, projectMemoryDir, legacyMemoryDir, lessonsFile,
  cleanCliText, runCli, cliMessage,
  readText, readJsonLines, readLessons, entrySource, collectEntries, oneLine, day, STOP, keywords,
  localDate, readDoc, findGroundTruth, buildContext, loadProject,
};
