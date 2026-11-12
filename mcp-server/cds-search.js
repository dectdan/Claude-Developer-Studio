// cds-search.js -- word search across the memory of one project or all of them (claudedev_search),
// and the keyword rule shared by the mistake check, the lessons and the search (P5, 2026-11-11).
//
// Read-only: it lists folders and reads files; it never creates, touches or repairs anything.
// It reads each project's MISTAKES.jsonl, DECISIONS.jsonl, PATTERNS.jsonl, HANDOFFS.jsonl and
// Activity\ (the CLI's YYYY-MM-DD.jsonl and v1.2.x's one-file-per-entry *_activity.json and
// *_mistake.json), in the real store and the old v1.2.x store, plus the machine-wide
// LESSONS.jsonl. Never the chat mirror (tool-call summaries and checkpoints, not project memory)
// and never a qwen_config.json (API keys).

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { memoryRoot, conflictCopyOf } from './cds-paths.js';
import { LEGACY_ROOT, oneLine, day, lessonsFile, STOP, keywords } from './cds-context.js';

// ---------------------------------------------------------------------------
// Words: the mistake-matching rule
// ---------------------------------------------------------------------------

// The words (keywords, STOP) are in cds-context.js, which load uses too. A plan matches a
// recorded mistake when they share at least 3 words making at least 30% of the smaller set.
// MUST STAY IN STEP with the CLI's MistakeMatching in MemorySchemas.cs: same word pattern, same
// stop words, same thresholds, so the CLI and MCP agree.
const MIN_SHARED = 3;
const MIN_SHARE = 0.3;

// { score, shared } when text matches plan under the rule above, else null.
function matchScore(plan, text, planWords = keywords(plan)) {
  const words = keywords(text);
  if (words.size === 0) return null;
  const shared = [...words].filter(w => planWords.has(w));
  const score = shared.length / Math.max(1, Math.min(words.size, planWords.size));
  return shared.length >= MIN_SHARED && score >= MIN_SHARE ? { score, shared } : null;
}

// The recorded mistakes that match a plan (the best `max`, one per distinct mistake text).
function similarMistakes(plan, mistakes, max = 3) {
  const planWords = keywords(plan);
  const scored = [];
  const seen = new Set();
  for (const m of mistakes) {
    const key = oneLine(m.mistake, 400);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const hit = matchScore(plan, `${m.mistake ?? ''} ${m.lesson ?? ''}`, planWords);
    if (hit) scored.push({ m, ...hit });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max);
}

// The lessons for every project that match a plan (the lesson's own words only: its "why" names
// projects and dates, which would match plans that only mention the project).
function similarLessons(plan, lessons, max = 3) {
  const planWords = keywords(plan);
  return lessons
    .map(l => ({ l, hit: matchScore(plan, l.lesson, planWords) }))
    .filter(x => x.hit)
    .map(x => ({ l: x.l, ...x.hit }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Reading the stores (read-only, concurrent: one file at a time, opening ~3,000 small files costs
// over a second on Windows; 32 at a time, about a quarter of that)
// ---------------------------------------------------------------------------

const KINDS = ['mistakes', 'decisions', 'patterns', 'handoffs', 'activity', 'lessons'];
const KIND_ALIASES = { mistake: 'mistakes', decision: 'decisions', pattern: 'patterns', handoff: 'handoffs', activities: 'activity', lesson: 'lessons' };
const READ_CONCURRENCY = 32;

// Which files of a project folder hold which kind. Activity\ is listed separately.
const PROJECT_FILES = { 'MISTAKES.jsonl': 'mistakes', 'DECISIONS.jsonl': 'decisions', 'PATTERNS.jsonl': 'patterns', 'HANDOFFS.jsonl': 'handoffs' };
const NEVER = /qwen_config|chat_mirror/i;

const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const listDir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };

// The stores to read: the real one first (so an entry in both is shown from there), then the old.
function stores() {
  const real = memoryRoot();
  const out = [{ root: real, old: false }];
  if (path.resolve(LEGACY_ROOT).toLowerCase() !== path.resolve(real).toLowerCase()) out.push({ root: LEGACY_ROOT, old: true });
  return out;
}

// The files to read: [{ file, kind, project, store, rel }]. `onlyProject`: a project folder name.
function listFiles(kinds, onlyProject) {
  const files = [];
  const projects = new Set();
  for (const store of stores()) {
    const projectsDir = path.join(store.root, 'Projects');
    const names = onlyProject ? [onlyProject] : listDir(projectsDir).filter(e => e.isDirectory()).map(e => e.name);
    for (const name of names) {
      const dir = path.join(projectsDir, name);
      if (!isDir(dir)) continue;
      projects.add(name.toLowerCase());
      const present = new Set(listDir(dir).filter(e => e.isFile()).map(e => e.name));
      for (const [f, kind] of Object.entries(PROJECT_FILES)) {
        if (kinds.has(kind) && present.has(f)) files.push({ file: path.join(dir, f), kind, project: name, store, rel: f });
      }
      // OneDrive conflict copies (P10, e.g. MISTAKES-DESKTOP-ABC.jsonl): read too, read-only (search
      // never writes); the CLI merges them on the project's next load or record. An entry in both is
      // shown once (the key below).
      for (const n of present) {
        const c = conflictCopyOf(n);
        const kind = c && PROJECT_FILES[`${c.base.toUpperCase()}.jsonl`];
        if (kind && kinds.has(kind) && /\.jsonl$/i.test(n)) files.push({ file: path.join(dir, n), kind, project: name, store, rel: n });
      }
      const wantAct = kinds.has('activity'), wantMis = kinds.has('mistakes');
      if (!wantAct && !wantMis) continue;
      for (const e of listDir(path.join(dir, 'Activity'))) {
        if (!e.isFile() || NEVER.test(e.name)) continue;
        const n = e.name;
        const kind = n.endsWith('.jsonl') || n.endsWith('_activity.json') ? 'activity' : n.endsWith('_mistake.json') ? 'mistakes' : null;
        if (kind && kinds.has(kind)) files.push({ file: path.join(dir, 'Activity', n), kind, project: name, store, rel: `Activity\\${n}`, single: n.endsWith('.json') });
      }
    }
  }
  if (kinds.has('lessons')) files.push({ file: lessonsFile(), kind: 'lessons', project: '', store: stores()[0], rel: 'LESSONS.jsonl' });
  return { files, projects: projects.size };
}

async function readAll(files) {
  const texts = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      try { texts[i] = (await fsp.readFile(files[i].file, 'utf8')).replace(/^﻿/, ''); } catch { texts[i] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
  return texts;
}

// What an entry says, by kind: `match` (all its words) and `show` (one line: a mistake with its
// lesson, a decision with its reason), plus its time and ID.
function describe(kind, e) {
  const s = (v) => (Array.isArray(v) ? v.join('; ') : v == null ? '' : typeof v === 'object' ? '' : String(v));
  switch (kind) {
    case 'mistakes':
      return { ts: e.timestamp, id: e.id, key: e.mistake, match: `${s(e.mistake)} ${s(e.impact)} ${s(e.fix)} ${s(e.lesson)}`, show: `${s(e.mistake)}${e.lesson ? ` | lesson: ${s(e.lesson)}` : ''}` };
    case 'decisions': {
      const d = s(e.decision) || s(e.chose);
      return { ts: e.timestamp, id: e.id, key: d, match: `${d} ${s(e.chose)} ${s(e.reasoning)} ${s(e.alternatives_considered)}`, show: `${d}${e.reasoning ? ` | why: ${s(e.reasoning)}` : ''}` };
    }
    case 'patterns':
      return { ts: e.last_seen || e.created || e.timestamp, id: e.id, key: e.pattern, match: `${s(e.pattern)} ${s(e.evidence)} ${s(e.recommended_instead)}`, show: s(e.pattern) };
    case 'handoffs':
      return { ts: e.timestamp, id: e.id, key: e.where_i_stopped, match: `${s(e.where_i_stopped)} ${s(e.next_step)} ${s(e.open_questions)} ${s(e.notes)}`, show: `${s(e.where_i_stopped)}${e.next_step ? ` | next: ${s(e.next_step)}` : ''}` };
    case 'lessons':
      return { ts: e.timestamp, id: e.id, key: e.lesson, match: s(e.lesson), show: `${s(e.lesson)}${e.why ? ` | why: ${s(e.why)}` : ''}` };
    default: // activity
      return { ts: e.timestamp, id: '', key: e.description, match: `${s(e.action)} ${s(e.description)} ${s(e.file)}`, show: `${s(e.action) || 'activity'}: ${s(e.description)}`, edit: e.action === 'file_edit' };
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

// The search's words: the rule's words, plus the 4+-letter parts of words joined by . _ - (so
// "config" finds "cds-config.js" and "path." at the end of a sentence is "path").
function searchTokens(s) {
  const out = [];
  for (const w of String(s || '').toLowerCase().match(/[a-z0-9_.\-]{4,}/g) || []) {
    if (STOP.has(w)) continue;
    const t = w.replace(/^[._-]+|[._-]+$/g, '');
    if (t.length >= 4 && !STOP.has(t)) out.push(t);
    if (/[._-]/.test(t)) for (const part of t.split(/[._-]+/)) if (part.length >= 4 && !STOP.has(part)) out.push(part);
  }
  return out;
}
const searchWords = (s) => new Set(searchTokens(s));
// A query word matches an entry word that is the same, or the same with an inflection either way
// ("path"/"paths", "quote"/"quotes"/"quoted", "install"/"installer"; not "curl"/"curly").
const SUFFIXES = new Set(['s', 'es', 'ed', 'd', 'er', 'ers', 'ing', 'ings']);
const close = (q, w) => {
  if (w === q) return true;
  const [short, long] = w.length > q.length ? [q, w] : [w, q];
  return long.startsWith(short) && SUFFIXES.has(long.slice(short.length));
};
// A cheap test on the raw line before parsing it: an entry word that matches q contains this.
const stem = (q) => q.slice(0, Math.max(4, q.length - 3));

// Kind before date on equal word counts: mistakes, decisions and lessons above patterns and
// handoffs, above activity; the hook's file_edit lines last.
const WEIGHT = { lessons: 5, mistakes: 5, decisions: 5, patterns: 3, handoffs: 3, activity: 1 };
const LABEL = { lessons: 'lesson', mistakes: 'mistake', decisions: 'decision', patterns: 'pattern', handoffs: 'handoff', activity: 'activity' };

const SEARCH_LIMIT = 15;
const SEARCH_LIMIT_MAX = 40;
const SEARCH_BUDGET = 3000;
const SEARCH_MAX = 6000;

function normaliseKinds(kinds) {
  if (kinds == null || (Array.isArray(kinds) && kinds.length === 0)) return { kinds: new Set(KINDS) };
  const list = Array.isArray(kinds) ? kinds : String(kinds).split(/[\s,]+/);
  const out = new Set(), bad = [];
  for (const k of list.map(x => String(x).trim().toLowerCase()).filter(Boolean)) {
    const n = KIND_ALIASES[k] || k;
    if (KINDS.includes(n)) out.add(n); else bad.push(k);
  }
  return bad.length || !out.size ? { error: `Unknown kind${bad.length > 1 ? 's' : ''}: ${bad.join(', ') || '(none)'}. Use any of: ${KINDS.join(', ')}.` } : { kinds: out };
}

// search({ query, project, kinds, limit }) -> { text, ms, files, entries, hits }
// `project`: a project folder name (only that project) or empty (all projects).
async function search({ query, project = '', kinds, limit } = {}) {
  const t0 = performance.now();
  const q = String(query ?? '').trim();
  if (!q) return { error: 'query is required: a few words, e.g. "OneDrive Documents path".' };
  const k = normaliseKinds(kinds);
  if (k.error) return { error: k.error };
  const max = Math.min(SEARCH_LIMIT_MAX, Math.max(1, Math.round(Number(limit) || SEARCH_LIMIT)));
  const budget = Math.min(SEARCH_MAX, max <= SEARCH_LIMIT ? SEARCH_BUDGET : SEARCH_BUDGET + (max - SEARCH_LIMIT) * 120);

  // "Quoted phrases" must appear as written (spaces collapsed, any case); their words count too.
  const phrases = [...q.matchAll(/"([^"]+)"/g)].map(m => m[1].toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
  const words = [...searchWords(q.replace(/"/g, ' '))];
  if (!words.length && !phrases.length) {
    return { text: `No usable words in "${q}": search uses words of 4 or more letters, without common ones (that, with, file, ...). Try other words.`, ms: 0, hits: 0 };
  }
  const need = words.length <= 2 ? words.length : Math.max(2, Math.ceil(words.length / 2));
  const stems = words.map(stem);

  const { files, projects } = listFiles(k.kinds, project || null);
  const texts = await readAll(files);

  const seen = new Set();
  const hits = [];
  const df = words.map(() => 0); // in how many entries each word's stem appears (for the rarity weight)
  let entries = 0;
  files.forEach((f, i) => {
    const raw = texts[i];
    if (raw == null) return;
    const lines = f.single ? [raw] : raw.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      entries++;
      const low = line.toLowerCase();
      // Cheap first: enough of the query's stems in the raw text, before parsing the line.
      let maybe = 0;
      stems.forEach((s, j) => { if (low.includes(s)) { maybe++; df[j]++; } });
      if (maybe < need) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (!e || typeof e !== 'object') continue;
      const d = describe(f.kind, e);
      const text = d.match.toLowerCase();
      if (phrases.some(p => !text.replace(/\s+/g, ' ').includes(p))) continue;
      const tokens = searchTokens(text);
      const own = new Set(tokens);
      const tf = words.map(w => (own.has(w) || [...own].some(x => close(w, x)) ? tokens.filter(x => close(w, x)).length : 0));
      const matched = tf.filter(n => n > 0).length;
      if (matched < need) continue;
      // The same entry in both stores (or twice after the merge): shown once, from the real store.
      const key = `${f.kind}|${f.project.toLowerCase()}|${String(d.ts || '').slice(0, 19)}|${oneLine(d.key, 200)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ ...d, kind: f.kind, project: f.project, file: f, matched, tf, len: tokens.length, weight: d.edit ? 0 : WEIGHT[f.kind] });
    }
  });
  // Within the same number of shared words and kind: BM25 (k1 1.2, b 0.75), i.e. rarer words and
  // shorter, denser entries first, so a precise mistake beats a long session summary that
  // mentions everything. Then newer first.
  const avgLen = hits.reduce((n, h) => n + h.len, 0) / Math.max(1, hits.length);
  const idf = df.map(n => Math.log(1 + (entries - n + 0.5) / (n + 0.5)));
  for (const h of hits) {
    h.rank = h.tf.reduce((sum, t, j) => sum + (t ? idf[j] * (t * 2.2) / (t + 1.2 * (0.25 + 0.75 * h.len / avgLen)) : 0), 0);
  }

  const ms = Math.round(performance.now() - t0);
  const scope = project ? `in ${project}` : `in ${projects} projects`;
  const wordsNote = `words: ${words.join(', ') || '(none)'}${phrases.length ? `; phrases: "${phrases.join('", "')}"` : ''}${words.length > 1 ? `; at least ${need} must match` : ''}`;
  if (!hits.length) {
    return { text: `No memory entry matches "${q}" ${scope} (${wordsNote}). Try fewer or other words.`, ms, files: files.length, entries, hits: 0 };
  }

  hits.sort((a, b) => b.matched - a.matched || b.weight - a.weight || b.rank - a.rank || String(b.ts || '').localeCompare(String(a.ts || '')));

  // Activity is the noisy kind: at most a third of the lines while other kinds have hits left.
  const act = hits.filter(h => h.kind === 'activity');
  const rest = hits.filter(h => h.kind !== 'activity');
  const actSlots = Math.min(act.length, Math.max(Math.ceil(max / 3), max - rest.length));
  const chosen = new Set([...rest.slice(0, max - actSlots), ...act.slice(0, actSlots)]);
  let shown = hits.filter(h => chosen.has(h));

  const hitProjects = new Set(hits.filter(h => h.project).map(h => h.project.toLowerCase())).size;
  const counts = (list) => KINDS.map(kd => [kd, list.filter(h => h.kind === kd).length]).filter(([, n]) => n).map(([kd, n]) => `${n} ${kd === 'activity' ? 'activity' : n === 1 ? LABEL[kd] : kd}`).join(', ');
  const real = stores()[0].root;
  const old = stores()[1];
  const pointer = (h) => h.kind === 'lessons' ? 'LESSONS.jsonl' : `${h.file.store.old ? 'old:' : ''}${h.project}\\${h.file.rel}`;
  // The start of the text; when the first matched word is past that, the start and the words' place.
  const snippet = (h, width) => {
    const t = oneLine(h.show, 100000);
    if (t.length <= width) return t;
    const low = t.toLowerCase();
    const at = Math.min(...stems.filter((s, j) => h.tf[j]).map(s => low.indexOf(s)).filter(n => n >= 0));
    if (!Number.isFinite(at) || at < width - 40) return oneLine(t, width);
    const lead = Math.floor(width * 0.3);
    const from = Math.max(lead, at - 30);
    return `${t.slice(0, lead).trimEnd()} ... ${t.slice(from, from + width - lead - 5).trim()}...`;
  };
  const render = (list, width) => list.map(h => `- ${day(h.ts)} ${LABEL[h.kind]} ${pointer(h)}${h.id ? ` ${h.id}` : ''}: ${snippet(h, width)}`);
  const head = (list) => [
    `Search "${q}" ${scope}: ${hits.length} hit${hits.length === 1 ? '' : 's'}${project ? '' : ` in ${hitProjects} project${hitProjects === 1 ? '' : 's'}`}; showing ${list.length} (${counts(list)}). ${wordsNote[0].toUpperCase()}${wordsNote.slice(1)}.`,
    `Files: ${path.join(real, 'Projects')}\\<project>\\...${old ? `; old: = ${path.join(old.root, 'Projects')} (v1.2.x, read-only)` : ''}; LESSONS.jsonl = ${lessonsFile()}.`,
  ];
  const tail = (list) => {
    const out = [];
    const moreAct = act.length - list.filter(h => h.kind === 'activity').length;
    const moreRest = rest.length - list.filter(h => h.kind !== 'activity').length;
    if (moreRest > 0) out.push(`(${moreRest} more ${moreRest === 1 ? 'hit' : 'hits'} not shown: add words, raise limit (up to ${SEARCH_LIMIT_MAX}), or pick kinds.)`);
    if (moreAct > 0) out.push(`(${moreAct} more activity ${moreAct === 1 ? 'line' : 'lines'} not shown: kinds ["activity"] lists them.)`);
    return out;
  };
  // Fit the budget: shorter lines first (down to 80 characters of text), then fewer lines.
  let width = 220, out;
  for (;;) {
    out = [...head(shown), ...render(shown, width), ...tail(shown)].join('\n');
    if (out.length <= budget) break;
    if (width > 80) { width -= 20; continue; }
    if (shown.length <= 1) break;
    shown = shown.slice(0, -1);
  }
  if (out.length > SEARCH_MAX) out = out.slice(0, SEARCH_MAX - 40) + '\n[... cut at 6,000 characters]';
  return { text: out, ms, files: files.length, entries, hits: hits.length };
}

// ---------------------------------------------------------------------------
// The same mistake elsewhere (for record_mistake's lesson suggestion)
// ---------------------------------------------------------------------------

// Mistakes in other projects that match `text` under the rule: [{ project, ts, mistake }], the best
// one per project. Read-only, both stores.
async function sameMistakeElsewhere(text, ownProject) {
  const { files } = listFiles(new Set(['mistakes']), null);
  const others = files.filter(f => f.project.toLowerCase() !== String(ownProject).toLowerCase());
  const texts = await readAll(others);
  const planWords = keywords(text);
  const best = new Map();
  others.forEach((f, i) => {
    const raw = texts[i];
    if (raw == null) return;
    for (const line of f.single ? [raw] : raw.split('\n')) {
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (!m || !m.mistake) continue;
      const hit = matchScore(text, `${m.mistake} ${m.lesson ?? ''}`, planWords);
      if (!hit) continue;
      const k = f.project.toLowerCase();
      const cur = best.get(k);
      if (!cur || hit.score > cur.score) best.set(k, { project: f.project, ts: m.timestamp, mistake: m.mistake, score: hit.score });
    }
  });
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export {
  STOP, KINDS, SEARCH_LIMIT, SEARCH_BUDGET, SEARCH_MAX,
  keywords, matchScore, similarMistakes, similarLessons, search, sameMistakeElsewhere,
};
