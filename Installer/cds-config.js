// cds-config.js -- adds or removes ClaudeDevStudio's two entries in Claude Desktop's
// claude_desktop_config.json, and keeps everything else in the file exactly as it is.
//
// Run by the installer and the uninstaller with the Node.js the installer installs:
//
//   node cds-config.js install   --config <claude_desktop_config.json> --node <node.exe>
//                                --mcp <...\ClaudeDevStudio\mcp-server> [--log <file>] [--manual <file>]
//   node cds-config.js uninstall --config <claude_desktop_config.json> [--log <file>]
//
// Rules (docs\GROUND_TRUTH.md section 7, item 14):
// - every other mcpServers entry and every other top-level key is kept;
// - only "claudedevstudio" and "cds-workbench" are added, replaced or removed;
// - the existing file is backed up first (<file>.bak-cds-YYYYMMDD-HHMMSS beside it);
// - the new file is written to a temp file, then renamed over the old one; UTF-8, no BOM;
// - a file that isn't valid JSON is left untouched (exit code 2) and the entries to add
//   by hand are written to --manual.
//
// It also removes the Claude Extensions registration that CDS v1.1.x used, with the same
// rules for extensions-installations.json.
//
// Exit codes: 0 done (or nothing to do), 1 error, 2 a file wasn't valid JSON (left untouched).

'use strict';
const fs = require('fs');
const path = require('path');

const CDS_SERVERS = ['claudedevstudio', 'cds-workbench'];
const LEGACY_EXTENSION_ID = 'ant.dir.gh.dectdan.claudedevstudio';

function parseArgs(argv) {
  const out = { action: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

let logFile = null;
function log(msg) {
  console.log(msg);
  if (!logFile) return;
  try { fs.appendFileSync(logFile, `${localTime()}  ${msg}\r\n`, 'utf8'); } catch { /* logging is best effort */ }
}

const pad = (n) => String(n).padStart(2, '0');
// Local time, like the installer's PowerShell steps that share the log.
function localTime(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Reads a JSON object file. Returns { exists, data } or { exists, invalid: reason }.
// An empty file holds nothing to keep, so it counts as {}.
function readJsonObject(file) {
  if (!fs.existsSync(file)) return { exists: false, data: {} };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { exists: true, invalid: `could not be read (${e.message})` }; }
  raw = raw.replace(/^\uFEFF/, '');
  if (!raw.trim()) return { exists: true, data: {} };
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { exists: true, invalid: `is not valid JSON (${e.message})` }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { exists: true, invalid: 'is valid JSON but not an object' };
  }
  return { exists: true, data };
}

function backup(file) {
  let dest = `${file}.bak-cds-${stamp()}`;
  for (let i = 2; fs.existsSync(dest); i++) dest = `${file}.bak-cds-${stamp()}-${i}`;
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  log(`  Backup: ${dest}`);
  return dest;
}

// Temp file, flushed, then renamed over the target. UTF-8 without BOM.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-cds-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8'));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* leave it */ }
    throw e;
  }
}

function cdsEntries(nodeExe, mcpDir) {
  return {
    'claudedevstudio': { command: nodeExe, args: [path.join(mcpDir, 'index.js')] },
    'cds-workbench': { command: nodeExe, args: [path.join(mcpDir, 'workbench.js')] },
  };
}

function writeManual(manualFile, configFile, entries, reason) {
  const text = [
    'ClaudeDevStudio could not add itself to Claude Desktop.',
    '',
    `${configFile} ${reason}, so the installer left it unchanged.`,
    'Fix the file, or add these two entries inside its "mcpServers" object by hand,',
    'then quit Claude Desktop fully and reopen it:',
    '',
    JSON.stringify(entries, null, 2).replace(/^\{\n|\n\}$/g, ''),
    '',
  ].join('\r\n');
  if (!manualFile) return;
  try {
    fs.mkdirSync(path.dirname(manualFile), { recursive: true });
    fs.writeFileSync(manualFile, text, 'utf8');
    log(`  Manual steps written to ${manualFile}`);
  } catch (e) { log(`  Could not write ${manualFile}: ${e.message}`); }
}

function install(opts) {
  const configFile = path.resolve(opts.config);
  const nodeExe = opts.node;
  const mcpDir = path.resolve(opts.mcp);
  if (!nodeExe || !path.isAbsolute(nodeExe)) throw new Error('--node must be the full path to node.exe');
  const entries = cdsEntries(nodeExe, mcpDir);

  log(`ClaudeDevStudio: adding its servers to ${configFile}`);
  const r = readJsonObject(configFile);
  if (r.invalid) {
    log(`  NOT CHANGED: the file ${r.invalid}.`);
    writeManual(opts.manual, configFile, entries, r.invalid);
    return 2;
  }
  const config = r.data;
  if (config.mcpServers !== undefined &&
      (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) {
    const reason = 'has an "mcpServers" value that is not an object';
    log(`  NOT CHANGED: the file ${reason}.`);
    writeManual(opts.manual, configFile, entries, reason);
    return 2;
  }
  if (!config.mcpServers) config.mcpServers = {};

  const before = JSON.stringify(config.mcpServers);
  // Assigning an existing key keeps its place; a new key goes last.
  for (const [name, entry] of Object.entries(entries)) config.mcpServers[name] = entry;
  const others = Object.keys(config.mcpServers).filter(k => !CDS_SERVERS.includes(k));

  if (r.exists && JSON.stringify(config.mcpServers) === before) {
    log('  Already up to date; file not rewritten.');
  } else {
    if (r.exists) backup(configFile);
    writeJsonAtomic(configFile, config);
    log(`  Wrote ${CDS_SERVERS.join(' and ')} (node: ${nodeExe}).`);
  }
  log(`  Kept ${others.length} other server(s)${others.length ? `: ${others.join(', ')}` : ''}; other top-level keys: ${Object.keys(config).filter(k => k !== 'mcpServers').join(', ') || 'none'}.`);
  return 0;
}

function uninstall(opts) {
  const configFile = path.resolve(opts.config);
  log(`ClaudeDevStudio: removing its servers from ${configFile}`);
  const r = readJsonObject(configFile);
  if (!r.exists) { log('  No config file; nothing to remove.'); return 0; }
  if (r.invalid) {
    log(`  NOT CHANGED: the file ${r.invalid}. Remove "${CDS_SERVERS.join('" and "')}" from it by hand.`);
    return 2;
  }
  const servers = r.data.mcpServers;
  const present = servers && typeof servers === 'object' && !Array.isArray(servers)
    ? CDS_SERVERS.filter(k => Object.prototype.hasOwnProperty.call(servers, k)) : [];
  if (!present.length) { log('  No ClaudeDevStudio entries; file not changed.'); return 0; }
  backup(configFile);
  for (const k of present) delete servers[k];
  writeJsonAtomic(configFile, r.data);
  log(`  Removed ${present.join(' and ')}; kept ${Object.keys(servers).length} other server(s).`);
  return 0;
}

// CDS v1.1.x registered itself through Claude Extensions. Remove that registration only.
function removeLegacyExtension(claudeDir) {
  let code = 0;
  const extDir = path.join(claudeDir, 'Claude Extensions', LEGACY_EXTENSION_ID);
  const extSettings = path.join(claudeDir, 'Claude Extensions Settings', `${LEGACY_EXTENSION_ID}.json`);
  const installs = path.join(claudeDir, 'extensions-installations.json');
  try {
    if (fs.existsSync(extDir)) { fs.rmSync(extDir, { recursive: true, force: true }); log(`  Removed old extension folder ${extDir}`); }
    if (fs.existsSync(extSettings)) { fs.rmSync(extSettings, { force: true }); log(`  Removed ${extSettings}`); }
  } catch (e) { log(`  Could not remove the old extension files: ${e.message}`); code = 1; }

  const r = readJsonObject(installs);
  if (!r.exists) return code;
  if (r.invalid) { log(`  ${installs} ${r.invalid}; left unchanged.`); return code; }
  const ext = r.data.extensions;
  if (ext && typeof ext === 'object' && Object.prototype.hasOwnProperty.call(ext, LEGACY_EXTENSION_ID)) {
    try {
      backup(installs);
      delete ext[LEGACY_EXTENSION_ID];
      writeJsonAtomic(installs, r.data);
      log(`  Removed the old extension registration from ${installs}`);
    } catch (e) { log(`  Could not update ${installs}: ${e.message}`); code = 1; }
  }
  return code;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.log) logFile = path.resolve(opts.log);
  if (!opts.config || !['install', 'uninstall'].includes(opts.action) ||
      (opts.action === 'install' && (!opts.node || !opts.mcp))) {
    console.error('usage: node cds-config.js install --config <file> --node <node.exe> --mcp <mcp-server dir> [--log <file>] [--manual <file>]');
    console.error('       node cds-config.js uninstall --config <file> [--log <file>]');
    return 1;
  }
  try {
    const code = opts.action === 'install' ? install(opts) : uninstall(opts);
    removeLegacyExtension(path.dirname(path.resolve(opts.config)));
    return code;
  } catch (e) {
    log(`  ERROR: ${e.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { install, uninstall, readJsonObject, CDS_SERVERS };
