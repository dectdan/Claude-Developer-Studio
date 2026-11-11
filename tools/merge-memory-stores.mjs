// Merges the v1.2.x memory store into the real one, without deleting anything.
//
// Before v1.3.0 the MCP server wrote to %USERPROFILE%\Documents\ClaudeDevStudio ("old store")
// while the CLI used the real Documents folder, which is OneDrive\Documents on most
// Windows 11 PCs ("real store"). This copies the old store's entries into the real store
// in the CLI's format:
//   Activity\<time>_activity.json  -> appended to Activity\<YYYY-MM-DD>.jsonl
//   Activity\<time>_mistake.json   -> appended to MISTAKES.jsonl
//   any other file                 -> copied; if the same name exists with different
//                                     content, copied as <name>.from-old-store<ext>
//   chat_mirror.jsonl              -> lines merged, duplicates dropped, sorted by time
// Entries already in the real store (same time and text) are skipped, so it is safe to
// run more than once. The old store is only read.
//
//   node tools\merge-memory-stores.mjs            dry run: prints what it would do
//   node tools\merge-memory-stores.mjs --apply    does it (back up the real store first)

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const apply = process.argv.includes('--apply');
const HOME = process.env.USERPROFILE;
const oldRoot = path.join(HOME, 'Documents', 'ClaudeDevStudio');
const docs = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"], { encoding: 'utf8' }).trim();
const realRoot = path.join(docs, 'ClaudeDevStudio');

if (path.resolve(oldRoot).toLowerCase() === path.resolve(realRoot).toLowerCase()) {
  console.log('Documents is not redirected on this PC: there is only one store. Nothing to merge.');
  process.exit(0);
}
if (!fs.existsSync(oldRoot)) { console.log(`No old store at ${oldRoot}. Nothing to merge.`); process.exit(0); }

const readLines = (f) => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
const keyOf = (e, field) => `${String(e.timestamp || '').slice(0, 19)}|${norm(e[field])}`;
const toIso = (t) => { const d = new Date(t); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };
const plan = { activities: 0, mistakes: 0, filesCopied: 0, filesRenamed: 0, filesSame: 0, dupes: 0, bad: 0, mirror: 0 };
let n = 0;
const write = (file, fn) => { if (apply) { fs.mkdirSync(path.dirname(file), { recursive: true }); fn(); } };

const projectsDir = path.join(oldRoot, 'Projects');
for (const name of fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []) {
  const src = path.join(projectsDir, name);
  if (!fs.statSync(src).isDirectory()) continue;
  const dst = path.join(realRoot, 'Projects', name);
  const before = { ...plan };

  // Entries already in the real store, for duplicate checks.
  const actDst = path.join(dst, 'Activity');
  const haveAct = new Set();
  if (fs.existsSync(actDst)) for (const f of fs.readdirSync(actDst).filter(f => f.endsWith('.jsonl'))) for (const e of readLines(path.join(actDst, f))) haveAct.add(keyOf(e, 'description'));
  const mistakesFile = path.join(dst, 'MISTAKES.jsonl');
  const haveMis = new Set(readLines(mistakesFile).map(e => keyOf(e, 'mistake')));
  let misCount = haveMis.size;

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
  for (const file of walk(src)) {
    const rel = path.relative(src, file);
    const base = path.basename(file);
    if (/_activity\.json$|_mistake\.json$/.test(base)) {
      let o;
      try { o = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { plan.bad++; continue; }
      // Entry time: its own timestamp, else the time in its file name, else the file's
      // modified time (never "now", which would make a re-run add it again).
      // Some old files hold times with dashes ("2026-06-15T10-00-00.000Z"); read those too.
      const dashed = (s) => new Date(String(s ?? '').replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3'));
      const own = dashed(o.timestamp);
      const fromName = dashed(base.slice(0, 19));
      const ts = !isNaN(own) ? own.toISOString()
        : !isNaN(fromName) ? fromName.toISOString()
        : fs.statSync(file).mtime.toISOString();
      if (base.endsWith('_mistake.json')) {
        // A few "mistake" files were written in the activity format; keep their text.
        const e = {
          id: `ERR${String(++misCount).padStart(3, '0')}`, timestamp: ts,
          mistake: o.mistake || o.description || '', impact: o.impact || o.outcome || '',
          fix: o.fix || '', lesson: o.lesson || '', severity: o.severity || 'medium',
        };
        if (haveMis.has(keyOf(e, 'mistake'))) { plan.dupes++; misCount--; continue; }
        haveMis.add(keyOf(e, 'mistake'));
        plan.mistakes++;
        write(mistakesFile, () => fs.appendFileSync(mistakesFile, JSON.stringify(e) + '\n'));
      } else {
        const desc = o.outcome && String(o.outcome).toLowerCase() !== 'success' ? `${o.description || ''} [outcome: ${o.outcome}]` : (o.description || '');
        const e = { id: `ACTMIG_${(++n).toString(36)}`, timestamp: ts, action: o.action || 'activity', description: desc, file: o.file || null };
        if (haveAct.has(keyOf(e, 'description'))) { plan.dupes++; continue; }
        haveAct.add(keyOf(e, 'description'));
        plan.activities++;
        const log = path.join(actDst, `${ts.slice(0, 10)}.jsonl`);
        write(log, () => fs.appendFileSync(log, JSON.stringify(e) + '\n'));
      }
    } else {
      const target = path.join(dst, rel);
      if (!fs.existsSync(target)) {
        plan.filesCopied++;
        write(target, () => fs.copyFileSync(file, target));
      } else if (fs.readFileSync(target).equals(fs.readFileSync(file))) {
        plan.filesSame++;
      } else {
        const ext = path.extname(rel);
        const alt = path.join(dst, rel.slice(0, rel.length - ext.length) + '.from-old-store' + ext);
        if (fs.existsSync(alt) && fs.readFileSync(alt).equals(fs.readFileSync(file))) { plan.filesSame++; continue; }
        plan.filesRenamed++;
        write(alt, () => fs.copyFileSync(file, alt));
      }
    }
  }
  const d = (k) => plan[k] - before[k];
  if (d('activities') + d('mistakes') + d('filesCopied') + d('filesRenamed'))
    console.log(`${name.padEnd(28)} +${d('activities')} activities, +${d('mistakes')} mistakes, +${d('filesCopied')} files${d('filesRenamed') ? `, ${d('filesRenamed')} renamed copies` : ''}${d('dupes') ? ` (${d('dupes')} already there)` : ''}`);
}

// Chat mirror.
const oldMirror = path.join(oldRoot, 'chat_mirror.jsonl');
const realMirror = path.join(realRoot, 'chat_mirror.jsonl');
if (fs.existsSync(oldMirror)) {
  const seen = new Set();
  const all = [...readLines(realMirror), ...readLines(oldMirror)].filter(e => {
    const k = `${e.ts}|${e.type}|${e.text || e.tool || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  plan.mirror = all.length - readLines(realMirror).length;
  write(realMirror, () => fs.writeFileSync(realMirror, all.map(e => JSON.stringify(e)).join('\n') + '\n'));
}

console.log(`\n${apply ? 'DONE' : 'DRY RUN (nothing written)'}: old ${oldRoot}\n  -> real ${realRoot}`);
console.log(`  activities +${plan.activities}, mistakes +${plan.mistakes}, files copied ${plan.filesCopied}, renamed copies ${plan.filesRenamed}, identical files skipped ${plan.filesSame}, duplicates skipped ${plan.dupes}, unreadable ${plan.bad}, chat-mirror lines +${plan.mirror}`);
if (!apply) console.log('Run again with --apply to do it. The old store is never changed.');
