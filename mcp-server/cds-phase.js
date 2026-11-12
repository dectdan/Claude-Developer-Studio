// cds-phase.js -- run a phase of the method (docs\<phase>_prompt.md -> docs\<phase>_OUTPUT.md) in
// Claude Code, headless, from a chat: start it, read its status, answer it, stop it. Windows only.
// Used by workbench.js (the claudedev_phase_* tools); from P7 it replaces the producer's scripts
// tools\phase\run-phase.ps1 and phase-status.ps1 (which still work, and whose runs it can read).
//
// How a run works:
//   start   checks Claude Code (on PATH, new enough), the project (the hook's rule, cds-paths.js),
//           the prompt file and the lock; writes docs\<phase>_run.json (the run's metadata) and
//           docs\cds_phase.lock; starts the runner (this file, `node cds-phase.js --run <json> <n>`)
//           through WMI (Win32_Process.Create), hidden and outside the MCP server's process tree,
//           so the session outlives Claude Desktop restarting its servers. Returns at once.
//   runner  starts `claude -p ... --output-format stream-json --verbose` in the project with
//           stdout/stderr appended to docs\<phase>_run.log / .err, records the pids, waits, records
//           the exit code and releases the lock.
//   status  reads the metadata and the log (shared read, while Claude Code writes it); never
//           depends on this process having started the run.
//   reply   the same session again (`--resume <session id>` from the log), same model, effort and
//           tools; the message goes in on stdin (never as an argument, so it can't become a flag);
//           appended to the same log (Status shows "run 2 of 2").
//   stop    (from P8) Ctrl+C first: Claude Code shares the runner's hidden console, so a small
//           helper attaches to that console and sends CTRL_C_EVENT; Claude Code ends its turn, runs
//           its SessionEnd hooks (the automatic handoff) and exits, and the runner records it. If it
//           hasn't ended after a second Ctrl+C, or Ctrl+C can't be sent: the run's process tree is
//           ended by force (taskkill /T /F on the runner, after checking it is ours), as in P7.
//           Either way: "stopped by request" and how, and the lock released.
//
// The run's environment (from P8): CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS and BASH_MAX_TIMEOUT_MS
// are set to 60 minutes unless the user set them (PHASE_ENV): a -p run then waits up to an hour of
// idle time for background work it started (default 10 minutes), and a foreground command may be
// given a timeout of up to an hour (default 10 minutes), so a long build or test can run in the
// foreground as phase prompts ask.
//
// Never --dangerously-skip-permissions, never --permission-mode bypassPermissions: the mode is
// always acceptEdits, with the allowed tools listed.
//
// Modes (from P9, Dan's DEC002): who answers a phase's questions.
//   collaborative (default)  headless; chat-side Claude answers what plainly follows from the ground
//                            truth and is easily undone and technical, and brings real decisions to
//                            the user; either way it tells the user what was asked and answered.
//   delegated                headless; chat-side Claude answers everything and tells the user after.
//   manual                   a visible, interactive Claude Code window in the project (Windows
//                            Terminal if there is one, else a console) with the prompt as its first
//                            message, in the user's own permission mode: the user watches and
//                            approves. The runner sits in that window (its pid holds the lock);
//                            Status reads the session's transcript (--session-id is set at start).
// A phase that asks something ends its turn with a QUESTION: block (templates\HOW_WE_WORK.md);
// Status returns its question, options and recommendation verbatim (parseQuestion).
//
// The runner also records each run's outcome (finished / question / error / no result / closed) in
// the .json, and phaseStart adds the run to [Documents]\ClaudeDevStudio\phases.json (the index the
// tray app watches for notifications and the Dashboard's Phases page lists).
//
// From the command line (the Dashboard's Phases page uses these):
//   node cds-phase.js --status <project> [phase]       Status's text
//   node cds-phase.js --stop <project> <phase> [--force]
//   node cds-phase.js --conversation <log or transcript> [--from <byte>] [--json]
//
// CDS_PHASE_CLAUDE and CDS_PHASE_WINDOW=hidden are for tests only (mcp-server\test\smoke.mjs points
// the first at a fake claude; the second opens a manual run's window hidden); normal use never sets
// them.

import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { isExcluded, looksLikeProject, memoryRoot, PS_UTF8, findOnPath } from './cds-paths.js';

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);

export const MIN_CLAUDE = [2, 1, 0];      // --effort is newer than 2.0.42 (docs\GROUND_TRUTH.md section 9)
export const PERMISSION_MODE = 'acceptEdits';
export const LOCK_NAME = 'cds_phase.lock';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']; // Claude Code's levels, without ultracode (multi-agent workflows)
const STATUS_MAX = 2500;
const PHASE_TOOLS = ['claudedev_phase_start', 'claudedev_phase_reply', 'claudedev_phase_stop'];

// run-phase.ps1's list, with the memory server's tools by their current names (13, P6). No
// workbench tools: the run's MCP config has only the memory server, and a phase must not start,
// answer or stop phases. Monitor (from P8): it watches a command's output or a WebSocket in the
// background; its commands follow the same permission rules as Bash (already allowed), so it adds
// a way to wait for long work, not a new power (docs\P8_OUTPUT.md, decisions).
export const DEFAULT_ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'PowerShell', 'Monitor', 'TodoWrite', 'NotebookEdit', 'WebFetch', 'WebSearch',
  ...['init', 'load', 'scaffold', 'handoff', 'record_decision', 'record_activity', 'record_mistake', 'check_mistake',
    'search', 'record_lesson', 'stats', 'chat_checkpoint', 'chat_resume'].map(t => `mcp__claudedevstudio__claudedev_${t}`),
].join(',');

// The run's environment additions (see the header). A value the user set themselves wins.
export const PHASE_ENV = {
  CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '3600000', // idle wait for background work after the last turn (default 600000)
  BASH_MAX_TIMEOUT_MS: '3600000',                  // the longest timeout a foreground command may be given (default 600000)
};

// The gentle stop: Ctrl+C, then (if it still runs) a second one, then force.
const CTRL_C_WAIT_MS = [10000, 5000];

const defaultPrompt = (phase) =>
  `Read docs\\${phase}_prompt.md and carry it out. You are running unattended: nobody can answer questions. Follow the prompt's rules for decisions it doesn't cover.`;
// Collaborative and delegated runs: someone (chat-side Claude, or the user through it) does answer,
// so a real decision may end the turn with a QUESTION: block instead of a guess.
const answeredPrompt = (phase) =>
  `Read docs\\${phase}_prompt.md and carry it out. You are running headless: nobody watches this session, but a reply can come. When the prompt's rules decide something, follow them. Only when you truly need a decision, end your turn with a block that starts "QUESTION:" (the question in one or two sentences, then numbered options each with a one-line consequence, then "RECOMMENDATION:" the option you would pick and why), and stop there.`;
const manualPrompt = (phase) => `Read docs\\${phase}_prompt.md and carry it out.`;

export const MODES = ['collaborative', 'delegated', 'manual'];
export const DEFAULT_MODE = 'collaborative';

// What chat-side Claude does with a question, said in every start and status result (DEC002).
export const MODE_GUIDANCE = {
  collaborative: 'Mode: collaborative. If it asks something, answer it yourself only if the answer follows from the ground truth or what is already decided, is easily undone, and is technical; otherwise put it to the user with the options and your recommendation, and send their answer with claudedev_phase_reply. Either way, tell the user what was asked and what was answered.',
  delegated: 'Mode: delegated. If it asks something, answer it yourself with claudedev_phase_reply, and tell the user afterwards what was asked and what you answered.',
  manual: 'Mode: manual. The user works in the Claude Code window and approves its actions there; don\'t answer for them. When the window is closed, read the output as usual.',
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ok = (text) => ({ ok: true, text });
const refuse = (text) => ({ ok: false, text });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const oneLine = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const localTime = (iso) => { const d = new Date(iso); return isNaN(d) ? '?' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const minutes = (ms) => ms < 60000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${(ms / 60000).toFixed(ms < 600000 ? 1 : 0)} min`;

// Output is read as UTF-8. A PowerShell -Command is told to write UTF-8 first (PS_UTF8), since
// Windows PowerShell 5.1 writes to a pipe in the OEM code page (P11).
function run(file, args, opts = {}) {
  const c = /powershell(\.exe)?$/i.test(file) ? args.indexOf('-Command') : -1;
  if (c >= 0 && c + 1 < args.length) args = [...args.slice(0, c + 1), PS_UTF8 + args[c + 1], ...args.slice(c + 2)];
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, error: err, out: String(stdout || ''), err: String(stderr || '') }));
  });
}

function readJson(file) {
  for (let i = 0; i < 5; i++) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
    catch (e) { if (e.code === 'ENOENT') return null; if (i === 4) return null; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return null;
}

// Temp file then rename (retried: Windows refuses a rename over a file another process is reading).
function writeJson(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (i >= 20) { try { fs.unlinkSync(tmp); } catch { /* leave it */ } throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

// Re-read, change one thing, write back (the runner, stop and start all write the metadata).
function updateMeta(file, fn) {
  const m = readJson(file);
  if (!m) return null;
  fn(m);
  writeJson(file, m);
  return m;
}

function files(project, phase) {
  const docs = path.join(project, 'docs');
  return {
    docs,
    prompt: path.join(docs, `${phase}_prompt.md`),
    output: path.join(docs, `${phase}_OUTPUT.md`),
    log: path.join(docs, `${phase}_run.log`),
    err: path.join(docs, `${phase}_run.err`),
    meta: path.join(docs, `${phase}_run.json`),
    lock: path.join(docs, LOCK_NAME),
  };
}

const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
const shownSize = (n) => n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

// ---------------------------------------------------------------------------
// Checks: the project, the phase name, Claude Code
// ---------------------------------------------------------------------------

function checkProject(p) {
  if (!p || typeof p !== 'string') return { error: 'project_path is required (the project folder).' };
  const project = path.resolve(p);
  let st; try { st = fs.statSync(project); } catch { return { error: `${project} does not exist.` }; }
  if (!st.isDirectory()) return { error: `${project} is not a folder.` };
  if (isExcluded(project)) return { error: `${project} is the home folder, a drive root, or inside Windows or Program Files: phases run only in a project folder.` };
  if (!looksLikeProject(project)) return { error: `${project} doesn't look like a project (no .git, docs\\, solution or project file, or package manifest). Phases run only in a project folder.` };
  return { project };
}

function checkPhase(phase) {
  if (!phase || typeof phase !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(phase) || /\.\./.test(phase)) {
    return 'phase must be a short name such as P8 (letters, digits, - _ . ; no slashes).';
  }
  return null;
}

function parseVersion(s) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(s || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const older = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; };

// The command that runs Claude Code: [file, ...args]. A .js/.mjs (the tests' fake) runs with this
// Node; an npm shim (claude.cmd) is resolved to what it runs, since a .cmd can't take arguments
// safely without a shell.
function commandFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return [process.execPath, file];
  if (ext === '.exe') return [file];
  if (ext === '.cmd' || ext === '.bat') {
    let body = '';
    try { body = fs.readFileSync(file, 'utf8'); } catch { return null; }
    const dir = path.dirname(file);
    const m = /"%~?dp0%?\\?([^"]+?\.(?:js|exe))"/i.exec(body);
    if (m) {
      const target = path.join(dir, m[1]);
      if (fs.existsSync(target)) return target.toLowerCase().endsWith('.exe') ? [target] : [process.execPath, target];
    }
    return null;
  }
  return [file];
}

export async function findClaude() {
  let candidates = [];
  const override = process.env.CDS_PHASE_CLAUDE; // tests only
  if (override) candidates = [path.resolve(override)];
  else {
    candidates = findOnPath('claude');
    const native = path.join(process.env.USERPROFILE || os.homedir(), '.local', 'bin', 'claude.exe');
    if (fs.existsSync(native)) candidates.push(native);
    candidates.sort((a, b) => (b.toLowerCase().endsWith('.exe') ? 1 : 0) - (a.toLowerCase().endsWith('.exe') ? 1 : 0));
  }
  const file = candidates.find(f => fs.existsSync(f));
  if (!file) {
    return { error: override
      ? `The test Claude Code (CDS_PHASE_CLAUDE) ${override} doesn't exist.`
      : 'Claude Code isn\'t installed or isn\'t on PATH (no "claude" found). Install it: in PowerShell, irm https://claude.ai/install.ps1 | iex (https://code.claude.com/docs/en/setup); sign in once by running "claude" in a new terminal; then quit Claude Desktop fully and reopen it, so its servers see the new PATH (a Claude Code installed after Claude Desktop started isn\'t seen until then). The tray app\'s Claude Code menu item shows the next step.' };
  }
  const command = commandFor(file);
  if (!command) return { error: `Found ${file}, but couldn't tell what it runs. Install Claude Code's native build (https://code.claude.com/docs/en/setup).` };
  const v = await run(command[0], [...command.slice(1), '--version'], { timeout: 30000 });
  const version = parseVersion(v.out);
  if (!version) return { error: `${file} --version didn't answer with a version (exit ${v.code}: ${oneLine(v.out + v.err, 200)}).` };
  if (older(version, MIN_CLAUDE)) {
    return { error: `Claude Code ${version.join('.')} is too old: phases need ${MIN_CLAUDE.join('.')} or later (for --effort and the stream-json log). Update it with "claude update" in a terminal, then restart Claude Desktop.` };
  }
  // Signed in? `claude auth status` exits 0 when logged in, 1 when not (Claude Code's CLI reference);
  // its JSON (which names the account) is read for nothing and never shown. Any other answer (an
  // older Claude Code without the command, a timeout) doesn't refuse.
  const auth = await run(command[0], [...command.slice(1), 'auth', 'status'], { timeout: 20000 });
  if (auth.code === 1 && !auth.error?.killed) {
    return { error: `Claude Code ${version.join('.')} is installed but not signed in. Open a terminal, run "claude" once and sign in (a Pro, Max, Team, Enterprise or Console account), then start the phase again.` };
  }
  return { file, command, version: version.join('.'), signedIn: auth.code === 0 ? true : null };
}

function splitTools(s) {
  return String(s).split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean);
}

function checkTools(allowed) {
  if (allowed == null || allowed === '') return { tools: DEFAULT_ALLOWED_TOOLS };
  const list = Array.isArray(allowed) ? allowed.map(String) : splitTools(allowed);
  if (!list.length) return { tools: DEFAULT_ALLOWED_TOOLS };
  for (const t of list) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*(\([^()]*\))?$/.test(t)) return { error: `allowed_tools: "${t}" isn't a tool name or rule (e.g. Read, Bash(git log *), mcp__server__tool).` };
    if (PHASE_TOOLS.some(n => t.endsWith(n))) return { error: `allowed_tools: "${t}" would let the phase start, answer or stop phases itself; not allowed.` };
  }
  return { tools: list.join(',') };
}

// The run's MCP config: CDS's memory server (the installed one, else the one beside this file), in
// %TEMP%, as run-phase.ps1 does.
function mcpConfig(project, phase) {
  const installed = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ClaudeDevStudio', 'mcp-server', 'index.js');
  const index = fs.existsSync(installed) ? installed : path.join(HERE, 'index.js');
  const tag = crypto.createHash('sha1').update(project.toLowerCase()).digest('hex').slice(0, 8);
  const file = path.join(os.tmpdir(), `cds_phase_mcp_${tag}_${phase}.json`);
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { claudedevstudio: { command: process.execPath, args: [index] } } }, null, 2), 'utf8');
  return file;
}

function claudeArgs(meta, { prompt, resume }) {
  return [
    '-p', ...(prompt != null ? [prompt] : []),
    ...(resume ? ['--resume', resume] : []),
    ...(meta.model ? ['--model', meta.model] : []),
    ...(meta.effort ? ['--effort', meta.effort] : []),
    '--permission-mode', PERMISSION_MODE,
    '--allowedTools', meta.allowed_tools || DEFAULT_ALLOWED_TOOLS,
    '--mcp-config', meta.mcp_config,
    '--output-format', 'stream-json', '--verbose',
  ];
}

// Manual mode: an interactive session (`claude "query"` starts one with an initial prompt), with a
// session id chosen here so Status can find its transcript and the "open it" hint can name it. No
// --permission-mode, no --allowedTools: the user's own permission mode, and the user approves.
function manualArgs(meta, prompt) {
  return [
    ...(meta.model ? ['--model', meta.model] : []),
    ...(meta.effort ? ['--effort', meta.effort] : []),
    '--session-id', meta.session_id,
    prompt,
  ];
}

// ---------------------------------------------------------------------------
// Processes: is it alive and ours? (pids are reused, e.g. after a restart)
// ---------------------------------------------------------------------------

const exists = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// pid -> { ppid, created (ms), cmd, exe } from WMI, for the pids that exist.
export async function procInfo(pids) {
  const list = [...new Set(pids.filter(p => Number.isInteger(p) && p > 0 && exists(p)))];
  if (!list.length) return {};
  const ps = "$f = ($env:CDS_PIDS -split ',' | ForEach-Object { \"ProcessId=$_\" }) -join ' OR '; " +
    "$r = @(Get-CimInstance Win32_Process -Filter $f | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; " +
    "created = $_.CreationDate.ToUniversalTime().ToString('o'); cmd = $_.CommandLine; exe = $_.ExecutablePath } }); ConvertTo-Json -InputObject $r -Compress";
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, CDS_PIDS: list.join(',') } });
  const out = {};
  try { for (const x of JSON.parse(r.out.trim() || '[]')) out[x.pid] = { ...x, created: Date.parse(x.created) }; } catch { /* none */ }
  return out;
}

// A recorded process is ours if it exists, started within a minute of when we recorded it, and its
// command line has the expected part (the runner: cds-phase.js --run; run-phase.ps1's cmd: claude).
function isOurs(info, pid, startedIso, mustContain) {
  const x = info[pid];
  if (!x) return false;
  const t = Date.parse(startedIso || '');
  if (!isNaN(t) && Math.abs(x.created - t) > 60000) return false;
  return !mustContain || String(x.cmd || '').toLowerCase().includes(mustContain.toLowerCase());
}

// Every process below rootPid (pid, created ms), from one WMI snapshot. A child must have started
// after its parent, so a parent pid that was reused doesn't pull in strangers.
export async function processTree(rootPid) {
  const ps = "$r = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = $_.Name; " +
    "created = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }) } }); ConvertTo-Json -InputObject $r -Compress";
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  let all = [];
  try { all = JSON.parse(r.out.trim() || '[]').map(x => ({ ...x, created: Date.parse(x.created) })); } catch { return []; }
  const root = all.find(x => x.pid === rootPid);
  if (!root) return [];
  const tree = [root];
  for (let i = 0; i < tree.length; i++) {
    for (const x of all) if (x.ppid === tree[i].pid && x.created >= tree[i].created - 1000 && !tree.includes(x)) tree.push(x);
  }
  return tree;
}

// Ctrl+C into the console of `pid`: a helper PowerShell leaves its own console, attaches to that
// one, ignores the event itself and sends CTRL_C_EVENT to every process attached to it (the runner,
// which ignores it; Claude Code, which ends its turn, runs its SessionEnd hooks and exits; the
// commands it is running). It sends nothing unless AttachConsole succeeded, so it can never reach
// another console. Returns { error } when it couldn't send.
const CTRL_C_PS = [
  "Add-Type -TypeDefinition @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class CdsCtrlC {',
  '  public delegate bool Handler(uint ctrlType);',
  '  static Handler keep = delegate (uint t) { return true; };',
  '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();',
  '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);',
  '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(Handler h, bool add);',
  '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint ev, uint group);',
  '  public static int Send(uint pid) {',
  '    FreeConsole();',
  '    if (!AttachConsole(pid)) return 10;',
  '    SetConsoleCtrlHandler(keep, true);',
  '    bool sent = GenerateConsoleCtrlEvent(0, 0);',
  '    System.Threading.Thread.Sleep(300);',
  '    FreeConsole();',
  '    return sent ? 0 : 11;',
  '  }',
  '}',
  "'@",
  'exit [CdsCtrlC]::Send([uint32]$env:CDS_CTRL_PID)',
].join('\n');

async function sendCtrlC(pid) {
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(CTRL_C_PS, 'utf16le').toString('base64')],
    { env: { ...process.env, CDS_CTRL_PID: String(pid) }, timeout: 30000 });
  if (r.code === 0) return {};
  return { error: r.code === 10 ? `couldn't attach to the run's console (pid ${pid})` : r.code === 11 ? 'Windows refused to send Ctrl+C' : `the Ctrl+C helper failed (exit ${r.code}${r.err.trim() ? `: ${oneLine(r.err, 160)}` : ''})` };
}

async function waitGone(pid, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (!exists(pid)) return true; await sleep(200); }
  return !exists(pid);
}

// The run that matters now (the last), in one shape for the tool's runs and run-phase.ps1's.
function currentRun(meta) {
  if (Array.isArray(meta.runs) && meta.runs.length) return { ...meta.runs[meta.runs.length - 1], index: meta.runs.length - 1, count: meta.runs.length };
  return { kind: 'start', legacy: true, requested: meta.started, runner_pid: meta.pid, runner_started: meta.started, log_offset: 0, err_offset: 0, index: 0, count: 1 };
}

const runnerMark = (r) => r.legacy ? 'claude' : 'cds-phase.js';

// 'running' | 'starting' | 'stopped' | 'ended' | 'gone'
async function runState(meta, info) {
  const r = currentRun(meta);
  if (r.stopped_by_request) return { state: 'stopped', run: r };
  if (r.ended) return { state: 'ended', run: r };
  if (!r.runner_pid) {
    const age = Date.now() - Date.parse(r.requested || 0);
    return { state: age < 60000 ? 'starting' : 'gone', run: r };
  }
  info = info || await procInfo([r.runner_pid]);
  return { state: isOurs(info, r.runner_pid, r.runner_started, runnerMark(r)) ? 'running' : 'gone', run: r };
}

// Every phase in the project with a live run (the lock's, and any docs\*_run.json, which also
// catches runs started by run-phase.ps1).
async function liveRuns(fl) {
  const metas = [];
  let names = [];
  try { names = fs.readdirSync(fl.docs).filter(n => /_run\.json$/i.test(n)); } catch { /* no docs */ }
  for (const n of names) {
    const m = readJson(path.join(fl.docs, n));
    if (!m) continue;
    const r = currentRun(m);
    if (r.stopped_by_request || r.ended) continue;
    metas.push({ m, file: path.join(fl.docs, n), phase: m.phase || n.replace(/_run\.json$/i, '') });
  }
  const info = await procInfo(metas.map(x => currentRun(x.m).runner_pid));
  const live = [];
  for (const x of metas) {
    const s = await runState(x.m, info);
    if (s.state === 'running' || s.state === 'starting') live.push({ ...x, ...s });
  }
  return live;
}

// The lock: takes it, or says who holds it. A lock whose run is gone is stale: cleared, and said.
async function takeLock(fl, phase) {
  const notes = [];
  const live = await liveRuns(fl);
  if (live.length) {
    const x = live[0];
    return { error: `${x.phase} is already running in this project (${x.state}, started ${localTime(x.run.runner_started || x.run.requested)}, pid ${x.run.runner_pid || '?'}). One phase per project at a time: check it with claudedev_phase_status, or end it with claudedev_phase_stop.` };
  }
  const old = readJson(fl.lock);
  if (old || fs.existsSync(fl.lock)) {
    try { fs.unlinkSync(fl.lock); } catch { /* raced */ }
    notes.push(`A stale lock (${old && old.phase ? old.phase : 'unknown phase'}, ${old && old.runner_pid ? `pid ${old.runner_pid}` : 'no pid'}, no longer running: it crashed, was killed, or the PC restarted) was cleared.`);
  }
  try { fs.writeFileSync(fl.lock, JSON.stringify({ phase, requested: new Date().toISOString(), by: process.pid }, null, 2), { flag: 'wx' }); }
  catch (e) { return { error: e.code === 'EEXIST' ? 'Another phase was started in this project just now; check claudedev_phase_status.' : `Couldn't write the lock ${fl.lock}: ${e.message}` }; }
  return { notes };
}

function releaseLock(fl, phase, pid) {
  const l = readJson(fl.lock);
  if (!l || l.phase !== phase) return;
  if (pid && l.runner_pid && l.runner_pid !== pid) return;
  try { fs.unlinkSync(fl.lock); } catch { /* gone */ }
}

// ---------------------------------------------------------------------------
// Launching the runner, outside this process's tree
// ---------------------------------------------------------------------------

// The environment Claude Code gets: this process's, without the variables a parent Claude Code
// session sets (a run started from inside Claude Code must not look nested or write to its project).
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_PROJECT_DIR|CLAUDE_CODE_SSE_PORT|CDS_PIDS|CDS_PHASE_CMD|CDS_PHASE_CWD|CDS_PHASE_CLAUDE)$/i.test(k)) delete env[k];
  }
  return env;
}

// What Claude Code runs with: cleanEnv() plus PHASE_ENV where the user hasn't set the variable.
export function phaseEnv(base = cleanEnv()) {
  const env = { ...base };
  const has = (k) => Object.keys(env).some(x => x.toUpperCase() === k);
  for (const [k, v] of Object.entries(PHASE_ENV)) if (!has(k)) env[k] = v;
  return env;
}

// WMI's Win32_Process.Create: the runner's parent is WMI, not this server, so closing Claude
// Desktop (which ends its servers' process trees) doesn't end the phase; hidden (ShowWindow 0).
// It gets the user's own environment, as a new terminal would (WMI builds it from the user's
// profile), not this server's: Claude Desktop may give its servers a reduced one, and a parent
// Claude Code session's variables (CLAUDECODE, CLAUDE_PROJECT_DIR) must not reach the phase.
// From P8 the runner gets --console: it has its own (hidden) console from WMI, and Claude Code
// shares it, so Stop can send Ctrl+C into it. (The detached fallback has no console: no --console,
// and Claude Code gets a windowless one of its own, as in P7.)
// Windows Terminal, if the user has it (its app execution alias, else on PATH).
export function findTerminal() {
  if (process.env.CDS_PHASE_WINDOW === 'hidden') return null; // tests only
  // An app execution alias is a reparse point that stat() can't follow (existsSync says false): lstat.
  const alias = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WindowsApps', 'wt.exe');
  try { fs.lstatSync(alias); return alias; } catch { /* no Windows Terminal alias */ }
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir.replace(/^"|"$/g, ''), 'wt.exe');
    try { fs.lstatSync(f); return f; } catch { /* not here */ }
  }
  return null;
}

// Manual mode: the runner (and the interactive Claude Code it starts) in a window the user sees,
// also through WMI (outside Claude Desktop's process tree, so closing Claude Desktop doesn't close
// the window). Windows Terminal (a new window, titled, in the project) if present, else a console
// window. CDS_PHASE_WINDOW=hidden (tests only) opens it hidden instead.
async function launchManual(metaFile, index, cwd, title) {
  const runnerCmd = `"${process.execPath}" "${SELF}" --run "${metaFile}" ${index} --manual`;
  const hidden = process.env.CDS_PHASE_WINDOW === 'hidden';
  const wt = findTerminal();
  if (wt) {
    // WMI can't start an app execution alias (Win32_Process.Create returns 8), and doesn't need to:
    // the alias hands the window to Windows Terminal's own process, which hosts the runner there,
    // outside Claude Desktop's process tree. So wt.exe is started directly, detached.
    try {
      const safeTitle = String(title).replace(/[;"^&|<>]/g, ' ');
      const child = spawn(wt, ['-w', 'new', '--title', safeTitle, '-d', cwd, process.execPath, SELF, '--run', metaFile, String(index), '--manual'],
        { cwd, detached: true, stdio: 'ignore', env: cleanEnv() });
      const failed = await new Promise((res) => { child.once('error', (e) => res(e)); setTimeout(() => res(null), 300); });
      if (!failed) { child.unref(); return { pid: child.pid, how: 'windows-terminal', window: 'Windows Terminal' }; }
    } catch { /* fall back to a console window below */ }
  }
  const cmdline = runnerCmd;
  const ps = `$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]${hidden ? 0 : 1} }; ` +
    "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:CDS_PHASE_CMD; CurrentDirectory = $env:CDS_PHASE_CWD; ProcessStartupInformation = $si }; " +
    "\"$($r.ReturnValue) $($r.ProcessId)\"";
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, CDS_PHASE_CMD: cmdline, CDS_PHASE_CWD: cwd },
  });
  const m = /^(\d+)\s+(\d+)/.exec(r.out.trim());
  if (m && m[1] === '0' && Number(m[2]) > 0) return { pid: Number(m[2]), how: 'wmi', window: hidden ? 'hidden (test)' : 'console' };
  return { error: `Couldn't open the Claude Code window (WMI: ${oneLine(r.out + r.err, 160) || `exit ${r.code}`}).` };
}

async function launchRunner(metaFile, index, cwd) {
  const cmdline = `"${process.execPath}" "${SELF}" --run "${metaFile}" ${index} --console`;
  const env = cleanEnv();
  const ps = "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; " +
    "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:CDS_PHASE_CMD; CurrentDirectory = $env:CDS_PHASE_CWD; ProcessStartupInformation = $si }; " +
    "\"$($r.ReturnValue) $($r.ProcessId)\"";
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, CDS_PHASE_CMD: cmdline, CDS_PHASE_CWD: cwd },
  });
  const m = /^(\d+)\s+(\d+)/.exec(r.out.trim());
  if (m && m[1] === '0' && Number(m[2]) > 0) return { pid: Number(m[2]), how: 'wmi' };
  // WMI unavailable: a detached child of this server (it may end if Claude Desktop ends this server's tree).
  try {
    const child = spawn(process.execPath, [SELF, '--run', metaFile, String(index)], { cwd, detached: true, windowsHide: true, stdio: 'ignore', env });
    child.unref();
    return { pid: child.pid, how: 'spawn', note: `WMI didn't start it (${oneLine(r.out + r.err, 160) || `exit ${r.code}`}); started as a detached child instead, which may end if Claude Desktop closes.` };
  } catch (e) {
    return { error: `Couldn't start the runner: ${e.message}` };
  }
}

// Waits (briefly) for the runner to record itself.
async function waitForRunner(metaFile, index, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = readJson(metaFile);
    const r = m && m.runs && m.runs[index];
    if (r && (r.claude_pid || r.ended)) return r;
    await sleep(150);
  }
  const m = readJson(metaFile);
  return m && m.runs && m.runs[index];
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

// Reads a file another process is writing (shared read), from a byte offset.
function readShared(file, from = 0) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return ''; }
  try {
    const n = fs.fstatSync(fd).size;
    if (n <= from) return '';
    const buf = Buffer.alloc(n - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

const DENIED = /requested permissions|haven'?t granted|permission to use|was denied|not allowed|permission denied/i;

function parseLog(text) {
  const s = { init: null, result: null, toolCalls: 0, texts: [], denied: new Map(), sessionId: null, events: 0 };
  const names = new Map();
  const deny = (id, name) => { const k = id || `${name}:${s.denied.size}`; if (!s.denied.has(k)) s.denied.set(k, name || names.get(id) || 'a tool'); };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    s.events++;
    if (e.session_id) s.sessionId = e.session_id;
    if (e.type === 'system' && e.subtype === 'init') s.init = e;
    else if (e.type === 'system' && e.subtype === 'permission_denied') deny(e.tool_use_id, e.tool_name);
    else if (e.type === 'result') {
      s.result = e;
      for (const d of e.permission_denials || []) deny(d.tool_use_id, d.tool_name);
    } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) {
        if (c.type === 'tool_use') { s.toolCalls++; names.set(c.id, c.name); }
        else if (c.type === 'text' && c.text && c.text.trim() && !e.parent_tool_use_id && !e.isSidechain) s.texts.push(c.text.trim());
      }
    } else if (e.type === 'user' && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) {
        if (c.type !== 'tool_result' || !c.is_error) continue;
        const body = typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '');
        if (DENIED.test(body)) deny(c.tool_use_id);
      }
    }
  }
  return s;
}

// Does the end look like a question for the user? (phase-status.ps1's rule.)
export function looksLikeQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\?\s*[*_)"'”’`]*\s*$/.test(t)) return true;
  return /\b(should I|do you want|would you like|which (one|option)|please confirm|waiting for (you|your))\b/i.test(t.slice(-600));
}

// A phase's QUESTION: block (from P9; the templates' HOW_WE_WORK.md says how to write one): a line
// starting "QUESTION:" (markdown emphasis or a heading mark allowed) with the question, then numbered
// options ("1." or "1)"), each with its consequence, then a recommendation ("RECOMMENDATION:", or "I'd
// pick ..."). The last such block in the text counts. Everything is returned verbatim (trimmed), so
// chat-side Claude can relay it as written; null when there is no block.
const OPTION = /^\s*[*_]*\(?(\d{1,2})[.)][*_]*\s+/;
const RECO = /^\s*[*_>]*\s*(RECOMMENDATION|RECOMMENDED|MY RECOMMENDATION|MY PICK|I would pick|I'd pick|I would choose|I'd choose|I recommend)\b/i;
export function parseQuestion(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const re = /^[ \t>#*_]*QUESTION[*_]*[ \t]*:[*_]*[ \t]*(.*)$/gim;
  let m, last = null;
  while ((m = re.exec(t))) last = m;
  if (!last) return null;
  const before = t.slice(0, last.index).trim();
  const lines = t.slice(last.index + last[0].length).split('\n');
  const q = [last[1].trim()].filter(Boolean);
  const options = [];
  const reco = [];
  let part = 'question';
  for (const l of lines) {
    if (RECO.test(l)) { part = 'reco'; reco.push(l.trim()); continue; }
    if (part !== 'reco' && OPTION.test(l)) { part = 'options'; options.push(l.trim()); continue; }
    if (!l.trim()) { if (part === 'reco' && reco.length) part = 'after'; continue; }
    if (part === 'question') q.push(l.trim());
    else if (part === 'options') options[options.length - 1] += `\n${l.trim()}`;
    else if (part === 'reco') reco.push(l.trim());
  }
  const question = q.join('\n').trim();
  if (!question) return null;
  return { question, options, recommendation: reco.join('\n').trim() || null, before };
}

// The block as Status and the Dashboard show it (verbatim lines).
export function questionBlock(pq) {
  return [pq.question, ...pq.options, ...(pq.recommendation ? [pq.recommendation] : [])].join('\n');
}

// ---------------------------------------------------------------------------
// The conversation as readable text (the Dashboard's Phases page; from P9)
// ---------------------------------------------------------------------------

const TOOL_TARGET = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'subject', 'skill', 'prompt'];
function toolLine(name, input) {
  const short = String(name || 'tool').replace(/^mcp__([^_]+(?:_[^_]+)*)__/, (s, srv) => `${srv}: `);
  let target = '';
  if (input && typeof input === 'object') {
    for (const k of TOOL_TARGET) if (typeof input[k] === 'string' && input[k].trim()) { target = input[k]; break; }
    if (!target) { const v = Object.values(input).find(x => typeof x === 'string' && x.trim()); if (v) target = v; }
  }
  return target ? `${short}: ${oneLine(String(target).split('\n')[0], 140)}` : short;
}

function resultBody(c) {
  if (typeof c.content === 'string') return c.content;
  if (Array.isArray(c.content)) return c.content.map(x => (x && x.type === 'text' ? x.text : x && x.type === 'image' ? '[image]' : JSON.stringify(x))).join('\n');
  return c.content == null ? '' : JSON.stringify(c.content);
}

// Entries { kind, text, detail?, error? } from a phase log (stream-json) or a Claude Code transcript:
//   start    the session's start (model, permission mode)
//   user     a message to Claude (the first prompt in a transcript, an interruption)
//   claude   Claude's text, in full
//   question a QUESTION: block, verbatim (its text before it is a claude entry)
//   tool     one line per tool call: the tool and its target
//   result   a tool's result, collapsed to one line; detail = its text (up to 4,000 characters)
//   end      a run's result (subtype, turns, time)
// Subagents' messages are left out (their tool calls show as the Agent/Task call).
export function conversation(text) {
  const entries = [];
  let sessionId = null, lastClaude = null;
  const pushText = (t) => {
    const s = String(t || '').trim();
    if (!s) return;
    const pq = parseQuestion(s);
    if (pq) {
      if (pq.before) entries.push({ kind: 'claude', text: pq.before });
      entries.push({ kind: 'question', text: questionBlock(pq) });
    } else entries.push({ kind: 'claude', text: s });
    lastClaude = s;
  };
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.session_id || e.sessionId) sessionId = e.session_id || e.sessionId;
    if (e.parent_tool_use_id || e.isSidechain || e.isMeta) continue;
    if (e.type === 'system' && e.subtype === 'init') {
      entries.push({ kind: 'start', text: `Session started${e.model ? `: ${e.model}` : ''}${e.permissionMode ? `, ${e.permissionMode}` : ''}${Array.isArray(e.tools) ? `, ${e.tools.length} tools` : ''}` });
    } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) {
        if (c.type === 'text') pushText(c.text);
        else if (c.type === 'tool_use') entries.push({ kind: 'tool', text: toolLine(c.name, c.input) });
      }
    } else if (e.type === 'user' && e.message) {
      const content = e.message.content;
      if (typeof content === 'string') { if (content.trim()) entries.push({ kind: 'user', text: content.trim() }); continue; }
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c.type === 'text' && c.text && c.text.trim()) entries.push({ kind: 'user', text: c.text.trim() });
        else if (c.type === 'tool_result') {
          const body = resultBody(c);
          const ls = body.split(/\r?\n/).filter(x => x.trim());
          const first = ls.length ? oneLine(ls[0], 120) : '(empty)';
          entries.push({ kind: 'result', error: !!c.is_error, text: `${c.is_error ? 'error' : 'result'}: ${first}${ls.length > 1 ? ` (+${ls.length - 1} line${ls.length === 2 ? '' : 's'})` : ''}`, detail: body.length > 4000 ? `${body.slice(0, 4000)}\n…` : body });
        }
      }
    } else if (e.type === 'result') {
      const r = String(e.result || '').trim();
      if (r && r !== lastClaude) pushText(r);
      entries.push({ kind: 'end', error: !!e.is_error, text: `Run ended: ${e.subtype || 'result'}${e.num_turns != null ? `, ${e.num_turns} turns` : ''}${e.duration_ms != null ? `, ${minutes(e.duration_ms)}` : ''}${e.is_error ? ' (is_error)' : ''}` });
    }
  }
  return { session_id: sessionId, entries };
}

export function conversationText(conv) {
  const out = [];
  for (const x of conv.entries) {
    if (x.kind === 'claude') out.push(`Claude: ${x.text}`, '');
    else if (x.kind === 'question') out.push('=== QUESTION ===', x.text, '================', '');
    else if (x.kind === 'tool') out.push(`  > ${x.text}`);
    else if (x.kind === 'result') out.push(`    ${x.text}`);
    else if (x.kind === 'user') out.push(`You: ${x.text}`, '');
    else out.push(`-- ${x.text} --`, '');
  }
  return out.join('\n').trim();
}

// Claude Code's transcripts: <config dir>\projects\<project>\<session-id>.jsonl (the config dir is
// %USERPROFILE%\.claude, or CLAUDE_CONFIG_DIR; Claude Code's docs, "Where transcripts are stored").
// Searched by the session id, so the <project> name's encoding doesn't matter.
export function findTranscript(sessionId) {
  if (!sessionId) return null;
  const base = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  const dir = path.join(base, 'projects');
  try {
    for (const d of fs.readdirSync(dir)) {
      const f = path.join(dir, d, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch { /* none */ }
  return null;
}

// ---------------------------------------------------------------------------
// The index of runs (from P9): [Documents]\ClaudeDevStudio\phases.json, for the tray app's
// notifications and the Dashboard's project list. In Documents, not %LOCALAPPDATA%: phaseStart runs
// inside Claude Desktop's server, and files a packaged app's process creates under AppData are
// redirected into the package (docs\GROUND_TRUTH.md section 11); Documents isn't.
// ---------------------------------------------------------------------------

export const phasesIndexFile = () => path.join(memoryRoot(), 'phases.json');
const INDEX_MAX = 60;

export function addToIndex(project, phase, mode, meta) {
  try {
    const file = phasesIndexFile();
    const cur = readJson(file);
    const list = (cur && Array.isArray(cur.runs) ? cur.runs : []).filter(x => !(String(x.project).toLowerCase() === project.toLowerCase() && x.phase === phase));
    list.unshift({ project, phase, mode, started: new Date().toISOString(), meta });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJson(file, { about: 'Phase runs started by ClaudeDevStudio (newest first); the tray app and the Dashboard read it.', runs: list.slice(0, INDEX_MAX) });
    return null;
  } catch (e) { return e.message; }
}

function sessionFromLog(fl) {
  const text = readShared(fl.log, 0);
  let id = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"session_id"')) continue;
    try { const e = JSON.parse(line); if (e.type === 'result' || (e.type === 'system' && e.subtype === 'init')) id = e.session_id || id; } catch { /* partial line */ }
  }
  return id;
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

async function begin(fl, meta, kind, opts) {
  const index = meta.runs.length;
  meta.runs.push({
    kind, requested: new Date().toISOString(), log_offset: size(fl.log), err_offset: size(fl.err),
    ...(opts.message != null ? { message: oneLine(opts.message, 300), stdin: opts.stdin } : {}),
    command: [...meta.claude.command, ...(kind === 'manual' ? manualArgs(meta, opts.prompt) : claudeArgs(meta, opts))],
  });
  writeJson(fl.meta, meta);
  const l = kind === 'manual'
    ? await launchManual(fl.meta, index, meta.project, `CDS ${meta.phase} - ${path.basename(meta.project)}`)
    : await launchRunner(fl.meta, index, meta.project);
  if (l.error) {
    updateMeta(fl.meta, m => { Object.assign(m.runs[index], { ended: new Date().toISOString(), error: l.error }); });
    releaseLock(fl, meta.phase);
    return { error: l.error };
  }
  updateMeta(fl.meta, m => { m.runs[index].launched_by = l.how; if (l.window) m.runs[index].window = l.window; });
  const r = await waitForRunner(fl.meta, index, kind === 'manual' ? 20000 : 8000);
  if (r && r.ended && r.error) return { error: `Claude Code didn't start: ${r.error}` };
  if (kind === 'manual' && !(r && r.runner_pid)) {
    // A window that never started its runner (e.g. Windows Terminal refused the command line).
    updateMeta(fl.meta, m => { Object.assign(m.runs[index], { ended: new Date().toISOString(), error: 'the window did not start Claude Code within 20 s' }); });
    releaseLock(fl, meta.phase);
    return { error: `The ${l.window || 'Claude Code'} window didn't start Claude Code within 20 s. Open it by hand: in a terminal in ${meta.project}, run: claude "${manualPrompt(meta.phase)}"` };
  }
  return { pid: (r && r.runner_pid) || l.pid, claudePid: r && r.claude_pid, note: l.note, window: l.window };
}

export async function phaseStart(args = {}) {
  const pr = checkProject(args.project_path);
  if (pr.error) return refuse(pr.error);
  const bad = checkPhase(args.phase);
  if (bad) return refuse(bad);
  const { project } = pr, phase = args.phase;
  const fl = files(project, phase);
  if (!fs.existsSync(fl.prompt)) {
    return refuse(`There is no docs\\${phase}_prompt.md in ${project}. A phase starts only from a prompt file the user can read first: write it, then start the phase.`);
  }
  if (args.model != null && args.model !== '' && !/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/.test(String(args.model))) return refuse('model must be a model name or alias, e.g. claude-opus-5-5 or sonnet.');
  if (args.effort != null && args.effort !== '' && !EFFORTS.includes(String(args.effort))) return refuse(`effort must be one of ${EFFORTS.join(', ')}.`);
  const mode = args.mode == null || args.mode === '' ? DEFAULT_MODE : String(args.mode).toLowerCase();
  if (!MODES.includes(mode)) return refuse(`mode must be one of ${MODES.join(', ')} (default ${DEFAULT_MODE}).`);
  const manual = mode === 'manual';
  const tools = checkTools(manual ? null : args.allowed_tools);
  if (tools.error) return refuse(tools.error);
  const claude = await findClaude();
  if (claude.error) return refuse(claude.error);

  const lock = await takeLock(fl, phase);
  if (lock.error) return refuse(lock.error);
  const notes = [...lock.notes];
  if (manual && args.allowed_tools) notes.push('allowed_tools is not used in manual mode: the user approves each action in the window.');
  try {
    // A finished run of the same phase: its files are kept, moved to docs\phase_runs\.
    if (fs.existsSync(fl.meta) || fs.existsSync(fl.log)) {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
      const dir = path.join(fl.docs, 'phase_runs');
      fs.mkdirSync(dir, { recursive: true });
      for (const f of [fl.log, fl.err, fl.meta]) {
        if (fs.existsSync(f)) fs.renameSync(f, path.join(dir, path.basename(f).replace('_run.', `_${stamp}_run.`)));
      }
      notes.push(`The previous ${phase} run's files were moved to docs\\phase_runs\\ (${phase}_${stamp}_run.*).`);
    }
    const meta = manual ? {
      phase, project, tool: 'cds-phase', mode, pid: null, started: new Date().toISOString(),
      model: args.model || null, effort: args.effort || null, permission_mode: 'the user\'s own (interactive)',
      session_id: crypto.randomUUID(),
      claude: { file: claude.file, command: claude.command, version: claude.version },
      runs: [],
    } : {
      phase, project, tool: 'cds-phase', mode, pid: null, started: new Date().toISOString(),
      model: args.model || null, effort: args.effort || null, permission_mode: PERMISSION_MODE,
      allowed_tools: tools.tools, mcp_config: mcpConfig(project, phase),
      claude: { file: claude.file, command: claude.command, version: claude.version },
      log: fl.log, err: fl.err, runs: [],
    };
    if (!manual) {
      fs.writeFileSync(fl.log, '', { flag: 'a' });
      fs.writeFileSync(fl.err, '', { flag: 'a' });
    }
    const b = manual
      ? await begin(fl, meta, 'manual', { prompt: manualPrompt(phase) })
      : await begin(fl, meta, 'start', { prompt: answeredPrompt(phase) });
    if (b.error) return refuse(b.error);
    if (b.note) notes.push(b.note);
    const ix = addToIndex(project, phase, mode, fl.meta);
    if (ix) notes.push(`(Couldn't add it to the tray app's list of runs: ${oneLine(ix, 120)}.)`);
    if (manual) {
      return ok([
        `Opened ${phase} in a Claude Code window the user can see (${b.window}), in ${project}: Claude Code ${claude.version}, ${meta.model || 'its default model'}, interactive, in the user's own permission mode (runner pid ${b.pid}${b.claudePid ? `, claude pid ${b.claudePid}` : ''}).`,
        `Its first message is "${manualPrompt(phase)}". The user watches it and approves what it asks; the lock holds the project until the window is closed. Session ${meta.session_id}.`,
        MODE_GUIDANCE.manual,
        'claudedev_phase_status shows what it is doing (from the session\'s transcript); claudedev_phase_stop asks the user to close the window (force: true ends it).',
        ...notes,
      ].join('\n'));
    }
    return ok([
      `Started ${phase} in ${project}: Claude Code ${claude.version}, ${meta.model || 'its default model'}, effort ${meta.effort || 'its default'}, permission mode ${PERMISSION_MODE} (runner pid ${b.pid}${b.claudePid ? `, claude pid ${b.claudePid}` : ''}).`,
      `It is working on docs\\${phase}_prompt.md now, unattended, with ${meta.allowed_tools === DEFAULT_ALLOWED_TOOLS
        ? 'the default tools (Read, Edit, Write, Glob, Grep, Bash, PowerShell, WebFetch, WebSearch and the like, and the CDS memory tools)'
        : `these tools: ${oneLine(meta.allowed_tools, 400)}`}.`,
      `Log: docs\\${phase}_run.log (and .err, .json). Check it with claudedev_phase_status every 10-20 minutes; stop it with claudedev_phase_stop.`,
      MODE_GUIDANCE[mode],
      ...notes,
    ].join('\n'));
  } catch (e) {
    releaseLock(fl, phase);
    return refuse(`Couldn't start ${phase}: ${e.message}`);
  }
}

function newestPhase(docs) {
  let best = null;
  try {
    for (const n of fs.readdirSync(docs)) {
      if (!/_run\.json$/i.test(n)) continue;
      const t = fs.statSync(path.join(docs, n)).mtimeMs;
      if (!best || t > best.t) best = { t, phase: n.replace(/_run\.json$/i, '') };
    }
  } catch { /* no docs */ }
  return best && best.phase;
}

export async function phaseStatus(args = {}) {
  if (!args.project_path) return refuse('project_path is required.');
  const project = path.resolve(String(args.project_path));
  const docs = path.join(project, 'docs');
  const phase = args.phase || newestPhase(docs);
  if (!phase) return refuse(`No phase runs in ${docs} (no docs\\<phase>_run.json).`);
  const bad = checkPhase(phase);
  if (bad) return refuse(bad);
  const fl = files(project, phase);
  const meta = readJson(fl.meta);
  if (!meta) return refuse(`No run recorded for ${phase} in ${project} (no docs\\${phase}_run.json).`);

  const st = await runState(meta);
  const r = st.run;
  const notes = [];
  // A run that is gone without a record (crash, kill, restart): its lock is stale; cleared here.
  if (st.state === 'gone') {
    const l = readJson(fl.lock);
    if (l && l.phase === phase) { try { fs.unlinkSync(fl.lock); } catch { /* raced */ } notes.push('Its lock was stale (the process is gone) and has been cleared.'); }
  }
  const manual = meta.mode === 'manual';
  const transcript = manual ? findTranscript(meta.session_id) : null;
  const text = manual ? (transcript ? readShared(transcript, 0) : '') : readShared(fl.log, r.log_offset || 0);
  const s = parseLog(text);
  const res = s.result;
  const startedAt = r.runner_started || r.requested || meta.started;
  const endMs = r.ended ? Date.parse(r.ended) : (res && res.duration_ms ? Date.parse(startedAt) + res.duration_ms : Date.now());
  const mode = meta.mode || (Array.isArray(meta.runs) ? 'collaborative' : null);
  let label;
  if (st.state === 'starting') label = 'STARTING';
  else if (manual && st.state === 'running') label = `OPEN in a Claude Code window (manual mode${r.window ? `, ${r.window}` : ''}: the user works in it and approves its actions)`;
  else if (manual && st.state === 'ended') label = `CLOSED (Claude Code exited${r.exit_code != null ? ` with code ${r.exit_code}` : ''}${r.error ? `: ${oneLine(r.error, 120)}` : ''}; the window is gone)`;
  else if (st.state === 'running') label = res ? 'RUNNING (it has a result and is waiting for background work it started)' : 'RUNNING';
  else if (st.state === 'stopped') {
    label = r.stop_method === 'ctrl_c' ? 'STOPPED (by request, with Ctrl+C: Claude Code ended its turn and exited, so its SessionEnd hooks ran)'
      : r.stop_method === 'force' ? `STOPPED (by request, by force${r.stop_note ? `: ${oneLine(r.stop_note, 120)}` : ''}; no SessionEnd hooks, no automatic handoff)`
      : 'STOPPED (by request)';
  }
  else if (res) label = res.is_error ? `FINISHED WITH AN ERROR (${res.subtype})` : 'FINISHED';
  else if (st.state === 'ended') label = `ENDED WITHOUT A RESULT (exit code ${r.exit_code ?? '?'}${r.error ? `: ${oneLine(r.error, 120)}` : ''})`;
  else label = 'ENDED WITHOUT A RESULT (the process is gone: crashed, killed, or the PC restarted)';

  const lines = [];
  lines.push(`${phase} in ${project}: ${label}, ${minutes(endMs - Date.parse(startedAt))} (started ${localTime(startedAt)}${r.count > 1 ? `; run ${r.index + 1} of ${r.count}, ${r.kind === 'reply' ? 'a reply' : 'the start'}` : ''}${r.legacy ? '; started by run-phase.ps1' : ''}).`);
  if (mode) lines.push(`${MODE_GUIDANCE[mode] || `Mode: ${mode}.`}${meta.mode ? '' : ' (Started before modes existed: collaborative assumed.)'}`);
  if (manual) lines.push(transcript ? `Transcript: ${transcript} (session ${meta.session_id}).` : `No transcript yet for session ${meta.session_id} (Claude Code writes it once the first message is sent; the window may be waiting for the user, e.g. to trust the folder).`);
  if (s.init) {
    // CDS's own servers by name; the user's other servers only counted.
    const all = s.init.mcp_servers || [];
    const cds = all.filter(m => /^(claudedevstudio|cds-workbench)$/.test(m.name));
    const others = all.length - cds.length;
    const mcp = [...cds.map(m => `${m.name}=${m.status}`), ...(others ? [`${others} other server${others === 1 ? '' : 's'}`] : [])].join(', ');
    lines.push(`Model ${s.init.model || meta.model || '?'}${meta.effort ? `, effort ${meta.effort}` : ''}${s.init.permissionMode ? `, ${s.init.permissionMode}` : ''}${mcp ? ` | MCP: ${oneLine(mcp, 200)}` : ''}`);
  }
  const deniedNames = [...s.denied.values()];
  const counts = {};
  for (const n of deniedNames) counts[n] = (counts[n] || 0) + 1;
  lines.push(`Tool calls: ${s.toolCalls} | permission denials: ${deniedNames.length}${deniedNames.length ? ` (${Object.entries(counts).map(([n, c]) => c > 1 ? `${n} ×${c}` : n).join(', ')})` : ''}`);
  if (r.kind === 'reply' && r.message) lines.push(`Reply sent: "${oneLine(r.message, 160)}"`);
  // The text that ends the run: the result's, else (a manual session, or a run that ended without a
  // result) Claude's last text.
  const live = st.state === 'running' || st.state === 'starting';
  const finalText = String(res ? res.result || '' : (manual || !live ? s.texts[s.texts.length - 1] || '' : '')).trim();
  const pq = parseQuestion(finalText);
  const latest = s.texts.slice(-3).filter(t => t !== finalText).slice(-2);
  if (latest.length) { lines.push('Latest from Claude:'); for (const t of latest) lines.push(`- ${oneLine(t, 300)}`); }
  if (res) lines.push(`Result: ${res.subtype}, ${res.num_turns ?? '?'} turns, ${res.duration_ms != null ? minutes(res.duration_ms) : '?'}${res.is_error ? ', is_error' : ''}.`);
  let qBlock = null;
  if (pq) {
    if (pq.before) lines.push(`"${oneLine(pq.before, 500)}"`);
    qBlock = [
      `It ends with a QUESTION (verbatim from the phase; relay it as written)${manual ? '; the user answers it in the window' : ''}:`,
      'Question:', pq.question,
      ...(pq.options.length ? ['Options:', ...pq.options] : ['Options: none given.']),
      `Its recommendation: ${pq.recommendation || 'none given.'}`,
      ...(manual ? [] : [`Answer with claudedev_phase_reply (project_path, phase "${phase}", message), as the mode above says.`]),
    ].join('\n');
    if (qBlock.length > 2400) qBlock = `${qBlock.slice(0, 2399)}…`;
    lines.push('\u0000QUESTION');
  } else {
    if (res && finalText) lines.push(`"${oneLine(finalText, 700)}"`);
    else if (!res && finalText && !live) lines.push(`Its last text: "${oneLine(finalText, 500)}"`);
    if (looksLikeQuestion(finalText)) lines.push(manual ? 'It ends with a question for the user, in the window.' : `It ends with a QUESTION (no QUESTION: block; read its text above): answer it with claudedev_phase_reply (project_path, phase "${phase}", message), as the mode above says.`);
  }
  let out = 'not written yet';
  try { const o = fs.statSync(fl.output); out = `written ${localTime(o.mtime.toISOString())}, ${shownSize(o.size)}`; } catch { /* none */ }
  lines.push(`docs\\${phase}_OUTPUT.md: ${out}.`);
  const errText = readShared(fl.err, r.err_offset || 0).trim();
  if (errText && !manual) lines.push(`stderr: ${oneLine(errText.split(/\r?\n/).slice(-3).join(' | '), 300)}`);
  if (!manual) lines.push(`Log: docs\\${phase}_run.log (${shownSize(size(fl.log))}).`);
  // "Open it": the whole conversation in Claude Code, to read or take over (not while a headless run
  // still writes to it; a manual run's window is already open).
  // (A manual session with no transcript never sent its first message: nothing to open.)
  const sid = manual ? (transcript ? meta.session_id : null) : (s.sessionId || sessionFromLog(fl));
  if (!live && sid) lines.push(`Open it: in ${project}, run claude --resume ${sid} (read the whole conversation, or take it over).`);
  lines.push(...notes);

  // Budget: shorten the latest texts first, then the result; the question block is never cut (it
  // has its own cap above), the rest gets what is left.
  const max = STATUS_MAX - (qBlock ? qBlock.length : 0);
  const join = (ls) => ls.join('\n');
  let body = lines;
  if (join(body).length > max) body = lines.map(l => l.startsWith('- ') ? oneLine(l, 160) : l);
  if (join(body).length > max) body = lines.map(l => l.startsWith('- ') ? oneLine(l, 100) : (l.startsWith('"') ? oneLine(l, 300) : l));
  let textOut = join(body);
  if (textOut.length > Math.max(max, 1000)) textOut = `${textOut.slice(0, Math.max(max, 1000) - 1)}…`;
  if (qBlock) textOut = textOut.includes('\u0000QUESTION') ? textOut.replace('\u0000QUESTION', qBlock) : `${textOut}\n${qBlock}`;
  return ok(textOut);
}

export async function phaseReply(args = {}) {
  const pr = checkProject(args.project_path);
  if (pr.error) return refuse(pr.error);
  const bad = checkPhase(args.phase);
  if (bad) return refuse(bad);
  const message = String(args.message ?? '');
  if (!message.trim()) return refuse('message is required: the answer to send to the session.');
  if (message.length > 100000) return refuse('message is too long (over 100,000 characters).');
  const { project } = pr, phase = args.phase;
  const fl = files(project, phase);
  const meta = readJson(fl.meta);
  if (!meta) return refuse(`No run recorded for ${phase} in ${project}: start it with claudedev_phase_start.`);
  if (meta.mode === 'manual') {
    return refuse(`${phase} runs in manual mode: the user answers in its Claude Code window. If the window is closed, the user can open the session again with claude --resume ${meta.session_id} in ${project}, or start the phase again in another mode.`);
  }
  const st = await runState(meta);
  if (st.state === 'running' || st.state === 'starting') return refuse(`${phase} is still running: wait until claudedev_phase_status says it finished, or stop it first.`);
  const sid = sessionFromLog(fl);
  if (!sid) return refuse(`No session id in docs\\${phase}_run.log (the run ended before Claude Code started its session), so there is nothing to continue. Start the phase again.`);
  const claude = await findClaude();
  if (claude.error) return refuse(claude.error);
  const lock = await takeLock(fl, phase);
  if (lock.error) return refuse(lock.error);
  try {
    // A run started by run-phase.ps1 has no stored tool list or command: the defaults, its model and effort.
    if (!Array.isArray(meta.runs)) {
      meta.runs = [{ kind: 'start', legacy: true, requested: meta.started, runner_pid: meta.pid, runner_started: meta.started, log_offset: 0, err_offset: 0, ended: new Date().toISOString() }];
      meta.allowed_tools = meta.allowed_tools || DEFAULT_ALLOWED_TOOLS;
      meta.permission_mode = PERMISSION_MODE;
      meta.project = project;
    }
    meta.claude = { file: claude.file, command: claude.command, version: claude.version };
    if (!meta.mcp_config || !fs.existsSync(meta.mcp_config)) meta.mcp_config = mcpConfig(project, phase);
    // The message goes in on stdin from a file in %TEMP% (removed when the run ends).
    const stdin = path.join(os.tmpdir(), `cds_phase_reply_${crypto.randomBytes(6).toString('hex')}.txt`);
    fs.writeFileSync(stdin, message, 'utf8');
    const b = await begin(fl, meta, 'reply', { prompt: null, resume: sid, message, stdin });
    if (b.error) return refuse(b.error);
    addToIndex(project, phase, meta.mode || DEFAULT_MODE, fl.meta);
    return ok([
      `Sent the reply to ${phase} (session ${sid}): it continues with the same model (${meta.model || 'default'}), effort (${meta.effort || 'default'}) and tools (runner pid ${b.pid}).`,
      `Appended to docs\\${phase}_run.log; claudedev_phase_status shows it as run ${meta.runs.length}.`,
      'Tell the user what it asked and what you answered.',
      ...lock.notes, ...(b.note ? [b.note] : []),
    ].join('\n'));
  } catch (e) {
    releaseLock(fl, phase);
    return refuse(`Couldn't send the reply: ${e.message}`);
  }
}

export async function phaseStop(args = {}) {
  if (!args.project_path) return refuse('project_path is required.');
  const project = path.resolve(String(args.project_path));
  const bad = checkPhase(args.phase);
  if (bad) return refuse(bad);
  const phase = args.phase;
  const fl = files(project, phase);
  let meta = readJson(fl.meta);
  if (!meta) return refuse(`No run recorded for ${phase} in ${project}.`);
  let st = await runState(meta);
  if (st.state === 'starting') { await waitForRunner(fl.meta, st.run.index); meta = readJson(fl.meta); st = await runState(meta); }
  const r = st.run;
  if (st.state !== 'running') {
    const l = readJson(fl.lock);
    const cleared = l && l.phase === phase && st.state !== 'starting';
    if (cleared) { try { fs.unlinkSync(fl.lock); } catch { /* gone */ } }
    return ok(`${phase} isn't running (${st.state === 'stopped' ? 'already stopped' : 'it has ended'}); nothing to stop.${cleared ? ' Its leftover lock was cleared.' : ''}`);
  }
  // Manual mode (P9): the user's window. Stop asks for it to be closed; force: true ends it.
  const manual = meta.mode === 'manual';
  if (manual && !args.force) {
    return ok(`${phase} is open in the user's Claude Code window (manual mode, ${project}). Ask the user to finish there and close the window (or type /exit in it). If they want it ended now, call claudedev_phase_stop again with force: true: Claude Code gets Ctrl+C twice (it exits and runs its SessionEnd hooks), else the window's process tree is ended by force.`);
  }
  // Ours? (checked again right before ending it: a reused pid is never touched)
  const pids = [r.runner_pid, r.claude_pid].filter(Boolean);
  const info = await procInfo(pids);
  if (!isOurs(info, r.runner_pid, r.runner_started, runnerMark(r))) return ok(`${phase}'s process ${r.runner_pid} is no longer the run's (it has ended); nothing stopped.`);

  // 1. Ctrl+C (from P8), when Claude Code shares the runner's console. An interactive session (manual)
  // exits on a second Ctrl+C pressed soon after the first, so its two presses are half a second apart.
  const t0 = Date.now();
  let method = 'force', why = null, presses = 0, ended = 0;
  if (r.shares_console && !r.legacy) {
    const tree = await processTree(r.runner_pid);
    for (const wait of manual ? [500, 8000] : CTRL_C_WAIT_MS) {
      const c = await sendCtrlC(r.runner_pid);
      if (c.error) { why = c.error; break; }
      presses++;
      // A manual runner keeps its window open 10 s after Claude Code exits, so there Claude Code is watched.
      if (await waitGone(manual && r.claude_pid ? r.claude_pid : r.runner_pid, wait)) { method = 'ctrl_c'; break; }
    }
    if (method === 'ctrl_c') {
      // What the run started and left behind (a command in a console of its own): ended, if still the same process.
      // (Not the console host: it is the window itself, which a manual runner keeps open for its last note.)
      const rest = tree.filter(x => x.pid !== r.runner_pid && !/^(conhost|openconsole)\.exe$/i.test(String(x.name || '')));
      const now = await procInfo(rest.map(x => x.pid));
      for (const x of rest) {
        const y = now[x.pid];
        if (!y || Math.abs(y.created - x.created) > 1000) continue;
        const k3 = await run('taskkill.exe', ['/PID', String(x.pid), '/T', '/F'], { timeout: 30000 });
        ended += (k3.out.match(/SUCCESS/g) || []).length;
      }
    } else if (!why) why = `Ctrl+C (sent ${presses} time${presses === 1 ? '' : 's'}) didn't end it within ${(manual ? 8500 : CTRL_C_WAIT_MS.reduce((a, b) => a + b, 0)) / 1000} s`;
  } else {
    why = r.legacy ? 'a run started by run-phase.ps1 (its Claude Code has a console of its own)' : 'a run started before P8 (its Claude Code has a console of its own)';
  }
  if (method === 'force' && manual) why = `${why}; the window closes`;
  if (method === 'ctrl_c') {
    const after = readJson(fl.meta);
    const rr = after && after.runs ? after.runs[after.runs.length - 1] : {};
    updateMeta(fl.meta, m => { Object.assign(m.runs[m.runs.length - 1], { stopped_by_request: true, stop_method: 'ctrl_c', ctrl_c_presses: presses, stop_ms: Date.now() - t0, ...(rr.ended ? {} : { ended: new Date().toISOString() }), ...(ended ? { leftover_processes_ended: ended } : {}) }); });
    releaseLock(fl, phase);
    return ok(`Stopped ${phase} in ${project} with Ctrl+C (${((Date.now() - t0) / 1000).toFixed(1)} s${presses > 1 ? `, ${presses} presses` : ''}): ${manual ? `Claude Code in the user's window exited (exit code ${rr.exit_code ?? '?'}), so its SessionEnd hooks ran if a session had started (with CDS's Claude Code hooks: an automatic handoff); the window shows a last note and closes 10 s later.` : `Claude Code ended its turn and exited (exit code ${rr.exit_code ?? '?'}), so its SessionEnd hooks ran (with CDS's Claude Code hooks: an automatic handoff).`}` +
      `${ended ? ` ${ended} process${ended === 1 ? '' : 'es'} it left running ${ended === 1 ? 'was' : 'were'} ended.` : ''} The lock is released; docs\\${phase}_run.json records it as stopped by request. ${manual ? `The user can open the session again with claude --resume ${meta.session_id}.` : 'claudedev_phase_reply can continue the session.'}`);
  }

  // 2. By force: the runner's process tree.
  const k = await run('taskkill.exe', ['/PID', String(r.runner_pid), '/T', '/F'], { timeout: 30000 });
  ended = (k.out.match(/SUCCESS/g) || []).length;
  // Claude Code, if it outlived its runner somehow (its parent is the runner, or it is the recorded claude).
  if (r.claude_pid && exists(r.claude_pid)) {
    const ci = await procInfo([r.claude_pid]);
    const c = ci[r.claude_pid];
    if (c && c.created >= Date.parse(r.runner_started || r.requested) - 5000 && (c.ppid === r.runner_pid || String(c.cmd || '').includes('stream-json'))) {
      const k2 = await run('taskkill.exe', ['/PID', String(r.claude_pid), '/T', '/F'], { timeout: 30000 });
      ended += (k2.out.match(/SUCCESS/g) || []).length;
    }
  }
  await sleep(300);
  const still = pids.filter(exists);
  const stillOurs = still.length ? await procInfo(still) : {};
  const left = still.filter(p => stillOurs[p] && (p !== r.runner_pid || isOurs(stillOurs, p, r.runner_started, runnerMark(r))));
  const forced = { stopped_by_request: true, stop_method: 'force', stop_note: why, ...(presses ? { ctrl_c_presses: presses } : {}), ended: new Date().toISOString(), stopped_processes: ended };
  if (!r.legacy) {
    updateMeta(fl.meta, m => { Object.assign(m.runs[m.runs.length - 1], forced); });
  } else {
    updateMeta(fl.meta, m => { m.stopped_by_request = new Date().toISOString(); m.runs = [{ ...r, ...forced }]; });
  }
  releaseLock(fl, phase);
  for (const f of [r.stdin]) { if (f) { try { fs.unlinkSync(f); } catch { /* gone */ } } }
  return ok(`Stopped ${phase} in ${project} by force (${why}): ended ${ended} process${ended === 1 ? '' : 'es'} (the runner ${r.runner_pid}, Claude Code${r.claude_pid ? ` ${r.claude_pid}` : ''} and what it started). The lock is released; docs\\${phase}_run.json records it as stopped by request.` +
    `${left.length ? ` Still running: ${left.join(', ')} (end them in Task Manager).` : ''} A turn it was in the middle of records no result, and no automatic handoff is written; claudedev_phase_reply can continue the session.`);
}

// ---------------------------------------------------------------------------
// The runner: node cds-phase.js --run <docs\<phase>_run.json> <run index>
// ---------------------------------------------------------------------------

// How a run ended, for the tray's notification and the Dashboard (from P9): 'finished', 'question'
// (its result or last text asks something), 'error', 'no_result', or for a manual run 'closed'.
export function runOutcome(meta, run) {
  const fl = files(meta.project, meta.phase);
  const manual = meta.mode === 'manual';
  const t = manual ? findTranscript(meta.session_id) : null;
  const s = parseLog(manual ? (t ? readShared(t, 0) : '') : readShared(fl.log, run.log_offset || 0));
  const finalText = String(s.result ? s.result.result || '' : s.texts[s.texts.length - 1] || '').trim();
  const pq = parseQuestion(finalText);
  const question = pq ? pq.question : (looksLikeQuestion(finalText) ? oneLine(finalText.split(/\n/).filter(Boolean).pop(), 300) : null);
  let outcome;
  if (manual) outcome = 'closed';
  else if (!s.result) outcome = 'no_result';
  else if (s.result.is_error) outcome = 'error';
  else outcome = question ? 'question' : 'finished';
  return { outcome, ...(question ? { question: oneLine(question, 300) } : {}), output_written: fs.existsSync(fl.output) };
}

async function runner(metaFile, index, shareConsole, manual) {
  // Stop's Ctrl+C reaches every process on this console, the runner too: it waits for Claude Code
  // to end instead (Node would otherwise exit at once and record nothing).
  for (const sig of ['SIGINT', 'SIGBREAK']) process.on(sig, () => { /* Claude Code handles it; we wait for its exit */ });
  const meta = readJson(metaFile);
  if (!meta || !meta.runs || !meta.runs[index]) process.exit(2);
  const fl = files(meta.project, meta.phase);
  const runEntry = meta.runs[index];
  const started = new Date().toISOString();
  // A manual session is the user's own Claude Code: their environment as it is, no phase settings.
  const env = manual ? cleanEnv() : phaseEnv();
  const runEnv = manual ? {} : Object.fromEntries(Object.keys(PHASE_ENV).map(k => [k, env[k]]));
  updateMeta(metaFile, m => { Object.assign(m.runs[index], { runner_pid: process.pid, runner_started: started, shares_console: !!(shareConsole || manual), env: runEnv }); m.pid = process.pid; });
  try { const l = readJson(fl.lock); if (l && l.phase === meta.phase) { l.runner_pid = process.pid; l.started = started; writeJson(fl.lock, l); } } catch { /* best effort */ }

  const finish = (fields) => {
    let outcome = {};
    try { const m = readJson(metaFile); if (m && !m.runs[index].stopped_by_request) outcome = runOutcome(m, m.runs[index]); } catch { /* best effort */ }
    try { updateMeta(metaFile, m => { Object.assign(m.runs[index], { ended: new Date().toISOString(), ...fields, ...(m.runs[index].stopped_by_request ? {} : outcome) }); }); } catch { /* best effort */ }
    releaseLock(fl, meta.phase, process.pid);
    if (runEntry.stdin) { try { fs.unlinkSync(runEntry.stdin); } catch { /* gone */ } }
  };

  if (manual) {
    // The window: Claude Code interactive on this console (stdio inherited), the user at the keyboard.
    try { process.title = `CDS ${meta.phase} - ${path.basename(meta.project)} (Claude Code)`; } catch { /* cosmetic */ }
    const [mfile, ...margs] = runEntry.command;
    let mchild;
    try { mchild = spawn(mfile, margs, { cwd: meta.project, stdio: 'inherit', env }); }
    catch (e) { finish({ error: e.message }); process.exit(1); }
    mchild.on('error', (e) => { finish({ error: e.message }); console.log(`\nClaude Code didn't start: ${e.message}`); setTimeout(() => process.exit(1), 15000); });
    if (mchild.pid) updateMeta(metaFile, m => { m.runs[index].claude_pid = mchild.pid; });
    mchild.on('exit', (code, signal) => {
      finish({ exit_code: code, ...(signal ? { signal } : {}) });
      console.log(`\nClaude Code has ended (exit code ${code}). ClaudeDevStudio released ${meta.phase}'s lock. Open the session again with: claude --resume ${meta.session_id}\nThis window closes in 10 seconds.`);
      setTimeout(() => process.exit(0), 10000);
    });
    return;
  }
  let out, err, inp = 'ignore';
  try {
    out = fs.openSync(fl.log, 'a');
    err = fs.openSync(fl.err, 'a');
    if (runEntry.stdin) inp = fs.openSync(runEntry.stdin, 'r');
  } catch (e) { finish({ error: `couldn't open the log: ${e.message}` }); process.exit(1); }
  const [file, ...args] = runEntry.command;
  let child;
  try {
    // windowsHide would give Claude Code a windowless console of its own, out of Ctrl+C's reach;
    // with --console it shares this one (hidden by WMI), so no window appears either way.
    child = spawn(file, args, { cwd: meta.project, stdio: [inp, out, err], windowsHide: !shareConsole, env });
  } catch (e) { finish({ error: e.message }); process.exit(1); }
  child.on('error', (e) => { finish({ error: e.message }); process.exit(1); });
  if (child.pid) updateMeta(metaFile, m => { m.runs[index].claude_pid = child.pid; });
  child.on('exit', (code, signal) => { finish({ exit_code: code, ...(signal ? { signal } : {}) }); process.exit(0); });
}

const argv = process.argv.slice(2);
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase();
if (isMain && argv[0] === '--run') {
  runner(path.resolve(argv[1]), Number(argv[2] || 0), argv.includes('--console'), argv.includes('--manual')).catch(() => process.exit(1));
} else if (isMain && ['--status', '--stop', '--conversation'].includes(argv[0])) {
  // The Dashboard's Phases page (and anyone at a terminal): the same text the tools return.
  (async () => {
    if (argv[0] === '--conversation') {
      const fi = argv.indexOf('--from');
      const conv = conversation(readShared(path.resolve(argv[1] || ''), fi > 0 ? Number(argv[fi + 1]) || 0 : 0));
      process.stdout.write(argv.includes('--json') ? JSON.stringify(conv) : `${conversationText(conv)}\n`);
      return 0;
    }
    const a = { project_path: argv[1], phase: argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined, force: argv.includes('--force') };
    const r = argv[0] === '--status' ? await phaseStatus(a) : await phaseStop(a);
    process.stdout.write(`${r.text}\n`);
    return r.ok ? 0 : 1;
  })().then(c => { process.exitCode = c; }, (e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 1; });
}
