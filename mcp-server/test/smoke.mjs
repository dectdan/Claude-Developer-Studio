// Smoke test for the claudedevstudio MCP server (index.js), driven over stdio the way
// Claude Desktop drives it. Uses the installed claudedev.exe and a throwaway project
// folder in %TEMP%; removes that project's memory folder at the end.
//
//   node mcp-server\test\smoke.mjs                 (tests mcp-server\index.js beside it)
//   node mcp-server\test\smoke.mjs <path\index.js> (tests another copy, e.g. the installed one)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, '..', 'index.js');
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

const client = new Client({ name: 'cds-smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));
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
} catch (e) {
  check('no exception', false, e.stack || e.message);
} finally {
  await client.close().catch(() => {});
  try { fs.rmSync(memDir, { recursive: true, force: true }); } catch { /* leave it */ }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* leave it */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
