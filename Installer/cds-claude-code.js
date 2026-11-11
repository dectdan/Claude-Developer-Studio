// cds-claude-code.js -- sets ClaudeDevStudio up for Claude Code, or takes it out again. Opt-in:
// nothing runs this unless the user asks (claudedev claude-code setup, the tray app's "Set up
// Claude Code...", or the installer's unticked finish-page box / the /CLAUDECODE=1 switch).
//
//   node cds-claude-code.js setup  --node <node.exe> --mcp <...\ClaudeDevStudio\mcp-server> [options]
//   node cds-claude-code.js remove [options]
//   node cds-claude-code.js status --node <node.exe> --mcp <dir> [options]
//
//   options: --settings <file>     Claude Code's user settings (default ~/.claude/settings.json)
//            --claude-json <file>  Claude Code's own config, which holds user-scope MCP servers
//                                  (default ~/.claude.json)
//            --claude <claude.exe> | --no-claude-cli
//            --if-set-up           setup only if CDS's hooks are already there (installer
//                                  upgrades: refreshes the paths, never turns it on)
//            --log <file>
//   (CLAUDE_CONFIG_DIR, if set, moves both files, as it does for Claude Code.)
//
// What setup changes (and remove takes out, leaving the rest exactly as it was):
// 1. The two CDS MCP servers, "claudedevstudio" and "cds-workbench", at user scope. Claude Code's
//    docs recommend `claude mcp add --scope user`; that is used when claude.exe is on PATH (and the
//    default config file is in use). Otherwise ~/.claude.json's top-level "mcpServers" is edited.
// 2. Four hooks in settings.json's "hooks", each command node.exe with mcp-server\cds-hook.js
//    (that file name is the mark: remove takes out only hook entries that run cds-hook.js):
//      SessionStart (startup|clear|compact)  session-start  timeout 15 s
//      PreCompact   (manual|auto)            pre-compact    async
//      SessionEnd                            session-end    timeout 5 s (raises the 1.5 s budget)
//      PostToolUse  (Edit|Write|MultiEdit|NotebookEdit)  post-tool-use  async
//
// The user's files get the cds-config.js treatment: everything that isn't CDS's is kept; the file
// is backed up first (<file>.bak-cds-YYYYMMDD-HHMMSS); written to a temp file and renamed; UTF-8
// without BOM, in the file's own indentation and line endings; a file that isn't valid JSON is left
// untouched (exit 2) and nothing is changed in either file. Running setup twice changes nothing.
//
// Exit codes: 0 done (or nothing to do), 1 error, 2 a file isn't valid JSON (nothing changed).

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SERVERS = ['claudedevstudio', 'cds-workbench'];
const HOOK_MARK = 'cds-hook.js';
const HOOKS = [
  { event: 'SessionStart', matcher: 'startup|clear|compact', arg: 'session-start', extra: { timeout: 15 } },
  { event: 'PreCompact', matcher: 'manual|auto', arg: 'pre-compact', extra: { async: true } },
  { event: 'SessionEnd', matcher: null, arg: 'session-end', extra: { timeout: 5 } },
  { event: 'PostToolUse', matcher: 'Edit|Write|MultiEdit|NotebookEdit', arg: 'post-tool-use', extra: { async: true } },
];

function parseArgs(argv) {
  const out = { action: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-claude-cli') out.noClaudeCli = true;
    else if (a === '--if-set-up') out['if-set-up'] = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

let logFile = null;
function say(msg) {
  console.log(msg);
  if (!logFile) return;
  try { fs.appendFileSync(logFile, `${localTime()}  ${msg}\r\n`, 'utf8'); } catch { /* best effort */ }
}
const pad = (n) => String(n).padStart(2, '0');
const localTime = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// ---------------------------------------------------------------------------
// Files: read keeping the file's style; write atomically in the same style
// ---------------------------------------------------------------------------

// { exists, data, style } or { exists, invalid }. An empty file counts as {}.
function readJson(file) {
  if (!fs.existsSync(file)) return { exists: false, data: {}, style: { indent: 2, eol: '\n', finalNewline: true } };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { exists: true, invalid: `could not be read (${e.message})` }; }
  raw = raw.replace(/^﻿/, '');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const m = /^[{[]\r?\n([ \t]+)\S/.exec(raw);
  if (!raw.trim()) return { exists: true, data: {}, style: { indent: 2, eol: '\n', finalNewline: true } };
  let data;
  try { data = JSON.parse(raw); } catch (e) { return { exists: true, invalid: `is not valid JSON (${e.message})` }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { exists: true, invalid: 'is valid JSON but not an object' };
  // The file's own indentation; a one-line file stays one line, except "{}" (nothing to keep).
  const oneLine = !raw.trim().includes('\n') && Object.keys(data).length > 0;
  const style = { indent: m ? m[1] : (oneLine ? 0 : 2), eol, finalNewline: /\r?\n$/.test(raw) };
  return { exists: true, data, style };
}

function render(data, style) {
  let s = JSON.stringify(data, null, style.indent || undefined);
  if (style.eol === '\r\n') s = s.replace(/\n/g, '\r\n');
  return s + (style.finalNewline ? style.eol : '');
}

function backup(file) {
  let dest = `${file}.bak-cds-${stamp()}`;
  for (let i = 2; fs.existsSync(dest); i++) dest = `${file}.bak-cds-${stamp()}-${i}`;
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  say(`  Backup: ${dest}`);
  return dest;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-cds-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, Buffer.from(text, 'utf8')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* leave it */ } throw e; }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------
// The hooks in settings.json
// ---------------------------------------------------------------------------

const isCdsHandler = (h) => isObj(h) && [h.command, ...(Array.isArray(h.args) ? h.args : [])]
  .some(x => typeof x === 'string' && x.toLowerCase().includes(HOOK_MARK));

function hookShapeProblem(settings) {
  if (settings.hooks === undefined) return null;
  if (!isObj(settings.hooks)) return 'has a "hooks" value that is not an object';
  for (const [ev, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) return `has a "hooks.${ev}" value that is not a list`;
  }
  return null;
}

// settings with every CDS handler taken out (groups and events left empty by that are dropped).
// Returns { settings, at } where at[event] is the index the first CDS group had.
function withoutCds(settings) {
  const s = JSON.parse(JSON.stringify(settings));
  const at = {};
  if (!isObj(s.hooks)) return { settings: s, at };
  for (const ev of Object.keys(s.hooks)) {
    const groups = s.hooks[ev];
    const kept = [];
    groups.forEach((g) => {
      if (!isObj(g) || !Array.isArray(g.hooks) || !g.hooks.some(isCdsHandler)) { kept.push(g); return; }
      if (at[ev] === undefined) at[ev] = kept.length;
      const rest = g.hooks.filter(h => !isCdsHandler(h));
      if (rest.length) kept.push({ ...g, hooks: rest });
    });
    if (kept.length) s.hooks[ev] = kept; else delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return { settings: s, at };
}

function cdsGroup(spec, nodeExe, hookJs) {
  const g = {};
  if (spec.matcher) g.matcher = spec.matcher;
  g.hooks = [{ type: 'command', command: nodeExe, args: [hookJs, spec.arg], ...spec.extra }];
  return g;
}

function withCds(settings, nodeExe, hookJs) {
  const { settings: s, at } = withoutCds(settings);
  if (!isObj(s.hooks)) s.hooks = {};
  for (const spec of HOOKS) {
    const list = Array.isArray(s.hooks[spec.event]) ? s.hooks[spec.event] : (s.hooks[spec.event] = []);
    const i = at[spec.event] === undefined ? list.length : Math.min(at[spec.event], list.length);
    list.splice(i, 0, cdsGroup(spec, nodeExe, hookJs));
  }
  return s;
}

function cdsHooksIn(settings) {
  const found = [];
  if (!isObj(settings.hooks)) return found;
  for (const [ev, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) if (isObj(g) && Array.isArray(g.hooks)) for (const h of g.hooks) if (isCdsHandler(h)) found.push({ event: ev, handler: h, matcher: g.matcher });
  }
  return found;
}

// ---------------------------------------------------------------------------
// The MCP servers (user scope)
// ---------------------------------------------------------------------------

const serverEntry = (nodeExe, file) => ({ type: 'stdio', command: nodeExe, args: [file], env: {} });
const sameServer = (a, b) => isObj(a) && a.command === b.command && JSON.stringify(a.args || []) === JSON.stringify(b.args);

function findClaudeExe() {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir.replace(/^"|"$/g, ''), 'claude.exe');
    try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
  }
  return null;
}

function runClaude(claudeExe, args) {
  try {
    const out = execFileSync(claudeExe, args, { encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: `${(e.stdout || '').toString()}${(e.stderr || '').toString()}`.trim() || e.message };
  }
}

// ---------------------------------------------------------------------------

function paths(opts) {
  const configDir = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  const defaultClaudeJson = process.env.CLAUDE_CONFIG_DIR ? path.join(configDir, '.claude.json') : path.join(os.homedir(), '.claude.json');
  const settingsFile = path.resolve(opts.settings || path.join(configDir, 'settings.json'));
  const claudeJson = path.resolve(opts['claude-json'] || defaultClaudeJson);
  // The claude CLI writes its own config file, so it is used only when that is the file in question.
  let claudeExe = null;
  if (!opts.noClaudeCli && path.resolve(defaultClaudeJson).toLowerCase() === claudeJson.toLowerCase()) {
    claudeExe = opts.claude ? path.resolve(opts.claude) : findClaudeExe();
    if (claudeExe && !fs.existsSync(claudeExe)) claudeExe = null;
  }
  return { settingsFile, claudeJson, claudeExe };
}

function wanted(opts) {
  const nodeExe = opts.node;
  if (!nodeExe || !path.isAbsolute(nodeExe)) throw new Error('--node must be the full path to node.exe');
  if (!opts.mcp) throw new Error('--mcp must be the mcp-server folder');
  const mcp = path.resolve(opts.mcp);
  return {
    nodeExe, hookJs: path.join(mcp, HOOK_MARK),
    servers: { 'claudedevstudio': serverEntry(nodeExe, path.join(mcp, 'index.js')), 'cds-workbench': serverEntry(nodeExe, path.join(mcp, 'workbench.js')) },
  };
}

// Reads both files first; if either isn't usable, nothing is changed.
function readBoth(p) {
  const settings = readJson(p.settingsFile);
  const claude = readJson(p.claudeJson);
  const problems = [];
  if (settings.invalid) problems.push(`${p.settingsFile} ${settings.invalid}`);
  else { const hp = hookShapeProblem(settings.data); if (hp) problems.push(`${p.settingsFile} ${hp}`); }
  if (claude.invalid) problems.push(`${p.claudeJson} ${claude.invalid}`);
  else if (claude.data.mcpServers !== undefined && !isObj(claude.data.mcpServers)) problems.push(`${p.claudeJson} has an "mcpServers" value that is not an object`);
  return { settings, claude, problems };
}

function saveIfChanged(file, before, after, style, exists) {
  const text = render(after, style);
  if (exists && JSON.stringify(before) === JSON.stringify(after)) return false;
  if (exists) backup(file);
  writeAtomic(file, text);
  return true;
}

function setup(opts) {
  const p = paths(opts);
  const w = wanted(opts);
  say('ClaudeDevStudio: setting up Claude Code');
  if (!fs.existsSync(w.hookJs)) say(`  Note: ${w.hookJs} is missing; the hooks will log nothing and do nothing until it is there.`);
  const { settings, claude, problems } = readBoth(p);
  if (problems.length) { for (const x of problems) say(`  NOT CHANGED: ${x}. Fix it, then run setup again.`); return 2; }
  const current = isObj(claude.data.mcpServers) ? claude.data.mcpServers : {};

  // --if-set-up (the installer, on every install): refresh the paths only for a user who already
  // turned this on; never turn it on.
  if (opts['if-set-up'] !== undefined && !cdsHooksIn(settings.data).length) {
    say('  Not set up for Claude Code (no CDS hooks): nothing changed.');
    return 0;
  }

  // 1. MCP servers
  const todo = SERVERS.filter(n => !sameServer(current[n], w.servers[n]));
  if (!todo.length) {
    say(`  MCP servers: ${SERVERS.join(' and ')} already registered (user scope); ${p.claudeJson} not changed.`);
  } else if (p.claudeExe) {
    if (claude.exists) backup(p.claudeJson);
    for (const n of todo) {
      if (current[n] !== undefined) {
        const rm = runClaude(p.claudeExe, ['mcp', 'remove', n, '--scope', 'user']);
        if (!rm.ok) { say(`  ERROR: claude mcp remove ${n} failed: ${rm.out}`); return 1; }
      }
      const add = runClaude(p.claudeExe, ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', n, '--', w.servers[n].command, ...w.servers[n].args]);
      if (!add.ok) { say(`  ERROR: claude mcp add ${n} failed: ${add.out}`); return 1; }
    }
    const check = readJson(p.claudeJson);
    const ok = !check.invalid && isObj(check.data.mcpServers) && SERVERS.every(n => sameServer(check.data.mcpServers[n], w.servers[n]));
    if (!ok) { say(`  ERROR: claude mcp add ran, but ${p.claudeJson} doesn't show both servers.`); return 1; }
    say(`  MCP servers: added ${todo.join(' and ')} with claude mcp add --scope user (${p.claudeExe}).`);
  } else {
    const after = JSON.parse(JSON.stringify(claude.data));
    if (!isObj(after.mcpServers)) after.mcpServers = {};
    for (const n of SERVERS) after.mcpServers[n] = w.servers[n]; // an existing key keeps its place
    saveIfChanged(p.claudeJson, claude.data, after, claude.style, claude.exists);
    const others = Object.keys(after.mcpServers).filter(k => !SERVERS.includes(k));
    say(`  MCP servers: wrote ${todo.join(' and ')} to ${p.claudeJson} (user scope; claude.exe not on PATH). Kept ${others.length} other server(s)${others.length ? `: ${others.join(', ')}` : ''}.`);
  }

  // 2. Hooks
  const nextSettings = withCds(settings.data, w.nodeExe, w.hookJs);
  if (saveIfChanged(p.settingsFile, settings.data, nextSettings, settings.style, settings.exists)) {
    say(`  Hooks: ${HOOKS.map(h => h.event).join(', ')} written to ${p.settingsFile} (each runs ${w.hookJs}).`);
  } else {
    say(`  Hooks: already set up; ${p.settingsFile} not changed.`);
  }
  if (settings.data.disableAllHooks === true) say('  Note: this settings file has "disableAllHooks": true, so Claude Code runs no hooks until that is removed.');
  say('  Done. New Claude Code sessions load the project\'s memory at the start. Undo with: claudedev claude-code remove');
  return 0;
}

function remove(opts) {
  const p = paths(opts);
  say('ClaudeDevStudio: removing its Claude Code setup');
  const { settings, claude, problems } = readBoth(p);
  if (problems.length) {
    for (const x of problems) say(`  NOT CHANGED: ${x}. Remove CDS's entries by hand (the ${SERVERS.join(' and ')} servers; hooks that run ${HOOK_MARK}).`);
    return 2;
  }

  const current = isObj(claude.data.mcpServers) ? claude.data.mcpServers : {};
  const present = SERVERS.filter(n => Object.prototype.hasOwnProperty.call(current, n));
  if (!present.length) {
    say(`  MCP servers: none of CDS's registered; ${p.claudeJson} not changed.`);
  } else if (p.claudeExe) {
    backup(p.claudeJson);
    for (const n of present) {
      const rm = runClaude(p.claudeExe, ['mcp', 'remove', n, '--scope', 'user']);
      if (!rm.ok) { say(`  ERROR: claude mcp remove ${n} failed: ${rm.out}`); return 1; }
    }
    say(`  MCP servers: removed ${present.join(' and ')} with claude mcp remove --scope user.`);
  } else {
    const after = JSON.parse(JSON.stringify(claude.data));
    for (const n of present) delete after.mcpServers[n];
    if (!Object.keys(after.mcpServers).length) delete after.mcpServers;
    saveIfChanged(p.claudeJson, claude.data, after, claude.style, true);
    say(`  MCP servers: removed ${present.join(' and ')} from ${p.claudeJson}.`);
  }

  if (!cdsHooksIn(settings.data).length) {
    say(`  Hooks: none of CDS's found; ${p.settingsFile} not changed.`);
  } else {
    saveIfChanged(p.settingsFile, settings.data, withoutCds(settings.data).settings, settings.style, true);
    say(`  Hooks: removed CDS's from ${p.settingsFile}; everything else kept.`);
  }
  return 0;
}

function status(opts) {
  const p = paths(opts);
  say('ClaudeDevStudio and Claude Code:');
  const { settings, claude, problems } = readBoth(p);
  for (const x of problems) say(`  Problem: ${x}.`);
  let w = null;
  try { w = wanted(opts); } catch { /* status without --node/--mcp: presence only */ }
  if (!claude.invalid) {
    const cur = isObj(claude.data.mcpServers) ? claude.data.mcpServers : {};
    for (const n of SERVERS) {
      const st = cur[n] === undefined ? 'not registered' : (!w || sameServer(cur[n], w.servers[n]) ? 'registered (user scope)' : 'registered, but pointing elsewhere (run setup to update)');
      say(`  MCP server ${n}: ${st}`);
    }
  }
  if (!settings.invalid) {
    const found = cdsHooksIn(settings.data);
    for (const spec of HOOKS) {
      const f = found.find(x => x.event === spec.event);
      say(`  Hook ${spec.event}: ${f ? 'set up' : 'not set up'}`);
    }
    if (settings.data.disableAllHooks === true) say('  Note: "disableAllHooks": true in the settings file: no hooks run.');
  }
  say(`  Files: ${p.settingsFile}; ${p.claudeJson}`);
  if (w && !fs.existsSync(w.hookJs)) say(`  Missing: ${w.hookJs}`);
  return problems.length ? 2 : 0;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.log) logFile = path.resolve(opts.log);
  if (!['setup', 'remove', 'status'].includes(opts.action) || (opts.action === 'setup' && (!opts.node || !opts.mcp))) {
    console.error('usage: node cds-claude-code.js setup --node <node.exe> --mcp <mcp-server dir> [--settings <file>] [--claude-json <file>] [--no-claude-cli] [--log <file>]');
    console.error('       node cds-claude-code.js remove|status [the same options]');
    return 1;
  }
  try {
    if (opts.action === 'setup') return setup(opts);
    if (opts.action === 'remove') return remove(opts);
    return status(opts);
  } catch (e) {
    say(`  ERROR: ${e.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { setup, remove, status, withCds, withoutCds, readJson, render, HOOKS, SERVERS };
