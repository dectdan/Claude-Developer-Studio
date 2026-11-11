// Smoke test for the claudedevstudio MCP server (index.js), driven over stdio the way
// Claude Desktop drives it. Uses claudedev.exe (the installed one unless --cli is given)
// and a throwaway project folder in %TEMP%; removes that project's memory folder at the end.
//
//   node mcp-server\test\smoke.mjs                 (tests mcp-server\index.js beside it)
//   node mcp-server\test\smoke.mjs <path\index.js> (tests another copy, e.g. the installed one)
//   node mcp-server\test\smoke.mjs --cli bin\Release\net8.0\claudedev.exe
//        (tests a freshly built CLI before it is installed: the server gets CDS_CLI_PATH,
//         and the CLI checks added in P1 run too)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let cliPath = null;
const cliAt = argv.indexOf('--cli');
if (cliAt >= 0) {
  if (!argv[cliAt + 1]) { console.error('--cli needs the path to claudedev.exe'); process.exit(2); }
  cliPath = path.resolve(argv[cliAt + 1]);
  argv.splice(cliAt, 2);
  if (!fs.existsSync(cliPath)) { console.error(`CLI not found: ${cliPath}`); process.exit(2); }
}
const serverPath = argv[0] ? path.resolve(argv[0]) : path.join(here, '..', 'index.js');
const scratchName = `_cds_smoketest_${Date.now()}`;
const scratch = path.join(os.tmpdir(), scratchName);
fs.mkdirSync(scratch, { recursive: true });

const docs = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"], { encoding: 'utf8' }).trim();
const memDir = path.join(docs, 'ClaudeDevStudio', 'Projects', scratchName);

let passed = 0, failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}${detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`); }
};

// The v1.2.x store (read-only for index.js). Used only when it differs from the real one.
const legacyDir = path.join(process.env.USERPROFILE || os.homedir(), 'Documents', 'ClaudeDevStudio', 'Projects', scratchName);
const legacyIsSeparate = path.resolve(legacyDir).toLowerCase() !== path.resolve(memDir).toLowerCase();
let createdLegacy = false; // only a folder this test made is removed

// Runs the CLI directly (not through MCP). Returns { code, out } with stdout as UTF-8.
const cli = (...args) => {
  const r = spawnSync(cliPath, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const readSession = () => JSON.parse(fs.readFileSync(path.join(memDir, 'session_state.json'), 'utf8').replace(/^﻿/, ''));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const client = new Client({ name: 'cds-smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [serverPath],
  ...(cliPath ? { env: { CDS_CLI_PATH: cliPath } } : {}),
}));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content?.[0]?.text ?? '', isError: !!r.isError };
};

try {
  const { tools } = await client.listTools();
  check('lists 9 tools', tools.length === 9, tools.map(t => t.name).join(', '));
  check('server sends instructions', /claudedev_load/.test(client.getInstructions() || ''));

  let r = await call('claudedev_load', { project_path: scratch + '\\' });
  check('load creates memory for a new project (trailing backslash ok)', !r.isError && /created just now/.test(r.text) && fs.existsSync(path.join(memDir, 'session_state.json')), r.text);
  check('memory is in the real Documents folder', r.text.includes(memDir), r.text);

  r = await call('claudedev_record_activity', { project_path: scratch, action: 'code_change', description: 'Edited "Main.cs" in C:\\Program Files\\x\nsecond line', file: 'src\\Main.cs' });
  check('record_activity succeeds', !r.isError, r.text);
  const actFiles = fs.existsSync(path.join(memDir, 'Activity')) ? fs.readdirSync(path.join(memDir, 'Activity')).filter(f => f.endsWith('.jsonl')) : [];
  check('activity written to Activity\\<date>.jsonl', actFiles.length === 1, actFiles.join(', '));

  r = await call('claudedev_record_activity', { project_path: scratch, action: 'build', description: 'Release build', outcome: 'failed' });
  check('record_activity with failed outcome', !r.isError, r.text);

  r = await call('claudedev_record_mistake', { project_path: scratch, mistake: 'Built the installer before rebuilding the source', impact: 'Shipped old binaries', fix: 'Rebuilt source, then installer', lesson: 'Always rebuild the source before building the installer', severity: 'high' });
  check('record_mistake succeeds', !r.isError && fs.existsSync(path.join(memDir, 'MISTAKES.jsonl')), r.text);

  r = await call('claudedev_check_mistake', { project_path: scratch, action_description: 'Build the installer now, then rebuild the source afterwards' });
  check('check_mistake warns on a similar plan', !r.isError && /resembles/.test(r.text), r.text);

  r = await call('claudedev_check_mistake', { project_path: scratch, action_description: 'Rename the settings page title' });
  check('check_mistake is quiet on an unrelated plan', !r.isError && /No recorded mistake/.test(r.text), r.text);

  r = await call('claudedev_load', { project_path: scratch });
  check('load shows the recorded work', !r.isError && /Main\.cs/.test(r.text) && /outcome: failed/.test(r.text) && /Built the installer/.test(r.text), r.text);

  r = await call('claudedev_stats', { project_path: scratch });
  check('stats runs', !r.isError, r.text);

  r = await call('claudedev_load', { project_path: path.join(scratch, 'does-not-exist') });
  check('missing project folder gives a clear error', r.isError && /not found/.test(r.text), r.text);

  r = await call('claudedev_record_activity', { project_path: scratch, action: 'x' });
  check('missing description is refused', r.isError, r.text);

  r = await call('claudedev_chat_checkpoint', { text: `smoke test ${scratchName}` });
  check('checkpoint saves', !r.isError, r.text);
  r = await call('claudedev_chat_resume', { hours: 1 });
  check('resume shows the checkpoint', !r.isError && r.text.includes(scratchName), r.text.slice(-400));

  // ---- Checks added in P1 (need the new CLI: --cli) ----
  if (cliPath) {
    console.log(`\n-- P1 checks (CLI: ${cliPath}) --`);

    r = await call('claudedev_record_mistake', { project_path: scratch, mistake: 'Edited the registry key without a backup', impact: 'Lost the previous value', fix: 'Restored it by hand', lesson: 'Export the registry key before editing it' });
    const ids = fs.readFileSync(path.join(memDir, 'MISTAKES.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l).id);
    check('two mistakes recorded get two different IDs', !r.isError && ids.length === 2 && new Set(ids).size === 2 && ids.every(id => /^ERR\d{3,}$/.test(id)), ids.join(', '));

    let c = cli('check', scratch, 'Build the installer now, then rebuild the source afterwards');
    check('CLI alone matches the similar plan', c.code === 1 && /Mistake ID: ERR\d+/.test(c.out) && /rebuild the source/i.test(c.out), c.out);
    c = cli('check', scratch, 'Rename the settings page title');
    check('CLI alone is quiet on the unrelated plan', c.code === 0 && /No prior mistakes/.test(c.out), c.out);
    check('CLI output has a real ✓ and no â', c.out.includes('✓') && !c.out.includes('â'), JSON.stringify(c.out));

    const before = readSession();
    await sleep(1100);
    c = cli('load', scratch);
    const first = readSession();
    await sleep(1100);
    const c2 = cli('load', scratch);
    const second = readSession();
    check('load twice updates session_state.json last activity',
      c.code === 0 && c2.code === 0 &&
      new Date(first.last_activity) > new Date(before.last_activity) &&
      new Date(second.last_activity) > new Date(first.last_activity) &&
      second.session_id === first.session_id,
      `before ${before.last_activity}, after 1st ${first.last_activity}, after 2nd ${second.last_activity}\n${c.out}\n${c2.out}`);

    // A load more than 8 hours after the last activity starts a new session.
    const stale = { ...second, session_id: '2020-01-01_00-00', last_activity: new Date(Date.now() - 9 * 3600 * 1000).toISOString() };
    fs.writeFileSync(path.join(memDir, 'session_state.json'), JSON.stringify(stale, null, 2), 'utf8');
    c = cli('load', scratch);
    const fresh = readSession();
    check('load after 8+ hours starts a new session ID', c.code === 0 && fresh.session_id !== stale.session_id && /^\d{4}-\d\d-\d\d_\d\d-\d\d$/.test(fresh.session_id) && c.out.includes(`Session: ${fresh.session_id}`), `${fresh.session_id}\n${c.out}`);

    // The "older entries were also read" note only when something shown came from the old store.
    if (legacyIsSeparate && !fs.existsSync(legacyDir)) {
      fs.mkdirSync(path.join(legacyDir, 'Activity'), { recursive: true });
      createdLegacy = true;
      r = await call('claudedev_load', { project_path: scratch });
      check('load: no "older entries" note when the old store adds nothing', !r.isError && !/older entries were also read/.test(r.text), r.text.slice(-400));
      fs.writeFileSync(path.join(legacyDir, 'Activity', '20990101_000000_activity.json'),
        JSON.stringify({ timestamp: new Date().toISOString(), action: 'legacy_test', description: `legacy entry ${scratchName}` }), 'utf8');
      r = await call('claudedev_load', { project_path: scratch });
      check('load: "older entries" note when an old-store entry is shown', !r.isError && /older entries were also read/.test(r.text) && r.text.includes(`legacy entry ${scratchName}`), r.text.slice(-400));
    } else {
      console.log('SKIP  "older entries" note checks (the old store is the same folder as the real one on this PC)');
    }
  } else {
    console.log('\n(P1 CLI checks skipped: run with --cli <path to a newly built claudedev.exe>)');
  }
} catch (e) {
  check('no exception', false, e.stack || e.message);
} finally {
  await client.close().catch(() => {});
  try { fs.rmSync(memDir, { recursive: true, force: true }); } catch { /* leave it */ }
  try { if (createdLegacy) fs.rmSync(legacyDir, { recursive: true, force: true }); } catch { /* leave it */ }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* leave it */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
