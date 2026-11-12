// Where ClaudeDevStudio's files live, shared by both MCP servers (index.js, workbench.js).
//
// The CLI and the VS Bridge use Environment.SpecialFolder.MyDocuments, which follows
// Windows' Documents redirection (OneDrive, or any folder the user moved it to). Never
// build the path from %USERPROFILE%\Documents: ask Windows for the very same folder.
// The answer is cached, so PowerShell runs at most once per server process, on first use.

import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export const HOME = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Default';

let _documents = null;

// Windows' Documents folder ([Environment]::GetFolderPath('MyDocuments')).
export function documentsDir() {
  if (_documents) return _documents;
  let docs = null;
  try {
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('MyDocuments')"],
      { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
    if (out && fs.existsSync(out)) docs = out;
  } catch { /* fall back below */ }
  if (!docs) {
    // Only if PowerShell can't answer: the two usual places.
    const oneDrive = path.join(HOME, 'OneDrive', 'Documents');
    docs = fs.existsSync(oneDrive) ? oneDrive : path.join(HOME, 'Documents');
  }
  _documents = docs;
  return _documents;
}

// [Documents]\ClaudeDevStudio: the memory store (Projects\<name>\), LESSONS.jsonl and the chat mirror.
// CDS_MEMORY_ROOT is for tests only (mcp-server\test\smoke.mjs, P5): a throwaway memory root, so
// tests of the machine-wide lessons never touch the real store. The CLI reads the same variable.
// Normal use never sets it.
export const memoryRoot = () => process.env.CDS_MEMORY_ROOT
  ? path.resolve(process.env.CDS_MEMORY_ROOT)
  : path.join(documentsDir(), 'ClaudeDevStudio');

// [Documents]\ClaudeDevStudio\VSBridge: the files the VS Bridge extension writes.
export const vsBridgeDir = () => path.join(memoryRoot(), 'VSBridge');

// ---------------------------------------------------------------------------
// Which folders count as a project (moved here from cds-hook.js in P7, unchanged; the Claude Code
// hook and the phase tools in cds-phase.js use the same rule).
// ---------------------------------------------------------------------------

const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const isUnder = (p, root) => { const a = norm(p), b = norm(root); return a === b || a.startsWith(b + path.sep); };

// Folders that are never a project: the user's home (and the folder holding it), Windows,
// Program Files, ProgramData, and drive roots (claudedev stats once ran in system32 and made a
// memory folder named "system32": docs\GROUND_TRUTH.md section 7, item 1).
export function isExcluded(p) {
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
export function looksLikeProject(p) {
  let entries;
  try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return false; }
  return entries.some(e => {
    const n = e.name.toLowerCase();
    if (PROJECT_FILES.has(n)) return true;
    if (n === 'docs' && e.isDirectory()) return true;
    return e.isFile() && /\.(sln|slnx|[a-z]{2,6}proj)$/.test(n);
  });
}
