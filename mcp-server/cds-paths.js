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
