// Smoke test for the claudedevstudio MCP server (index.js), driven over stdio the way
// Claude Desktop drives it. Uses claudedev.exe (the installed one unless --cli is given)
// and a throwaway project folder in %TEMP%; removes that project's memory folder at the end.
//
//   node mcp-server\test\smoke.mjs                 (tests mcp-server\index.js beside it)
//   node mcp-server\test\smoke.mjs <path\index.js> (tests another copy, e.g. the installed one)
//   node mcp-server\test\smoke.mjs --cli bin\Release\net8.0\claudedev.exe
//        (tests a freshly built CLI before it is installed: the server gets CDS_CLI_PATH,
//         and the CLI checks added in P1 and P3 run too)
//
// P3 adds throwaway projects of its own (a hand-made ground truth, a big project for the size
// budget), all in %TEMP%; their memory folders are removed at the end too.
//
// P5 (search, lessons for every project) runs a second server with a throwaway memory root and old
// store in %TEMP% (CDS_MEMORY_ROOT, CDS_LEGACY_ROOT: test-only), so its checks never read or write
// the real store or the real LESSONS.jsonl. The lessons checks need --cli (the CLI must honour
// CDS_MEMORY_ROOT; an older one would write to the real store, so they are skipped without it).
//
// P6: the monitor's removal; the CLI's session state in the memory root with the old %APPDATA% file
// read once (a throwaway CDS_MEMORY_ROOT and APPDATA; --cli only); claudedev_vs_get_output's pane,
// against a workbench with no Visual Studio and then a fake VS Bridge on a spare port
// (CDS_VS_BRIDGE_PORT, test-only), so it never talks to a real Visual Studio.
//
// P7: the phase tools (claudedev_phase_start/status/reply/stop, cds-phase.js) against a fake
// Claude Code (fixtures\fake-claude.mjs, copied to %TEMP%; CDS_PHASE_CLAUDE, test-only) and
// throwaway projects in %TEMP%: the refusals, the lock (and a stale one), status while running
// and after, a question, the reply's --resume and flags, stop ending the fake and its child, a run
// started by run-phase.ps1; and (--cli) the automatic handoff listing only the project's files.
// P9: the three modes (collaborative default, delegated, manual) recorded and reported with their
// guidance; QUESTION: blocks returned verbatim (parseQuestion, and a non-question); the conversation
// formatter against fixtures\phase-log-sample.jsonl (module and --conversation); manual mode's command
// (interactive, --session-id, no acceptEdits/allowed tools) in a window opened hidden for the test
// (CDS_PHASE_WINDOW=hidden), its lock, its transcript in Status, Stop asking first and force; the
// "open it" hint; the run's outcome and phases.json; the "not signed in" refusal; cds-claude-code.js
// status's five states with a fake Claude Code.
// P8: Monitor in the default tools (run-phase.ps1's too), the run's environment (the idle ceiling and
// the foreground timeout ceiling, recorded in the .json; Claude Code sharing the runner's console),
// the gentle stop (Ctrl+C: the fake ends its turn, "runs SessionEnd", exits; what it left running is
// ended; status says so) and its fallback (a fake that ignores Ctrl+C: two presses, then by force).

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, spawnSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
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
// P10: with --cli (a CLI that honours CDS_MEMORY_ROOT) the whole run uses a throwaway memory root and old
// store in %TEMP%, so it writes nothing to the real store (before P10 the main checks made a throwaway
// project's memory folder there and removed it at the end; from 1.7.0 a load would also start the daily
// store backup there). The checks that the real store is untouched still read `docs`. Without --cli
// (an older installed CLI) the main checks use the real store as before.
const isolated = !!cliPath;
const storeRoot = isolated ? path.join(os.tmpdir(), `${scratchName}_root`) : path.join(docs, 'ClaudeDevStudio');
const isolatedLegacy = isolated ? path.join(os.tmpdir(), `${scratchName}_old`) : null;
if (isolated) {
  process.env.CDS_MEMORY_ROOT = storeRoot;
  process.env.CDS_LEGACY_ROOT = isolatedLegacy;
  process.env.CDS_AUTO_BACKUP = 'off'; // the P10 checks turn it on where they test it
}
const memDir = path.join(storeRoot, 'Projects', scratchName);

// More throwaway projects (P3): each is a folder in %TEMP% with a memory folder of the same name.
const extraProjects = [];
const makeProject = (suffix) => {
  const name = `${scratchName}_${suffix}`;
  const dir = path.join(os.tmpdir(), name);
  fs.mkdirSync(dir, { recursive: true });
  const mem = path.join(storeRoot, 'Projects', name);
  extraProjects.push({ dir, mem });
  return { dir, mem };
};
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, 'utf8'); };
const listTree = (root) => {
  const out = [];
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}\\${e.name}` : e.name; out.push(r); if (e.isDirectory()) walk(path.join(d, e.name), r); } };
  walk(root, '');
  return out.sort();
};
const TOOL_COUNT = 13; // 9 before P3 + claudedev_scaffold, claudedev_handoff, claudedev_record_decision (P3) + claudedev_search, claudedev_record_lesson (P5) - claudedev_monitor_start (P6)

let passed = 0, failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}${detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`); }
};

// The v1.2.x store (read-only for index.js). Used only when it differs from the real one.
const legacyDir = isolated
  ? path.join(isolatedLegacy, 'Projects', scratchName)
  : path.join(process.env.USERPROFILE || os.homedir(), 'Documents', 'ClaudeDevStudio', 'Projects', scratchName);
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
  ...(cliPath ? { env: { CDS_CLI_PATH: cliPath, CDS_MEMORY_ROOT: storeRoot, CDS_LEGACY_ROOT: isolatedLegacy, CDS_AUTO_BACKUP: 'off' } } : {}),
}));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content?.[0]?.text ?? '', isError: !!r.isError };
};

try {
  const { tools } = await client.listTools();
  check(`lists ${TOOL_COUNT} tools`, tools.length === TOOL_COUNT, tools.map(t => t.name).join(', '));
  check('server sends instructions', /claudedev_load/.test(client.getInstructions() || ''));
  check('the instructions mention claudedev_search and claudedev_record_lesson (P5)', /claudedev_search/.test(client.getInstructions() || '') && /claudedev_record_lesson/.test(client.getInstructions() || ''), client.getInstructions());

  let r = await call('claudedev_load', { project_path: scratch + '\\' });
  check('load creates memory for a new project (trailing backslash ok)', !r.isError && /created just now/.test(r.text) && fs.existsSync(path.join(memDir, 'session_state.json')), r.text);
  check(isolated ? 'memory is in the memory root (the test\'s throwaway root with --cli, P10)' : 'memory is in the real Documents folder', r.text.includes(memDir), r.text);
  const noGtLoad = r;

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

  // ---- Checks added in P3: what load shows, scaffold, decisions, the size budget ----
  // (index.js only, except the handoff checks, which need the new CLI: --cli)
  console.log('\n-- P3 checks --');
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const localToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const THREE = ['GROUND_TRUTH.md', 'CONVENTIONS.md', 'HOW_WE_WORK.md'];

  check('load with no ground truth offers the scaffold (create only if the user agrees)',
    /--- No ground truth ---/.test(noGtLoad.text) && /claudedev_scaffold/.test(noGtLoad.text) && /only if the user agrees/.test(noGtLoad.text),
    noGtLoad.text);

  // scaffold
  const treeBefore = listTree(scratch);
  r = await call('claudedev_scaffold', { project_path: scratch, summary: 'A throwaway project for the smoke test.' });
  const treeAfter = listTree(scratch);
  check('scaffold creates the three files',
    !r.isError && THREE.every(f => fs.existsSync(path.join(scratch, 'docs', f))) && /Created: docs\\GROUND_TRUTH\.md, docs\\CONVENTIONS\.md, docs\\HOW_WE_WORK\.md/.test(r.text) && /sections 1–3/.test(r.text),
    r.text);
  const added = treeAfter.filter(x => !treeBefore.includes(x));
  check('scaffold touches nothing outside docs\\',
    treeBefore.length === 0 && added.length === 4 && added.every(x => x === 'docs' || x.startsWith('docs\\')),
    `before: [${treeBefore.join(', ')}]\nadded: [${added.join(', ')}]`);
  const scaffolded = fs.readFileSync(path.join(scratch, 'docs', 'GROUND_TRUTH.md'), 'utf8');
  check('scaffold fills in the project, the date and the summary',
    scaffolded.includes(`# ${scratchName} — Ground Truth`) && scaffolded.includes(`Last updated: ${localToday}`) &&
    scaffolded.includes('A throwaway project for the smoke test.') && !/\{\{/.test(scaffolded),
    scaffolded.slice(0, 600));
  const snapshot = () => THREE.map(f => fs.readFileSync(path.join(scratch, 'docs', f), 'utf8')).join('\u0000');
  const contentBefore = snapshot();
  r = await call('claudedev_scaffold', { project_path: scratch, title: 'Another title' });
  check('scaffold a second time skips all three and changes nothing',
    !r.isError && /Created: nothing/.test(r.text) && (r.text.match(/already there, not changed/g) || []).length === 3 &&
    snapshot() === contentBefore && listTree(scratch).join('|') === treeAfter.join('|'),
    r.text);

  r = await call('claudedev_load', { project_path: scratch });
  {
    const iStatus = r.text.indexOf('## 2. Status');
    const iMem = r.text.indexOf('--- Mistakes to avoid');
    check('load with a scaffolded ground truth shows its Status before the memory sections',
      !r.isError && iStatus > 0 && iMem > iStatus && /\*\*Next:\*\* fill in sections 1–3/.test(r.text) &&
      r.text.includes('--- Ground truth: docs\\GROUND_TRUTH.md ---') && !/No ground truth/.test(r.text) && !/No docs\\CONVENTIONS/.test(r.text),
      r.text.slice(0, 2000));
  }

  // decisions (the installed v1.3.0 CLI can record them too)
  r = await call('claudedev_record_decision', { project_path: scratch, decision: 'Keep the store as plain JSON lines', why: 'Easy to append and to read back by hand', alternatives: ['SQLite', 'one JSON file'], file: 'ClaudeMemory.cs' });
  const r2 = await call('claudedev_record_decision', { project_path: scratch, decision: 'Keep load short', why: 'Context costs tokens every session' });
  const decs = fs.existsSync(path.join(memDir, 'DECISIONS.jsonl'))
    ? fs.readFileSync(path.join(memDir, 'DECISIONS.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : [];
  check('record_decision is written by the CLI with DEC### IDs (two decisions, two IDs)',
    !r.isError && !r2.isError && decs.length === 2 && decs.every(d => /^DEC\d{3,}$/.test(d.id)) && new Set(decs.map(d => d.id)).size === 2 &&
    decs[0].decision === 'Keep the store as plain JSON lines' && decs[0].chose === decs[0].decision &&
    decs[0].reasoning === 'Easy to append and to read back by hand' && decs[0].alternatives_considered.join('|') === 'SQLite|one JSON file' && decs[0].file === 'ClaudeMemory.cs',
    `${r.text}\n${r2.text}\n${JSON.stringify(decs)}`);
  r = await call('claudedev_load', { project_path: scratch });
  check('load shows the decisions with their reasons, newest first',
    /--- Decisions \(newest 2 of 2\) ---/.test(r.text) && /DEC\d{3} Keep load short \| why: Context costs tokens/.test(r.text) &&
    /Keep the store as plain JSON lines \| why: Easy to append/.test(r.text) && r.text.indexOf('Keep load short') < r.text.indexOf('Keep the store'),
    r.text.slice(-1500));

  r = await call('claudedev_handoff', { project_path: scratch, where_i_stopped: 'somewhere' });
  check('handoff without next_step is refused', r.isError && /next_step/.test(r.text), r.text);

  // handoffs (need the new CLI's "record ... handoff")
  if (cliPath) {
    r = await call('claudedev_handoff', { project_path: scratch, where_i_stopped: 'Smoke handoff: wrote the parser', next_step: 'Smoke handoff: test the parser', open_questions: ['Which cap?'], notes: 'Nothing else.' });
    const hist = () => fs.existsSync(path.join(memDir, 'HANDOFFS.jsonl'))
      ? fs.readFileSync(path.join(memDir, 'HANDOFFS.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : [];
    check('handoff is saved by the CLI (session_handoff.md and HANDOFFS.jsonl)',
      !r.isError && /HND\d{3}/.test(r.text) && fs.existsSync(path.join(memDir, 'session_handoff.md')) && hist().length === 1 && hist()[0].source === 'explicit',
      r.text);
    r = await call('claudedev_load', { project_path: scratch });
    const iH = r.text.indexOf('--- Last handoff (just now');
    const iG = r.text.indexOf('--- Ground truth');
    check('the next load shows the handoff first, with its age',
      iH > 0 && iH < iG && iG < r.text.indexOf('--- Mistakes') && /explicit\) ---/.test(r.text) &&
      /\*\*Where I stopped:\*\* Smoke handoff: wrote the parser/.test(r.text) && /\*\*Next step:\*\* Smoke handoff: test the parser/.test(r.text) && /- Which cap\?/.test(r.text),
      r.text.slice(0, 1500));
    const c = cli('handoff', scratch);
    r = await call('claudedev_load', { project_path: scratch });
    check('an automatic handoff (claudedev handoff) never replaces the explicit one',
      c.code === 0 && /explicit handoff is kept/.test(c.out) && /wrote the parser/.test(r.text) && /explicit\) ---/.test(r.text) &&
      hist().map(h => h.source).join(',') === 'explicit,auto',
      `${c.out}\n${r.text.slice(0, 800)}`);
  } else {
    console.log('SKIP  handoff checks (need the new CLI: --cli): "handoff is saved by the CLI", "the next load shows the handoff first, with its age", "an automatic handoff never replaces the explicit one"');
  }

  // A hand-made ground truth: a numbered Status heading, a Next line near its top, a long log.
  const hand = makeProject('handmade');
  const statusLog = [];
  for (let i = 1; i <= 80; i++) statusLog.push(`- **2026-01-${pad((i % 28) + 1)}, step ${i}:** did thing number ${i}, with enough words to make a line of about ninety.`);
  write(path.join(hand.dir, 'docs', 'GROUND_TRUTH.md'), [
    '# Handmade — Ground Truth', '', '*Last updated: 2026-02-02 (made by hand for the smoke test)*', '', '---', '',
    '## 1. What This Is', '', 'A test project.', '', '---', '',
    '## 2. Status', '', '**Next:** ship the handmade widget.', '', ...statusLog, '', '---', '',
    '## 5. Open Questions', '', '1. ~~A settled question~~ **Decided:** yes.', '2. **Still open:** which colour for the widget?', '', '---', '',
    '## 6. Known Problems', '', '1. Nothing yet.', '',
  ].join('\r\n'));
  const p1 = path.join(hand.dir, 'docs', 'P1_OUTPUT.md');
  write(p1, '# P1 output: the older one\n\n## For the owner\n\nOld steps.\n');
  const old = new Date(Date.now() - 3 * 86400000);
  fs.utimesSync(p1, old, old);
  write(path.join(hand.dir, 'docs', 'P2_OUTPUT.md'), '# P2 output: the newest one\n\n*2026-02-02.*\n\n## For the owner\n\n1. Run the newest step.\n\n## Results\n\nAll good.\n\n## Not done\n\nNothing.\n');
  r = await call('claudedev_load', { project_path: hand.dir });
  check('load with a hand-made "## 2. Status": the last Status lines and the Next line',
    !r.isError && /## 2\. Status \(the last lines\)/.test(r.text) && /step 80:/.test(r.text) && !/step 1:/.test(r.text) &&
    /Next: ship the handmade widget\./.test(r.text) && /Last updated: 2026-02-02/.test(r.text) && /\[\.\.\. earlier lines: docs\\GROUND_TRUTH\.md, line \d+\]/.test(r.text),
    r.text.slice(0, 3500));
  check('load shows only the still-open questions',
    /which colour for the widget/.test(r.text) && !/A settled question/.test(r.text), r.text.slice(0, 4000));
  check('load shows the newest Pn_OUTPUT.md: title, first section, the other headings',
    /--- Newest output: docs\\P2_OUTPUT\.md/.test(r.text) && /# P2 output: the newest one/.test(r.text) && /Run the newest step/.test(r.text) &&
    /Other sections: Results · Not done/.test(r.text) && !/P1 output/.test(r.text) && /No docs\\CONVENTIONS\.md or docs\\HOW_WE_WORK\.md/.test(r.text),
    r.text.slice(0, 4500));

  // The size budget: 500 activities, 100 mistakes, a 40 KB ground truth under another name, a handoff.
  const big = makeProject('budget');
  const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit ';
  const bigLines = ['# Big — Ground Truth (READ FIRST)', '', '*Last updated: 2026-03-30*', '', '## 1. What This Is', '', filler.repeat(10), '', '## 2. Status', ''];
  for (let i = 1; i <= 250; i++) bigLines.push(`- **2026-03-${pad((i % 28) + 1)}, entry ${i}:** ${filler.repeat(2)}`);
  bigLines.push('', '**Next:** the big next step.', '', '## 3. Architecture', '');
  while (bigLines.join('\n').length < 40 * 1024) bigLines.push(`- ${filler.repeat(3)}`);
  const bigGt = path.join(big.dir, 'docs', 'BIG - GROUND TRUTH (READ FIRST).md');
  write(bigGt, bigLines.join('\n'));
  r = await call('claudedev_load', { project_path: big.dir }); // creates the memory
  for (let d = 0; d < 5; d++) {
    const lines = [];
    for (let k = 0; k < 100; k++) {
      const n = d * 100 + k;
      lines.push(JSON.stringify({ id: `ACT2026030${d + 1}_${pad(k)}`, timestamp: new Date(Date.UTC(2026, 2, d + 1, 8, k)).toISOString(), action: 'code_change', description: `budget activity ${n}: ${filler.repeat(4)}`, file: 'src\\Some\\File.cs' }));
    }
    write(path.join(big.mem, 'Activity', `2026-03-0${d + 1}.jsonl`), lines.join('\n') + '\n');
  }
  write(path.join(big.mem, 'MISTAKES.jsonl'), Array.from({ length: 100 }, (_, k) => JSON.stringify({
    id: `ERR${String(k + 1).padStart(3, '0')}`, timestamp: new Date(Date.UTC(2026, 2, 1, 9, k)).toISOString(),
    mistake: `budget mistake ${k}: ${filler.repeat(3)}`, impact: filler, fix: filler, lesson: `budget lesson ${k}: ${filler.repeat(3)}`, severity: 'medium',
  })).join('\n') + '\n');
  write(path.join(big.mem, 'DECISIONS.jsonl'), Array.from({ length: 20 }, (_, k) => JSON.stringify({
    id: `DEC${String(k + 1).padStart(3, '0')}`, timestamp: new Date(Date.UTC(2026, 2, 2, 9, k)).toISOString(), decision: `budget decision ${k}: ${filler.repeat(2)}`, chose: '', reasoning: filler.repeat(2), alternatives_considered: [],
  })).join('\n') + '\n');
  write(path.join(big.mem, 'PATTERNS.jsonl'), Array.from({ length: 20 }, (_, k) => JSON.stringify({ id: `PAT${String(k + 1).padStart(3, '0')}`, pattern: `budget pattern ${k}: ${filler.repeat(2)}`, confidence: 50 + k })).join('\n') + '\n');
  const longNotes = filler.repeat(60);
  if (cliPath) {
    r = await call('claudedev_handoff', { project_path: big.dir, where_i_stopped: `budget handoff where: ${filler.repeat(3)}`, next_step: 'budget handoff next', notes: longNotes });
    if (r.isError) check('budget: handoff saved', false, r.text);
  } else {
    write(path.join(big.mem, 'session_handoff.md'), `<!-- cds-handoff: explicit -->\n# Handoff: big\n*Written ${localToday} 08:00 (explicit) · HND001*\n\n**Where I stopped:** budget handoff where: ${filler.repeat(3)}\n\n**Next step:** budget handoff next\n\n**Notes:** ${longNotes}\n`);
  }
  r = await call('claudedev_load', { project_path: big.dir });
  const iHandoff = r.text.indexOf('--- Last handoff');
  const iStatus = r.text.indexOf('## 2. Status');
  console.log(`      (budget project: load is ${r.text.length} characters; ground truth ${fs.statSync(bigGt).size} bytes)`);
  check(`the budget: 500 activities, 100 mistakes, a 40 KB ground truth give a load of 12,000 characters or less (${r.text.length})`,
    !r.isError && fs.statSync(bigGt).size >= 40 * 1024 && r.text.length <= 12000 &&
    iHandoff > 0 && /budget handoff where/.test(r.text) && /budget handoff next/.test(r.text) &&
    iStatus > iHandoff && /entry 250:/.test(r.text) && /\*\*Next:\*\* the big next step\./.test(r.text) &&
    r.text.includes('--- Ground truth: docs\\BIG - GROUND TRUTH (READ FIRST).md ---') &&
    /older in .*MISTAKES\.jsonl/.test(r.text) && /\[\.\.\. the rest: /.test(r.text),
    r.text);

  // ---- Checks added in P4: the Claude Code hook (cds-hook.js beside the server) ----
  // Run directly, as Claude Code runs it: node cds-hook.js <event>, the input JSON on stdin.
  // CLAUDE_PROJECT_DIR is always set or removed explicitly (this test may itself run inside a
  // Claude Code session, whose own project must never be touched); the hook's log goes to %TEMP%.
  console.log('\n-- P4 checks (the Claude Code hook) --');
  const hookPath = path.join(path.dirname(serverPath), 'cds-hook.js');
  if (!fs.existsSync(hookPath)) {
    console.log(`SKIP  hook checks (no ${hookPath}; it is new in v1.4.0): session-start, the skipped folders, post-tool-use, session-end`);
  } else {
    const hookLog = path.join(os.tmpdir(), `${scratchName}_hooks.log`);
    const hook = (event, input, projectDir) => {
      const env = { ...process.env, CDS_HOOK_LOG: hookLog };
      delete env.CLAUDE_PROJECT_DIR;
      if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir;
      if (cliPath) env.CDS_CLI_PATH = cliPath;
      const t0 = Date.now();
      const stdin = typeof input === 'string' ? input : JSON.stringify(input);
      const res = spawnSync(process.execPath, [hookPath, event], { input: stdin, encoding: 'utf8', env, windowsHide: true, timeout: 30000 });
      return { code: res.status, out: res.stdout || '', err: res.stderr || '', ms: Date.now() - t0 };
    };
    const base = (cwd, ev) => ({ session_id: `smoke-${scratchName}`, transcript_path: '', cwd, hook_event_name: ev });
    const memOf = (dir) => path.join(storeRoot, 'Projects', path.basename(dir));
    // (For a drive root the CLI's project name is empty, i.e. the Projects folder itself: its list of names.)
    const snapshotDir = (d) => !path.basename(d) || /[\\/]Projects$/.test(d) ? fs.readdirSync(d).join('|') : fs.existsSync(d) ? listTree(d).map(x => { const f = path.join(d, x); const s = fs.statSync(f); return `${x}|${s.isFile() ? s.size : 'd'}|${s.mtimeMs}`; }).join('\n') : '(none)';

    // session-start on a project with a ground truth (the scratch project, scaffolded above)
    let h = hook('session-start', { ...base(scratch, 'SessionStart'), source: 'startup' }, scratch);
    console.log(`      (session-start: ${h.ms} ms, ${h.out.length} characters)`);
    check(`hook session-start prints load's context: starts with the project header, 9,500 characters or less (${h.out.length}, ${h.ms} ms)`,
      h.code === 0 && h.out.startsWith(`=== ClaudeDevStudio: ${scratchName} ===`) && h.out.length <= 9500 &&
      h.out.includes('--- Ground truth: docs\\GROUND_TRUTH.md ---') && /Loaded at session start by the ClaudeDevStudio hook/.test(h.out),
      `exit ${h.code}\n${h.out.slice(0, 600)}\n${h.err}`);
    check(`hook session-start is fast (under 2 s: ${h.ms} ms)`, h.ms < 2000, `${h.ms} ms`);

    // The budget project (a 40 KB ground truth, 500 activities): still 9,500 or less
    h = hook('session-start', { ...base(big.dir, 'SessionStart'), source: 'compact' }, big.dir);
    check(`hook session-start keeps a big project to 9,500 characters or less (${h.out.length})`,
      h.code === 0 && h.out.startsWith('=== ClaudeDevStudio: ') && h.out.length <= 9500 && /budget handoff where/.test(h.out), `${h.out.length}\n${h.out.slice(-400)}`);

    // A new project (package.json only): session-start creates its memory, like load
    const fresh = makeProject('hooknew');
    write(path.join(fresh.dir, 'package.json'), '{ "name": "hooknew" }\n');
    h = hook('session-start', { ...base(fresh.dir, 'SessionStart'), source: 'startup' }, fresh.dir);
    check('hook session-start creates the memory of a new project on first use',
      h.code === 0 && fs.existsSync(path.join(fresh.mem, 'session_state.json')) && /created just now/.test(h.out) && /--- No ground truth ---/.test(h.out), `${h.out.slice(0, 500)}\n${h.err}`);

    // Folders that are never a project: nothing printed, no memory folder created or changed
    const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    const home = process.env.USERPROFILE || os.homedir();
    for (const [label, dir, viaEnv] of [['C:\\Windows\\System32 (cwd only)', sys32, false], ['C:\\Windows\\System32 (CLAUDE_PROJECT_DIR)', sys32, true], ['the home folder', home, true], ['a drive root', path.parse(home).root, true]]) {
      const mem = memOf(dir);
      const before = snapshotDir(mem);
      h = hook('session-start', { ...base(dir, 'SessionStart'), source: 'startup' }, viaEnv ? dir : null);
      const h2 = hook('session-end', { ...base(dir, 'SessionEnd'), reason: 'other', transcript_path: path.join(here, 'fixtures', 'transcript-sample.jsonl') }, viaEnv ? dir : null);
      check(`hook skips ${label}: no output, exit 0, no memory folder created or changed`,
        h.code === 0 && h2.code === 0 && h.out === '' && h2.out === '' && snapshotDir(mem) === before,
        `exit ${h.code}/${h2.code}, output ${h.out.length}+${h2.out.length}\nbefore: ${before.slice(0, 300)}\nafter: ${snapshotDir(mem).slice(0, 300)}`);
    }
    const plain = makeProject('notaproject'); // no .git, docs, solution or manifest
    h = hook('session-start', { ...base(plain.dir, 'SessionStart'), source: 'startup' }, plain.dir);
    check('hook skips a folder that does not look like a project (no memory created)', h.code === 0 && h.out === '' && !fs.existsSync(plain.mem), h.out.slice(0, 300));

    // post-tool-use: one activity line per file per session
    const edits = () => {
      const dir = path.join(fresh.mem, 'Activity');
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
        .flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)))
        .filter(a => a.action === 'file_edit') : [];
    };
    const ptu = (tool, file, session = `smoke-${scratchName}`) => hook('post-tool-use', {
      ...base(fresh.dir, 'PostToolUse'), session_id: session, tool_name: tool,
      tool_input: tool === 'NotebookEdit' ? { notebook_path: file } : { file_path: file },
      tool_response: { filePath: file, success: true },
    }, fresh.dir);
    const fa = path.join(fresh.dir, 'src', 'a.js'), fb = path.join(fresh.dir, 'src', 'b.js');
    const rs = [ptu('Edit', fa), ptu('Edit', fa), ptu('Write', fb), ptu('MultiEdit', fa), ptu('Read', fb), ptu('Edit', path.join(os.tmpdir(), 'outside.js'))];
    // two at once for the same file, as async hooks can be
    const env2 = { ...process.env, CDS_HOOK_LOG: hookLog, CLAUDE_PROJECT_DIR: fresh.dir, ...(cliPath ? { CDS_CLI_PATH: cliPath } : {}) };
    const race = JSON.stringify({ ...base(fresh.dir, 'PostToolUse'), session_id: `smoke-race-${scratchName}`, tool_name: 'Edit', tool_input: { file_path: fb }, tool_response: { success: true } });
    const { spawn } = await import('child_process');
    const runAsync = () => new Promise(res => { const c = spawn(process.execPath, [hookPath, 'post-tool-use'], { env: env2, windowsHide: true }); c.on('exit', code => res(code)); c.stdin.end(race); });
    const raceCodes = await Promise.all([runAsync(), runAsync(), runAsync()]);
    const e1 = edits();
    const forSession = (s) => e1.filter(a => a.description && a.description.includes('(Claude Code'));
    const files = e1.map(a => a.file).sort();
    check('hook post-tool-use records one activity line per file per session',
      rs.every(x => x.code === 0 && x.out === '') && raceCodes.every(c => c === 0) &&
      e1.length === 3 && files.join('|') === ['src\\a.js', 'src\\b.js', 'src\\b.js'].join('|') &&
      forSession().length === 3 && e1.every(a => /^Edited src\\[ab]\.js \(Claude Code, (Edit|Write)\)$/.test(a.description)),
      `exit codes ${rs.map(x => x.code).join(',')} / race ${raceCodes.join(',')}\n${JSON.stringify(e1, null, 1)}`);

    // session-end: an automatic handoff from the transcript, within 1.5 s
    const fixture = fs.readFileSync(path.join(here, 'fixtures', 'transcript-sample.jsonl'), 'utf8');
    const transcriptFor = (dir) => {
      const f = path.join(os.tmpdir(), `${scratchName}_${path.basename(dir)}_transcript.jsonl`);
      fs.writeFileSync(f, fixture.replace(/\{\{PROJECT\}\}/g, dir.replace(/\\/g, '\\\\')), 'utf8');
      extraProjects.push({ dir: f, mem: f });
      return f;
    };
    const history = (mem) => fs.existsSync(path.join(mem, 'HANDOFFS.jsonl'))
      ? fs.readFileSync(path.join(mem, 'HANDOFFS.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : [];
    const handoffMd = (mem) => fs.existsSync(path.join(mem, 'session_handoff.md')) ? fs.readFileSync(path.join(mem, 'session_handoff.md'), 'utf8') : '';
    if (cliPath) {
      h = hook('session-end', { ...base(fresh.dir, 'SessionEnd'), reason: 'prompt_input_exit', transcript_path: transcriptFor(fresh.dir) }, fresh.dir);
      const hist = history(fresh.mem);
      const md = handoffMd(fresh.mem);
      console.log(`      (session-end: ${h.ms} ms)`);
      check(`hook session-end writes an automatic handoff within 1.5 s (${h.ms} ms)`,
        h.code === 0 && h.out === '' && h.ms < 1500 && hist.length === 1 && hist[0].source === 'auto' &&
        /^<!-- cds-handoff: auto -->/.test(md) && /from the Claude Code session \(session end\)/.test(md) &&
        md.includes("The last request: \"Now add tests for the parser's error cases, please.\"") && !md.includes('system-reminder') &&
        md.includes('Files edited in this session (3): src\\parser.js, test\\parser.test.js, notes\\explore.ipynb') &&
        !md.includes('not-counted') && md.includes('Added three error-case tests') && md.includes(`claude --resume smoke-${scratchName}`),
        `exit ${h.code}, ${h.ms} ms\n${md}\n${h.err}`);
      r = await call('claudedev_load', { project_path: fresh.dir });
      check('the next load shows the automatic handoff first', /--- Last handoff \(just now, .*automatic\) ---/.test(r.text) && r.text.indexOf('--- Last handoff') < r.text.indexOf('--- No ground truth'), r.text.slice(0, 900));

      // pre-compact: same, prints nothing (its stdout would steer the compaction summary)
      h = hook('pre-compact', { ...base(fresh.dir, 'PreCompact'), trigger: 'auto', custom_instructions: null, transcript_path: transcriptFor(fresh.dir) }, fresh.dir);
      check('hook pre-compact writes an automatic handoff and prints nothing',
        h.code === 0 && h.out === '' && history(fresh.mem).length === 2 && /before compaction/.test(handoffMd(fresh.mem)), `${h.out}\n${handoffMd(fresh.mem).slice(0, 300)}`);

      // never replaces an explicit handoff (the scratch project has one from the P3 checks)
      const mdBefore = handoffMd(memDir);
      const n = history(memDir).length;
      h = hook('session-end', { ...base(scratch, 'SessionEnd'), reason: 'other', transcript_path: transcriptFor(scratch) }, scratch);
      const after = history(memDir);
      check('hook session-end never replaces an explicit handoff (it goes to HANDOFFS.jsonl only)',
        h.code === 0 && /^<!-- cds-handoff: explicit -->/.test(mdBefore) && handoffMd(memDir) === mdBefore &&
        after.length === n + 1 && after[after.length - 1].source === 'auto' && /Claude Code session/.test(after[after.length - 1].where_i_stopped),
        `exit ${h.code}\n${handoffMd(memDir).slice(0, 300)}\n${JSON.stringify(after[after.length - 1])}`);
    } else {
      console.log('SKIP  hook session-end/pre-compact handoff checks (need the new CLI: --cli): "writes an automatic handoff within 1.5 s", "the next load shows it", "pre-compact prints nothing", "never replaces an explicit handoff"');
    }

    // An unreadable transcript: nothing written, exit 0, a line in the hook log
    const nBefore = history(fresh.mem).length;
    const mdBefore2 = handoffMd(fresh.mem);
    const logBefore = fs.existsSync(hookLog) ? fs.readFileSync(hookLog, 'utf8').length : 0;
    const hMissing = hook('session-end', { ...base(fresh.dir, 'SessionEnd'), reason: 'other', transcript_path: path.join(os.tmpdir(), `${scratchName}_missing.jsonl`) }, fresh.dir);
    const hDir = hook('pre-compact', { ...base(fresh.dir, 'PreCompact'), trigger: 'manual', transcript_path: os.tmpdir() }, fresh.dir);
    const hJunk = hook('session-end', 'not json at all', fresh.dir);
    const logAfter = fs.existsSync(hookLog) ? fs.readFileSync(hookLog, 'utf8') : '';
    check('hook with an unreadable transcript writes nothing, exits 0 and logs the reason (not to stdout)',
      [hMissing, hDir, hJunk].every(x => x.code === 0 && x.out === '' && x.err === '') &&
      history(fresh.mem).length === nBefore && handoffMd(fresh.mem) === mdBefore2 &&
      /the transcript could not be read/.test(logAfter.slice(logBefore)),
      `exit ${hMissing.code}/${hDir.code}/${hJunk.code}\nlog: ${logAfter.slice(logBefore)}`);
    try { fs.rmSync(hookLog, { force: true }); fs.rmSync(path.join(os.tmpdir(), 'hook_cache.json'), { force: true }); } catch { /* leave it */ }
  }

  // ---- Checks added in P5: claudedev_search, lessons for every project ----
  // A second server with a throwaway memory root and old store (CDS_MEMORY_ROOT, CDS_LEGACY_ROOT),
  // so nothing here reads or writes the real store or the real LESSONS.jsonl.
  console.log('\n-- P5 checks (search, lessons for every project; a throwaway memory root) --');
  {
    const p5 = path.join(os.tmpdir(), `${scratchName}_p5`);
    const R = path.join(p5, 'root'), L = path.join(p5, 'legacy'), W = path.join(p5, 'work');
    extraProjects.push({ dir: p5, mem: p5 });
    const P = (s) => `${scratchName}_${s}`;
    const proj = (s) => { const dir = path.join(W, P(s)); write(path.join(dir, 'package.json'), `{ "name": "p5-${s.toLowerCase()}" }\n`); return { dir, name: P(s), mem: path.join(R, 'Projects', P(s)), old: path.join(L, 'Projects', P(s)) }; };
    const A = proj('A'), B = proj('B'), C = proj('C'), D = proj('D'), E = proj('E');
    const jl = (list) => list.map(o => JSON.stringify(o)).join('\n') + '\n';
    const m1 = { id: 'ERR001', timestamp: '2026-05-01T10:00:00', mistake: 'Packed the quokka marmalade crate upside down before the zeppelin left', impact: 'Broken jars', fix: 'Repacked it', lesson: 'Check the quokka crate orientation label first', severity: 'medium' };
    write(path.join(A.mem, 'MISTAKES.jsonl'), jl([m1]));
    write(path.join(A.mem, 'DECISIONS.jsonl'), jl([{ id: 'DEC001', timestamp: '2026-05-01T11:00:00', decision: 'Ship the quokka marmalade by zeppelin', chose: 'Ship the quokka marmalade by zeppelin', reasoning: 'Faster than the ferry', alternatives_considered: ['ferry'] }]));
    write(path.join(A.mem, 'Activity', '2026-05-03.jsonl'), jl(Array.from({ length: 30 }, (_, k) => ({ id: `ACT20260503_${k}`, timestamp: `2026-05-03T09:${pad(k)}:00`, action: 'code_change', description: `Sorted quokka marmalade batch ${k} for the warehouse shelves`, file: 'shelves.txt' }))));
    write(path.join(B.mem, 'MISTAKES.jsonl'), jl([{ id: 'ERR001', timestamp: '2026-06-01T10:00:00', mistake: 'Forgot the quokka marmalade invoice for the customs office', impact: 'Delayed', fix: 'Sent it', lesson: 'Print the quokka marmalade invoice with the crate', severity: 'low' }]));
    // The same mistake in the old store (v1.2.x one-file-per-entry), and an entry only there.
    write(path.join(A.old, 'Activity', '20260501_100000_mistake.json'), JSON.stringify({ timestamp: m1.timestamp, mistake: m1.mistake, impact: m1.impact, fix: m1.fix, lesson: m1.lesson }));
    write(path.join(A.old, 'Activity', '20260404_090000_activity.json'), JSON.stringify({ timestamp: '2026-04-04T09:00:00', action: 'note', description: 'Old store note about quokka marmalade labels', file: '', outcome: 'success' }));
    // Ranking: a mistake and a newer activity line with the same words.
    write(path.join(E.mem, 'MISTAKES.jsonl'), jl([{ id: 'ERR001', timestamp: '2026-01-01T08:00:00', mistake: 'Peeled the tangerine over the keyboard', impact: 'Sticky keys', fix: 'Cleaned', lesson: 'Peel tangerine away from keyboard', severity: 'low' }]));
    write(path.join(E.mem, 'Activity', '2026-09-09.jsonl'), jl([{ id: 'ACT20260909_1', timestamp: '2026-09-09T08:00:00', action: 'note', description: 'Peeled a tangerine beside the keyboard again', file: '' }]));
    // Crowding: 12 mistakes and 40 newer activity lines with the same two words.
    const F = proj('F');
    write(path.join(F.mem, 'MISTAKES.jsonl'), jl(Array.from({ length: 12 }, (_, k) => ({ id: `ERR${String(k + 1).padStart(3, '0')}`, timestamp: `2026-02-${pad(k + 1)}T08:00:00`, mistake: `Walrus accordion mistake number ${k}`, impact: 'x', fix: 'y', lesson: `Tune walrus accordion ${k}`, severity: 'low' }))));
    write(path.join(F.mem, 'Activity', '2026-10-10.jsonl'), jl(Array.from({ length: 40 }, (_, k) => ({ id: `ACT20261010_${k}`, timestamp: `2026-10-10T08:${pad(k)}:00`, action: 'file_edit', description: `Edited walrus_accordion_${k}.txt (Claude Code, Edit)`, file: `walrus_accordion_${k}.txt` }))));

    const client2 = new Client({ name: 'cds-smoke-p5', version: '1.0.0' });
    await client2.connect(new StdioClientTransport({
      command: process.execPath, args: [serverPath],
      env: { CDS_MEMORY_ROOT: R, CDS_LEGACY_ROOT: L, ...(cliPath ? { CDS_CLI_PATH: cliPath } : {}) },
    }));
    const call2 = async (name, args) => { const x = await client2.callTool({ name, arguments: args }); return { text: x.content?.[0]?.text ?? '', isError: !!x.isError }; };
    const hitLines = (t) => t.split('\n').filter(l => l.startsWith('- '));
    const tree = (d) => fs.existsSync(d) ? listTree(d).map(x => { const s = fs.statSync(path.join(d, x)); return `${x}|${s.isFile() ? s.size : 'd'}|${s.mtimeMs}`; }).join('\n') : '(none)';
    try {
      const { tools: tools2 } = await client2.listTools();
      check('P5 server lists claudedev_search and claudedev_record_lesson', ['claudedev_search', 'claudedev_record_lesson'].every(n => tools2.some(t => t.name === n)), tools2.map(t => t.name).join(', '));

      // ---- search (index.js only: works with any CLI) ----
      const before = `${tree(R)}\n--\n${tree(L)}`;
      r = await call2('claudedev_search', { query: 'quokka marmalade', project_path: A.dir });
      check('search finds a seeded mistake by two of its words in one project',
        !r.isError && r.text.includes(`mistake ${A.name}\\MISTAKES.jsonl ERR001: Packed the quokka marmalade crate`) && r.text.startsWith(`Search "quokka marmalade" in ${A.name}:`), r.text);
      check('an entry in both the old and the new store is shown once (the new one)',
        (r.text.match(/Packed the quokka marmalade crate/g) || []).length === 1 && !r.text.includes('20260501_100000_mistake.json'), r.text);
      check('the mistake and the decision are shown before 31 activity hits',
        / decision .*DEC001/.test(r.text) && hitLines(r.text).findIndex(l => / activity /.test(l)) > hitLines(r.text).findIndex(l => / decision /.test(l)) && /more activity lines not shown/.test(r.text), r.text);
      const crowd = await call2('claudedev_search', { query: 'walrus accordion', project_path: F.dir });
      const cl = hitLines(crowd.text);
      check('activity cannot crowd out mistakes (12 mistakes, 40 newer activity lines: 10 mistakes and 5 activity shown)',
        cl.length === 15 && cl.filter(l => / mistake /.test(l)).length === 10 && cl.filter(l => / activity /.test(l)).length === 5 &&
        /2 more hits not shown/.test(crowd.text) && /35 more activity lines not shown/.test(crowd.text), crowd.text);
      const all = await call2('claudedev_search', { query: 'quokka marmalade' });
      check('search across projects finds both projects\' mistakes',
        !all.isError && new RegExp(`in 2 projects`).test(all.text.split('\n')[0]) && all.text.includes(`${A.name}\\MISTAKES.jsonl ERR001`) && all.text.includes(`${B.name}\\MISTAKES.jsonl ERR001: Forgot the quokka marmalade invoice`), all.text);
      r = await call2('claudedev_search', { query: 'quokka marmalade', kinds: ['activity'], limit: 40 });
      check('search reads the old store too (an entry only there is shown as old:)',
        !r.isError && r.text.includes(`old:${A.name}\\Activity\\20260404_090000_activity.json: note: Old store note about quokka marmalade labels`), r.text.slice(0, 1500));
      check(`search with limit 40 stays within 6,000 characters (${r.text.length})`, r.text.length <= 6000 && hitLines(r.text).length === 31, `${r.text.length} characters, ${hitLines(r.text).length} lines`);
      r = await call2('claudedev_search', { query: 'tangerine keyboard', project_path: E.dir });
      const el = hitLines(r.text);
      check('search ranks a mistake above a newer activity line with the same words',
        el.length === 2 && / mistake /.test(el[0]) && / activity /.test(el[1]), r.text);
      r = await call2('claudedev_search', { query: 'quokka marmalade', kinds: ['decisions'] });
      check('search respects kinds (decisions only)', !r.isError && hitLines(r.text).length === 1 && hitLines(r.text).every(l => / decision /.test(l)), r.text);
      r = await call2('claudedev_search', { query: 'quokka marmalade', limit: 3 });
      check('search respects limit (3 lines, and says how many more)', hitLines(r.text).length === 3 && /showing 3 /.test(r.text) && /more (hits|activity lines) not shown/.test(r.text), r.text);
      check(`search's default output stays within 3,000 characters (${all.text.length})`, all.text.length <= 3000, all.text);
      r = await call2('claudedev_search', { query: 'xylophone kumquat' });
      check('search with no hits answers in one line and suggests other words',
        !r.isError && !r.text.includes('\n') && /No memory entry matches "xylophone kumquat"/.test(r.text) && /fewer or other words/.test(r.text), r.text);
      r = await call2('claudedev_search', { query: 'quokka', kinds: ['nonsense'] });
      check('search refuses an unknown kind, naming the valid ones', r.isError && /Unknown kind: nonsense/.test(r.text) && /mistakes, decisions, patterns, handoffs, activity, lessons/.test(r.text), r.text);
      const after = `${tree(R)}\n--\n${tree(L)}`;
      const bl = before.split('\n'), al = after.split('\n');
      check('search creates or changes nothing (the memory root and the old store, before and after)', before === after,
        `only before:\n${bl.filter(x => !al.includes(x)).join('\n')}\nonly after:\n${al.filter(x => !bl.includes(x)).join('\n')}`);

      // ---- lessons (need the new CLI, which honours CDS_MEMORY_ROOT) ----
      if (!cliPath) {
        console.log('SKIP  lessons checks (need the new CLI: --cli; an older CLI would write to the real store): "record_mistake suggests a lesson", "record_lesson writes", "near-duplicate refused", "empty refused", "load shows lessons", "the hook stays within 9,500", "check_mistake finds a lesson"');
      } else {
        const realLessons = path.join(docs, 'ClaudeDevStudio', 'LESSONS.jsonl');
        const realBefore = fs.existsSync(realLessons) ? `${fs.statSync(realLessons).size}|${fs.statSync(realLessons).mtimeMs}` : '(none)';
        const lessonsFile = path.join(R, 'LESSONS.jsonl');
        const lessonsIn = () => fs.existsSync(lessonsFile) ? fs.readFileSync(lessonsFile, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : [];
        const cli2 = (...args) => { const x = spawnSync(cliPath, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, CDS_MEMORY_ROOT: R } }); return { code: x.status, out: `${x.stdout || ''}${x.stderr || ''}` }; };

        r = await call2('claudedev_load', { project_path: A.dir });
        check('load with no lessons file has no lessons section (and is within budget)', !r.isError && !/Lessons for every project/.test(r.text) && r.text.length <= 12000 && r.text.includes(A.mem), r.text.slice(0, 600));

        // record_mistake's suggestion: the same mistake in two other projects (A and B), before any lesson exists
        r = await call2('claudedev_record_mistake', { project_path: D.dir, mistake: 'Packed the quokka marmalade crate upside down', impact: 'Broken jars', fix: 'Repacked it', lesson: 'Check the quokka crate orientation', severity: 'medium' });
        check('record_mistake suggests a lesson for every project when the same mistake is in two other projects',
          !r.isError && /recorded in 2 other projects/.test(r.text) && r.text.includes(A.name) && r.text.includes(B.name) && /claudedev_record_lesson/.test(r.text) && /suggestion/.test(r.text) && lessonsIn().length === 0, r.text);
        r = await call2('claudedev_record_mistake', { project_path: D.dir, mistake: 'The xylophone tuning drifted overnight in the cold barn', impact: 'Out of tune', fix: 'Retuned', lesson: 'Keep the xylophone indoors overnight' });
        check('record_mistake does not suggest a lesson for a mistake no other project has', !r.isError && !/other projects/.test(r.text) && !/record_lesson/.test(r.text), r.text);

        r = await call2('claudedev_record_lesson', { lesson: 'Label every quokka marmalade crate with its orientation before loading', why: `${A.name}, 2026-05-01: a crate was packed upside down`, source_project: A.name });
        let ls = lessonsIn();
        check('record_lesson writes a lesson (LSN001, in the throwaway root\'s LESSONS.jsonl)',
          !r.isError && /LSN001/.test(r.text) && ls.length === 1 && ls[0].id === 'LSN001' && ls[0].source_project === A.name && /upside down/.test(ls[0].why), `${r.text}\n${JSON.stringify(ls)}`);
        r = await call2('claudedev_record_lesson', { lesson: 'Before loading, label each quokka marmalade crate orientation', why: 'again' });
        check('record_lesson refuses a near-duplicate, naming the lesson it matches', r.isError && /NOT recorded/.test(r.text) && /nearly duplicates LSN001/.test(r.text) && lessonsIn().length === 1, r.text);
        r = await call2('claudedev_record_lesson', { lesson: '   ', why: 'x' });
        const c0 = cli2('lesson', 'add', '{"lesson":"  ","why":"x"}');
        check('an empty lesson is refused (the tool and the CLI)', r.isError && /empty/.test(r.text) && c0.code === 1 && /needs "lesson"/.test(c0.out) && lessonsIn().length === 1, `${r.text}\n${c0.out}`);

        r = await call2('claudedev_load', { project_path: A.dir });
        const iMis = r.text.indexOf('--- Mistakes to avoid'), iLes = r.text.indexOf('--- Lessons for every project (1 of 1, the most relevant here first) ---'), iDec = r.text.indexOf('--- Decisions');
        check('load shows the lessons section after the project\'s mistakes, before its decisions',
          !r.isError && iMis > 0 && iLes > iMis && iDec > iLes && r.text.includes('- Label every quokka marmalade crate with its orientation before loading (LSN001)'), r.text.slice(Math.max(0, iMis - 50), iMis + 900));

        // 40 more lessons (written as a fixture): the section stays near 1,200 characters, load within budget
        fs.appendFileSync(lessonsFile, jl(Array.from({ length: 40 }, (_, k) => ({ id: `LSN${String(k + 2).padStart(3, '0')}`, timestamp: `2026-10-${pad((k % 28) + 1)}T08:00:00`, lesson: `Fixture lesson ${k}: remember the widget${k} gadget${k} settings when packaging the release for strangers`, why: 'fixture' }))));
        r = await call2('claudedev_load', { project_path: A.dir });
        const sStart = r.text.indexOf('\n--- Lessons for every project');
        const sEnd = r.text.indexOf('\n\n', sStart + 2);
        const section = sStart >= 0 ? r.text.slice(sStart, sEnd > 0 ? sEnd : undefined) : '';
        check(`load with 41 lessons: the section is at most 1,200 characters (${section.length}) and load at most 12,000 (${r.text.length})`,
          sStart >= 0 && section.length <= 1200 && r.text.length <= 12000 && /more in .*LESSONS\.jsonl/.test(section) && / of 41, the most relevant here first\) ---/.test(section) &&
          section.split('\n')[2].startsWith('- Label every quokka marmalade crate'), section);

        const hookEnv = { ...process.env, CDS_MEMORY_ROOT: R, CDS_LEGACY_ROOT: L, CDS_CLI_PATH: cliPath, CDS_HOOK_LOG: path.join(p5, 'hooks.log'), CLAUDE_PROJECT_DIR: A.dir };
        const hs = spawnSync(process.execPath, [path.join(path.dirname(serverPath), 'cds-hook.js'), 'session-start'],
          { input: JSON.stringify({ session_id: `smoke-p5-${scratchName}`, cwd: A.dir, hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8', env: hookEnv, windowsHide: true, timeout: 30000 });
        check(`hook session-start with lessons stays at 9,500 characters or less (${(hs.stdout || '').length})`,
          hs.status === 0 && (hs.stdout || '').length <= 9500 && (hs.stdout || '').startsWith(`=== ClaudeDevStudio: ${A.name} ===`) && /Lessons for every project/.test(hs.stdout || ''), `${(hs.stdout || '').slice(0, 400)}\n${hs.stderr}`);

        const plan = 'Load the quokka marmalade crate without an orientation label';
        r = await call2('claudedev_check_mistake', { project_path: C.dir, action_description: plan });
        const c1 = cli2('check', C.dir, plan);
        check('check_mistake finds a matching lesson and says it is machine-wide (the tool and the CLI)',
          !r.isError && /lesson for every project \(machine-wide/.test(r.text) && /LSN001: Label every quokka/.test(r.text) &&
          c1.code === 1 && /Lesson ID: LSN001/.test(c1.out) && /machine-wide/.test(c1.out), `${r.text}\n--- CLI:\n${c1.out}`);
        r = await call2('claudedev_check_mistake', { project_path: C.dir, action_description: 'Rename the settings page title' });
        check('check_mistake stays quiet when no mistake or lesson matches', !r.isError && /No recorded mistake or lesson/.test(r.text), r.text);
        r = await call2('claudedev_record_mistake', { project_path: C.dir, mistake: 'Packed the quokka marmalade crate upside down', impact: 'Broken jars', fix: 'Repacked it', lesson: 'Check the quokka crate orientation' });
        check('record_mistake says when a lesson for every project already covers the mistake', !r.isError && /already covers it: LSN001/.test(r.text) && !/record it once/.test(r.text), r.text);

        r = await call2('claudedev_search', { query: 'quokka orientation', kinds: ['lessons'] });
        check('search finds lessons (kinds: lessons)', !r.isError && /lesson LESSONS\.jsonl LSN001: Label every quokka marmalade crate/.test(r.text), r.text);

        const c2 = cli2('lesson', 'remove', 'LSN001');
        check('the CLI removes a lesson (lesson remove), keeping a backup', c2.code === 0 && !lessonsIn().some(l => l.id === 'LSN001') && fs.existsSync(lessonsFile + '.bak'), c2.out);

        const realAfter = fs.existsSync(realLessons) ? `${fs.statSync(realLessons).size}|${fs.statSync(realLessons).mtimeMs}` : '(none)';
        const leaked = [A, B, C, D, E].filter(x => fs.existsSync(path.join(docs, 'ClaudeDevStudio', 'Projects', x.name)));
        check('the real LESSONS.jsonl and the real store were not touched by the lessons checks',
          realBefore === realAfter && leaked.length === 0, `real lessons before ${realBefore}, after ${realAfter}; leaked: ${leaked.map(x => x.name).join(', ')}`);
      }
    } finally {
      await client2.close().catch(() => {});
    }
  }

  // ---- Checks added in P6: the debug monitor removed, the CLI's session state out of %APPDATA%,
  // claudedev_vs_get_output's pane (against no Visual Studio and a fake VS Bridge on a spare port) ----
  console.log('\n-- P6 checks (monitor removed, session state, vs_get_output pane) --');
  {
    const p6 = path.join(os.tmpdir(), `${scratchName}_p6`);
    extraProjects.push({ dir: p6, mem: p6 });
    fs.mkdirSync(p6, { recursive: true });

    // The monitor: gone from tools/list; an old client calling it gets the replacement, not "Unknown tool".
    const { tools: tools6 } = await client.listTools();
    check('claudedev_monitor_start is no longer listed (P6)', !tools6.some(t => t.name === 'claudedev_monitor_start'), tools6.map(t => t.name).join(', '));
    r = await call('claudedev_monitor_start', { project_path: scratch });
    check('calling claudedev_monitor_start says it was removed in 1.5.0 and what to use instead',
      r.isError && /removed in ClaudeDevStudio 1\.5\.0/.test(r.text) && /claudedev_vs_get_output/.test(r.text) && /pane "debug"/.test(r.text) && !fs.existsSync(path.join(memDir, 'monitor.log')), r.text);
    const instr = client.getInstructions() || '';
    check('the instructions do not mention the monitor or DebugView', !/monitor|DebugView/i.test(instr), instr);

    if (!cliPath) {
      console.log('SKIP  CLI checks for P6 (need the new CLI: --cli): "monitor says it was removed", "session state in the memory root", "the old %APPDATA% file is read once"');
    } else {
      const c = cli('monitor', scratch);
      check('CLI "monitor" prints one line saying it was removed in 1.5.0 (exit 1)', c.code === 1 && /removed in ClaudeDevStudio 1\.5\.0/.test(c.out) && c.out.trim().split('\n').length === 1, c.out);

      // Session state: a throwaway memory root (new place) and a throwaway APPDATA (the old place).
      const R6 = path.join(p6, 'root'), A6 = path.join(p6, 'appdata');
      const oldFile = path.join(A6, 'ClaudeDevStudio', 'session_state.json');
      const newFile = path.join(R6, 'cli_session_state.json');
      const realOld = path.join(process.env.APPDATA || '', 'ClaudeDevStudio', 'session_state.json');
      const realNew = path.join(docs, 'ClaudeDevStudio', 'cli_session_state.json');
      const stamp = (f) => fs.existsSync(f) ? `${fs.statSync(f).size}|${fs.statSync(f).mtimeMs}` : '(none)';
      const realBefore = `${stamp(realOld)} / ${stamp(realNew)}`;
      const cli6 = (...args) => { const x = spawnSync(cliPath, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, CDS_MEMORY_ROOT: R6, APPDATA: A6 } }); return { code: x.status, out: `${x.stdout || ''}${x.stderr || ''}` }; };

      let a = cli6('active');
      check('session state: with neither file, "active" says none is set and creates no file',
        a.code === 1 && /No active project set/.test(a.out) && !fs.existsSync(newFile), a.out);
      const oldJson = JSON.stringify({ ActiveProjectPath: 'C:\\Work\\OldOne', ActiveProjectName: 'OldOne', LastAccessed: '2026-11-10T18:47:00Z', SessionCount: 3, TotalSessions: 5, IsInitialized: true }, null, 2);
      write(oldFile, oldJson);
      a = cli6('active');
      check('session state: the old %APPDATA% file is read when the new one does not exist (copied to the memory root)',
        a.code === 0 && /Name: OldOne/.test(a.out) && /Session count: 3/.test(a.out) && fs.existsSync(newFile) && fs.readFileSync(newFile, 'utf8') === oldJson, a.out);
      check('session state: the old file is left as it was', fs.readFileSync(oldFile, 'utf8') === oldJson);
      write(oldFile, oldJson.replace(/OldOne/g, 'ChangedLater'));
      a = cli6('active');
      check('session state: the old file is read only once (the new file wins afterwards)', a.code === 0 && /Name: OldOne/.test(a.out) && !/ChangedLater/.test(a.out), a.out);
      const realAfter = `${stamp(realOld)} / ${stamp(realNew)}`;
      check('session state: the real %APPDATA% file and the real memory root were not touched', realBefore === realAfter, `before ${realBefore}, after ${realAfter}`);
    }

    // claudedev_vs_get_output: a workbench with a throwaway VS Bridge folder (CDS_MEMORY_ROOT), no
    // Review Panel (LOCALAPPDATA has no install) and the bridge port moved to a spare one (CDS_VS_BRIDGE_PORT).
    const http = await import('http');
    const sparePort = await new Promise((res) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    const W6 = path.join(p6, 'wb');
    const wb = new Client({ name: 'cds-smoke-p6', version: '1.0.0' });
    await wb.connect(new StdioClientTransport({
      command: process.execPath, args: [path.join(path.dirname(serverPath), 'workbench.js')], stderr: 'ignore',
      env: { CDS_MEMORY_ROOT: W6, LOCALAPPDATA: path.join(p6, 'local'), CDS_VS_BRIDGE_PORT: String(sparePort) },
    }));
    const wcall = async (name, args) => { const x = await wb.callTool({ name, arguments: args }); return { text: x.content?.[0]?.text ?? '', isError: !!x.isError }; };
    let fake = null;
    try {
      const { tools: wt } = await wb.listTools();
      const vo = wt.find(t => t.name === 'claudedev_vs_get_output');
      check('workbench: claudedev_vs_get_output accepts pane (build, debug, a name, list)',
        !!vo && !!vo.inputSchema?.properties?.pane && /debug/.test(vo.description) && /list/.test(vo.description), JSON.stringify(vo));
      const wjson = JSON.stringify({ tools: wt });
      // (6,000 until P7; the four phase tools take it to about 6,200.)
      check(`workbench tools/list stays small (${Buffer.byteLength(wjson, 'utf8')} bytes)`, Buffer.byteLength(wjson, 'utf8') < 7000);

      r = await wcall('claudedev_vs_get_output', {});
      check('vs_get_output with no pane is the Build pane as before (no saved build yet: says so)', !r.isError && /vs_build_output\.txt not found/.test(r.text), r.text);
      write(path.join(W6, 'VSBridge', 'vs_build_output.txt'), Array.from({ length: 150 }, (_, k) => `build line ${k + 1}`).join('\n'));
      r = await wcall('claudedev_vs_get_output', { pane: 'build', lines: 5 });
      check('vs_get_output pane "build" reads the saved build output, newest lines', /^Build Output \(last 5 lines\)/.test(r.text) && r.text.endsWith('build line 146\nbuild line 147\nbuild line 148\nbuild line 149\nbuild line 150') && !/build line 145/.test(r.text), r.text);

      r = await wcall('claudedev_vs_get_output', { pane: 'debug' });
      check('vs_get_output pane "debug" without Visual Studio fails politely (not an exception)',
        !r.isError && /isn't reachable/.test(r.text) && /Open Visual Studio/.test(r.text), r.text);
      r = await wcall('claudedev_vs_get_output', { pane: 'list' });
      check('vs_get_output pane "list" without Visual Studio fails politely too', !r.isError && /isn't reachable/.test(r.text), r.text);

      // A fake VS Bridge 1.5.0 on the spare port (the answers VsBridgeServer.cs gives).
      const seen = [];
      let mode = 'new';
      const debugText = Array.from({ length: 100 }, (_, k) => `Debug.WriteLine ${k + 201}`).join('\r\n') + '\r\n';
      const panes = [{ name: 'Build', guid: '{1BD8A850-02D1-11D1-BEE7-00A0C913D1F8}', kind: 'build', lines: 40 }, { name: 'Debug', guid: '{FC076020-078A-11D1-A7DF-00A0C9110051}', kind: 'debug', lines: 301 }, { name: 'Source Control - Git', guid: '{B85579AA-8BE0-4C4F-A850-90902B317581}', lines: 3 }];
      fake = http.createServer((q, s) => {
        seen.push(q.url);
        const u = new URL(q.url, 'http://localhost');
        const send = (code, o) => { s.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); s.end(JSON.stringify(o)); };
        if (mode === 'old') return send(404, { error: 'Not found' });
        if (u.pathname === '/panes') return send(200, { panes });
        if (u.pathname === '/pane' && u.searchParams.get('name') === 'debug') return send(200, { pane: 'Debug', guid: panes[1].guid, kind: 'debug', lines: 300, shown: 100, text: debugText });
        if (u.pathname === '/pane' && u.searchParams.get('name') === 'Tests') return send(200, { pane: 'Tests', guid: '{00000000-0000-0000-0000-000000000001}', lines: 0, shown: 0, text: '', note: 'Visual Studio has not written anything to this pane yet.' });
        if (u.pathname === '/pane') return send(200, { error: `There is no Output pane named "${u.searchParams.get('name')}".`, panes });
        return send(404, { error: 'Not found' });
      });
      await new Promise((res) => fake.listen(sparePort, '127.0.0.1', res));

      r = await wcall('claudedev_vs_get_output', { pane: 'debug' });
      check('vs_get_output pane "debug" asks the bridge for the Debug pane (100 lines by default) and shows the newest lines',
        !r.isError && seen.includes('/pane?name=debug&lines=100') && /^Output pane "Debug" \(last 100 of 300 lines, live\)/.test(r.text) && r.text.includes('Debug.WriteLine 201') && r.text.includes('Debug.WriteLine 300'), `${seen.join(' ')}\n${r.text.slice(0, 300)}`);
      r = await wcall('claudedev_vs_get_output', { pane: 'list' });
      check('vs_get_output pane "list" names the panes (with build/debug marked)',
        !r.isError && /^Output panes \(3\)/.test(r.text) && /Debug {2}\[pane: "debug"\] {2}301 lines/.test(r.text) && /Source Control - Git {2}3 lines/.test(r.text), r.text);
      r = await wcall('claudedev_vs_get_output', { pane: 'Source Control - Git', lines: 7 });
      check('vs_get_output passes any other pane name through (encoded) with lines', seen.includes('/pane?name=Source%20Control%20-%20Git&lines=7'), seen.join(' '));
      r = await wcall('claudedev_vs_get_output', { pane: 'Nope' });
      check('vs_get_output for a pane that does not exist says so and lists the panes',
        !r.isError && /There is no Output pane named "Nope"/.test(r.text) && /Output panes now: "Build" \(build\), "Debug" \(debug\), "Source Control - Git"/.test(r.text), r.text);
      r = await wcall('claudedev_vs_get_output', { pane: 'Tests' });
      check('vs_get_output for a pane Visual Studio has not written to yet says so (no error)', !r.isError && /^Output pane "Tests": Visual Studio has not written anything to this pane yet\.$/.test(r.text), r.text);
      mode = 'old';
      r = await wcall('claudedev_vs_get_output', { pane: 'debug' });
      check('vs_get_output against a VS Bridge older than 1.5.0 says to update it (not the Build pane by mistake)',
        !r.isError && /older than 1\.5\.0/.test(r.text) && !/build line/.test(r.text), r.text);
    } finally {
      await wb.close().catch(() => {});
      if (fake) await new Promise((res) => fake.close(() => res()));
    }
  }

  // ---- Checks added in P7: running phases from chat (cds-phase.js, the claudedev_phase_* tools),
  // against a fake Claude Code; and the automatic handoff listing only the project's files ----
  console.log('\n-- P7 checks (phase tools with a fake Claude Code; handoff file list) --');
  if (!fs.existsSync(path.join(path.dirname(serverPath), 'cds-phase.js'))) {
    console.log(`SKIP  P7 checks (no cds-phase.js beside ${serverPath}; it is new in P7): the phase tools (start, status, reply, stop, the lock, the refusals) and the handoff's file list`);
  } else {
    const p7 = path.join(os.tmpdir(), `${scratchName}_p7`);
    extraProjects.push({ dir: p7, mem: p7 });
    const bin = path.join(p7, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const fakeClaude = path.join(bin, 'fake-claude.mjs');
    fs.copyFileSync(path.join(here, 'fixtures', 'fake-claude.mjs'), fakeClaude);
    const proj = path.join(p7, 'proj');
    for (const [ph, mode] of [['N1', 'normal'], ['Q1', 'question'], ['L1', 'forever'], ['E1', 'error'], ['S1', 'slow']]) write(path.join(proj, 'docs', `${ph}_prompt.md`), `# ${ph}\n\nFAKE_MODE: ${mode}\n`);
    write(path.join(proj, 'README.md'), 'A throwaway project for the P7 smoke checks.\n');
    const plain = path.join(p7, 'plain');
    write(path.join(plain, 'notes.txt'), 'not a project\n');
    const W7 = path.join(p7, 'wb');
    const phaseMod = await import(new URL(`file:///${path.join(path.dirname(serverPath), 'cds-phase.js').replace(/\\/g, '/')}`).href);
    const realProjects = path.join(docs, 'ClaudeDevStudio', 'Projects');
    const realBefore = fs.readdirSync(realProjects).filter(n => n.includes(scratchName)).length;

    const wb7 = new Client({ name: 'cds-smoke-p7', version: '1.0.0' });
    await wb7.connect(new StdioClientTransport({
      command: process.execPath, args: [path.join(path.dirname(serverPath), 'workbench.js')], stderr: 'ignore',
      // CLAUDECODE / CLAUDE_PROJECT_DIR / CDS_FAKE_MARK: the run must not inherit them (it gets the user's environment).
      // P9: CDS_PHASE_WINDOW=hidden (tests only) opens a manual run's window hidden; CLAUDE_CONFIG_DIR is
      // where Status looks for a manual session's transcript (the fake writes it there).
      env: { CDS_MEMORY_ROOT: W7, LOCALAPPDATA: path.join(p7, 'local'), CDS_PHASE_CLAUDE: fakeClaude, CDS_FAKE_MARK: 'from-the-server', CLAUDECODE: '1', CLAUDE_PROJECT_DIR: scratch,
        CDS_PHASE_WINDOW: 'hidden', CLAUDE_CONFIG_DIR: path.join(p7, 'ccfg') },
    }));
    const pcall = async (name, args) => { const t0 = Date.now(); const x = await wb7.callTool({ name, arguments: args }); return { text: x.content?.[0]?.text ?? '', isError: !!x.isError, ms: Date.now() - t0 }; };
    const calls = () => fs.existsSync(path.join(proj, 'docs', 'fake_calls.jsonl')) ? fs.readFileSync(path.join(proj, 'docs', 'fake_calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    const metaOf = (ph) => JSON.parse(fs.readFileSync(path.join(proj, 'docs', `${ph}_run.json`), 'utf8'));
    const lockFile = path.join(proj, 'docs', 'cds_phase.lock');
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    // The result is in the log a moment before the runner records the exit and releases the lock.
    const waitEnded = async (ph, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const m = metaOf(ph); if (m.runs[m.runs.length - 1].ended) return; } catch { /* not yet */ } await sleep(200); } };
    const waitFor = async (ph, re, ms = 20000) => { const t0 = Date.now(); let s; do { s = await pcall('claudedev_phase_status', { project_path: proj, phase: ph }); if (re.test(s.text)) return s; await sleep(400); } while (Date.now() - t0 < ms); return s; };
    try {
      const { tools: t7 } = await wb7.listTools();
      const names = ['claudedev_phase_start', 'claudedev_phase_status', 'claudedev_phase_reply', 'claudedev_phase_stop'];
      const ps = t7.find(t => t.name === 'claudedev_phase_start');
      check('workbench lists the four phase tools (start, status, reply, stop)', names.every(n => t7.some(t => t.name === n)), t7.map(t => t.name).join(', '));
      check('phase_start\'s description says Windows, acceptEdits, never bypasses permissions, the user\'s own sign-in',
        !!ps && /Windows/.test(ps.description) && /acceptEdits/.test(ps.description) && /never bypasses permissions/.test(ps.description) && /sign-in and plan/.test(ps.description) &&
        ps.inputSchema.required.join(',') === 'project_path,phase' && !ps.inputSchema.properties.prompt, JSON.stringify(ps));
      console.log(`      (workbench tools/list: ${Buffer.byteLength(JSON.stringify({ tools: t7 }), 'utf8')} bytes, ${t7.length} tools)`);
      const D = phaseMod.DEFAULT_ALLOWED_TOOLS;
      check('the default allowed tools never include a bypass or the phase tools, and name the 13 memory tools',
        !/dangerously|bypass/i.test(D) && !/claudedev_phase_/.test(D) && (D.match(/mcp__claudedevstudio__claudedev_/g) || []).length === 13 && phaseMod.PERMISSION_MODE === 'acceptEdits', D);
      // P8: Monitor (so a phase can wait on long work), and the run's environment settings.
      const PE = phaseMod.PHASE_ENV || {};
      // A cds-phase.js from before P8 (an installed 1.5.x copy) has none of it: those checks are skipped and named.
      const p8 = !!phaseMod.PHASE_ENV;
      const check8 = (label, ok, detail) => { if (p8) check(label, ok, detail); else console.log(`SKIP  ${label} (this cds-phase.js predates P8)`); };
      check8('P8: Monitor is in the default allowed tools (still no bypass, still acceptEdits)', D.split(',').includes('Monitor') && !/dangerously|bypass/i.test(D), D);
      check8('P8: the run\'s environment settings are the idle ceiling and the foreground timeout ceiling, 60 minutes each',
        PE.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS === '3600000' && PE.BASH_MAX_TIMEOUT_MS === '3600000' && Object.keys(PE).length === 2, JSON.stringify(PE));
      const ps1 = path.resolve(path.dirname(serverPath), '..', 'tools', 'phase', 'run-phase.ps1');
      if (fs.existsSync(ps1)) {
        const t = fs.readFileSync(ps1, 'utf8');
        const code = t.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
        check8('P8: run-phase.ps1 lists Monitor, sets both variables (unless already set), and passes no bypass flag',
          /'[^']*\bMonitor\b[^']*'/.test(code) && /CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS/.test(code) && /BASH_MAX_TIMEOUT_MS/.test(code) && !/dangerously|bypassPermissions/i.test(code) && /acceptEdits/.test(code), ps1);
      } else console.log(`SKIP  "run-phase.ps1 lists Monitor" (no ${ps1}: an installed copy)`);

      // Refusals
      let r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'X9' });
      check('start refuses a phase whose prompt file does not exist', r7.isError && /no docs\\X9_prompt\.md/i.test(r7.text) && !fs.existsSync(lockFile) && !fs.existsSync(path.join(proj, 'docs', 'X9_run.json')), r7.text);
      r7 = await pcall('claudedev_phase_start', { project_path: plain, phase: 'N1' });
      check('start refuses a folder that does not look like a project', r7.isError && /doesn't look like a project/.test(r7.text) && !fs.existsSync(path.join(plain, 'docs')), r7.text);
      const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
      r7 = await pcall('claudedev_phase_start', { project_path: sys32, phase: 'N1' });
      check('start refuses System32', r7.isError && /inside Windows or Program Files/.test(r7.text), r7.text);
      r7 = await pcall('claudedev_phase_start', { project_path: path.parse(os.tmpdir()).root, phase: 'N1' });
      check('start refuses a drive root', r7.isError && /drive root/.test(r7.text), r7.text);
      r7 = await pcall('claudedev_phase_start', { project_path: os.homedir(), phase: 'N1' });
      check('start refuses the home folder', r7.isError && /home folder/.test(r7.text), r7.text);
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: '..\\N1' });
      check('start refuses a phase name with a path in it', r7.isError && /phase must be a short name/.test(r7.text), r7.text);
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'N1', allowed_tools: 'Read,mcp__cds-workbench__claudedev_phase_start' });
      check('start refuses allowed_tools that would let the phase start phases', r7.isError && /start, answer or stop phases/.test(r7.text), r7.text);
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'N1', allowed_tools: '--dangerously-skip-permissions' });
      check('start refuses an allowed_tools entry that is a flag', r7.isError && /isn't a tool name/.test(r7.text), r7.text);
      fs.writeFileSync(path.join(bin, 'fake-version.txt'), '2.0.42');
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'N1' });
      check('start refuses a Claude Code too old for its flags, naming both versions', r7.isError && /Claude Code 2\.0\.42 is too old/.test(r7.text) && /2\.1\.0 or later/.test(r7.text) && !fs.existsSync(lockFile), r7.text);
      fs.unlinkSync(path.join(bin, 'fake-version.txt'));
      {
        // No Claude Code: no override, a PATH with only Windows and Node, a home with no .local\bin.
        const wbNo = new Client({ name: 'cds-smoke-p7-noclaude', version: '1.0.0' });
        await wbNo.connect(new StdioClientTransport({
          command: process.execPath, args: [path.join(path.dirname(serverPath), 'workbench.js')], stderr: 'ignore',
          env: { CDS_MEMORY_ROOT: W7, LOCALAPPDATA: path.join(p7, 'local'), USERPROFILE: p7, PATH: `${sys32};${path.dirname(process.execPath)}` },
        }));
        try {
          const x = await wbNo.callTool({ name: 'claudedev_phase_start', arguments: { project_path: proj, phase: 'N1' } });
          const t = x.content?.[0]?.text ?? '';
          check('start refuses when Claude Code is not on PATH, saying how to install it', !!x.isError && /isn't installed or isn't on PATH/.test(t) && /code\.claude\.com/.test(t), t);
        } finally { await wbNo.close().catch(() => {}); }
      }

      // A normal run, no model or effort given
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'N1' });
      check(`start returns at once (${r7.ms} ms) with the runner's pid and how to check it`, !r7.isError && r7.ms < 8000 && /Started N1/.test(r7.text) && /runner pid \d+/.test(r7.text) && /claudedev_phase_status/.test(r7.text) && /acceptEdits/.test(r7.text), r7.text);
      let s7 = await waitFor('N1', /FINISHED/);
      await waitEnded('N1');
      check('status after a run: FINISHED, tool calls, the permission denial by name, the result, OUTPUT written, no question',
        !s7.isError && /^N1 in .*: FINISHED/.test(s7.text) && /Tool calls: 2 \| permission denials: 1 \(Bash\)/.test(s7.text) && /Done: wrote docs\\N1_OUTPUT\.md/.test(s7.text) &&
        /docs\\N1_OUTPUT\.md: written /.test(s7.text) && !/QUESTION/.test(s7.text) && s7.text.length <= 2500, s7.text);
      let c = calls().pop() || {};
      const a = c.argv || [];
      const val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
      check('the run got -p with the prompt naming docs\\N1_prompt.md, acceptEdits, the default tools, stream-json, --verbose, an MCP config in %TEMP%; no --model/--effort when not given',
        // (P9: collaborative and delegated runs are told a reply can come, and how to ask; before P9, "unattended".)
        a[0] === '-p' && (phaseMod.MODES ? /^Read docs\\N1_prompt\.md and carry it out\. You are running headless: .*"QUESTION:"/.test(a[1]) : /^Read docs\\N1_prompt\.md and carry it out\. You are running unattended/.test(a[1])) && val('--permission-mode') === 'acceptEdits' &&
        val('--allowedTools') === D && val('--output-format') === 'stream-json' && a.includes('--verbose') && !a.includes('--model') && !a.includes('--effort') &&
        path.resolve(val('--mcp-config') || '').toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase()) && c.cwd.toLowerCase() === proj.toLowerCase(), JSON.stringify(c));
      check('the run gets the user\'s environment, not the server\'s (no CLAUDECODE, no CLAUDE_PROJECT_DIR, no test variable)', c.claudecode === null && c.project_dir === null && c.mark === null, JSON.stringify(c));
      {
        const want = (k) => process.env[k] || PE[k]; // a value the user set themselves wins
        const r0 = metaOf('N1').runs[0];
        check8('P8: the run\'s environment carries the idle ceiling and the foreground timeout ceiling (recorded in the .json), and Claude Code shares the runner\'s console',
          c.bg_wait_ceiling === want('CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS') && c.bash_max_timeout === want('BASH_MAX_TIMEOUT_MS') && !!c.bg_wait_ceiling &&
          r0.env && r0.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS === c.bg_wait_ceiling && r0.shares_console === true, `${JSON.stringify(c)}\n${JSON.stringify(r0)}`);
      }
      check('the lock is released when the run ends', !fs.existsSync(lockFile));
      const m1 = metaOf('N1');
      check('docs\\N1_run.json records the run (pid, exit code 0, launched through WMI, the command)',
        m1.runs.length === 1 && m1.runs[0].exit_code === 0 && m1.runs[0].launched_by === 'wmi' && Number.isInteger(m1.pid) && m1.runs[0].command.includes('--permission-mode'), JSON.stringify(m1.runs[0]).slice(0, 600));

      // A question, then the reply (same session, same flags; the message on stdin)
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'Q1', model: 'm-test', effort: 'low' });
      s7 = await waitFor('Q1', /FINISHED/);
      check('status detects a result that ends with a question, and that no OUTPUT was written',
        /It ends with a QUESTION.*answer it with claudedev_phase_reply/.test(s7.text) && /Should I also add a test/.test(s7.text) && /docs\\Q1_OUTPUT\.md: not written yet/.test(s7.text), s7.text);
      r7 = await pcall('claudedev_phase_reply', { project_path: proj, phase: 'Q1', message: '   ' });
      check('reply refuses an empty message', r7.isError && /message is required/.test(r7.text), r7.text);
      await waitEnded('Q1');
      const sid = JSON.parse(fs.readFileSync(path.join(proj, 'docs', 'Q1_run.log'), 'utf8').trim().split('\n').pop()).session_id;
      const msg = '--dangerously-skip-permissions is not a flag here: "yes", add the test (50% faster) & stop';
      r7 = await pcall('claudedev_phase_reply', { project_path: proj, phase: 'Q1', message: msg });
      s7 = await waitFor('Q1', /FINISHED.*run 2 of 2/);
      await waitEnded('Q1');
      c = calls().pop() || {};
      const b = c.argv || [];
      const bval = (f) => { const i = b.indexOf(f); return i >= 0 ? b[i + 1] : undefined; };
      const q1 = metaOf('Q1');
      check('reply continues the same session: --resume <the log\'s session id>, the same model, effort, tools and mode',
        !r7.isError && b[0] === '-p' && bval('--resume') === sid && !!sid && bval('--model') === 'm-test' && bval('--effort') === 'low' && bval('--allowedTools') === D &&
        bval('--permission-mode') === 'acceptEdits' && bval('--output-format') === 'stream-json' && b.includes('--verbose'), `${r7.text}\n${JSON.stringify(c)}`);
      check('the reply\'s message goes in on stdin, word for word (never as an argument, so it cannot become a flag)',
        c.fromStdin === true && c.prompt === msg && !b.includes(msg) && !b.includes('--dangerously-skip-permissions') && !fs.existsSync(q1.runs[1].stdin || 'x:\\none'), JSON.stringify(c));
      check('status shows the continuation: run 2 of 2, the reply sent, its result; both results are in the one log',
        /FINISHED.*run 2 of 2, a reply/.test(s7.text) && /Reply sent: "--dangerously-skip-permissions is not a flag here/.test(s7.text) && /Continued: --dangerously/.test(s7.text) &&
        (fs.readFileSync(path.join(proj, 'docs', 'Q1_run.log'), 'utf8').match(/"type":"result"/g) || []).length === 2 && q1.runs.length === 2 && q1.runs[1].kind === 'reply', s7.text);

      // A run that goes on until stopped: the lock, refusals while it runs, stop
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'L1' });
      s7 = await waitFor('L1', /Still working/);
      check('status while running: RUNNING, its tool calls and latest text, OUTPUT not yet', /^L1 in .*: RUNNING/.test(s7.text) && /Tool calls: 1 \|/.test(s7.text) && /Still working/.test(s7.text) && /not written yet/.test(s7.text) && s7.text.length <= 2500, s7.text);
      const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : {};
      check('the lock (docs\\cds_phase.lock) holds the phase, the runner\'s pid and its start time', lock.phase === 'L1' && Number.isInteger(lock.runner_pid) && !!lock.started, JSON.stringify(lock));
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'N1' });
      check('a second start in the same project is refused while one runs (naming it)', r7.isError && /L1 is already running in this project/.test(r7.text) && fs.existsSync(path.join(proj, 'docs', 'N1_run.json')) && metaOf('N1').runs.length === 1, r7.text);
      r7 = await pcall('claudedev_phase_reply', { project_path: proj, phase: 'L1', message: 'hello' });
      check('reply is refused while that session is still running', r7.isError && /still running/.test(r7.text), r7.text);
      const fakePid = (calls().pop() || {}).pid;
      const childPid = Number(fs.readFileSync(path.join(proj, 'docs', 'fake_child.pid'), 'utf8'));
      const runnerPid = metaOf('L1').runs[0].runner_pid;
      const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      r7 = await pcall('claudedev_phase_stop', { project_path: proj, phase: 'L1' });
      await sleep(500);
      check('stop ends the run\'s process tree (the runner, the fake Claude Code and its child) and touches nothing else',
        !r7.isError && /Stopped L1/.test(r7.text) && [runnerPid, fakePid, childPid].every(p => p && !alive(p)) && alive(bystander.pid), `${r7.text}\nrunner ${runnerPid} ${alive(runnerPid)}, fake ${fakePid} ${alive(fakePid)}, child ${childPid} ${alive(childPid)}`);
      const l1 = metaOf('L1');
      const l1Status = (await pcall('claudedev_phase_status', { project_path: proj, phase: 'L1' })).text;
      check('stop releases the lock and records "stopped by request"; status says STOPPED', !fs.existsSync(lockFile) && l1.runs[0].stopped_by_request === true && /STOPPED \(by request/.test(l1Status), JSON.stringify(l1.runs[0]).slice(0, 400));
      // P8: the gentle stop. The fake got Ctrl+C, ended its turn, "ran its SessionEnd hooks", exited 0.
      const sigs = () => { try { return fs.readFileSync(path.join(proj, 'docs', 'fake_signals.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
      check8(`P8: stop sends Ctrl+C first, and the fake Claude Code ended its turn and exited by itself (${l1.runs[0].stop_ms} ms)`,
        /with Ctrl\+C/.test(r7.text) && /SessionEnd hooks ran/.test(r7.text) && l1.runs[0].stop_method === 'ctrl_c' && l1.runs[0].exit_code === 0 &&
        sigs().filter(x => x.pid === fakePid && x.signal === 'SIGINT').length === 1 && fs.existsSync(path.join(proj, 'docs', 'fake_session_end.txt')), `${r7.text}\n${JSON.stringify(l1.runs[0]).slice(0, 600)}\n${JSON.stringify(sigs())}`);
      // (The child goes with the runner's job object, which Node closes on exit; Stop's own sweep of the
      // tree is the safety net for anything that left the job.)
      check8('P8: after Ctrl+C, a child it left running (one that ignores Ctrl+C) is ended too; the bystander still lives; the log has the interrupted turn\'s result',
        !alive(childPid) && alive(bystander.pid) &&
        /"subtype":"error_during_execution".*"terminal_reason":"aborted_tools"/.test(fs.readFileSync(path.join(proj, 'docs', 'L1_run.log'), 'utf8')), r7.text);
      check8('P8: status says it was stopped with Ctrl+C and that the SessionEnd hooks ran', /STOPPED \(by request, with Ctrl\+C: Claude Code ended its turn and exited, so its SessionEnd hooks ran\)/.test(l1Status), l1Status);
      r7 = await pcall('claudedev_phase_stop', { project_path: proj, phase: 'L1' });
      check('stop on a run that is not running says so', !r7.isError && /isn't running/.test(r7.text), r7.text);

      // P8: a Claude Code that ignores Ctrl+C: two presses, then by force (the P7 way).
      write(path.join(proj, 'docs', 'K1_prompt.md'), '# K1\n\nFAKE_MODE: stubborn\n');
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'K1' });
      s7 = await waitFor('K1', /Still working/);
      const kFake = (calls().pop() || {}).pid;
      const kChild = Number(fs.readFileSync(path.join(proj, 'docs', 'fake_child.pid'), 'utf8'));
      const kRunner = metaOf('K1').runs[0].runner_pid;
      r7 = await pcall('claudedev_phase_stop', { project_path: proj, phase: 'K1' });
      await sleep(500);
      const k1 = metaOf('K1');
      const k1Status = (await pcall('claudedev_phase_status', { project_path: proj, phase: 'K1' })).text;
      check8(`P8: when Ctrl+C doesn't end it (sent twice), stop ends the tree by force and says so (${r7.ms} ms)`,
        /by force \(Ctrl\+C \(sent 2 times\) didn't end it within 15 s\)/.test(r7.text) && /no automatic handoff is written/.test(r7.text) &&
        [kRunner, kFake, kChild].every(p => p && !alive(p)) && alive(bystander.pid) && k1.runs[0].stop_method === 'force' && k1.runs[0].ctrl_c_presses === 2 &&
        sigs().filter(x => x.pid === kFake).length === 2 && !fs.existsSync(lockFile), `${r7.text}\n${JSON.stringify(k1.runs[0]).slice(0, 600)}`);
      check8('P8: status says it was stopped by force, without SessionEnd hooks', /STOPPED \(by request, by force: Ctrl\+C \(sent 2 times\) didn't end it within 15 s; no SessionEnd hooks, no automatic handoff\)/.test(k1Status), k1Status);
      try { bystander.kill(); } catch { /* gone */ }

      // Errors, a slow run, a stale lock, restarting a phase, a run-phase.ps1 run
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'E1' });
      s7 = await waitFor('E1', /FINISHED WITH AN ERROR/);
      await waitEnded('E1');
      check('status shows a run that ended in an error, with its stderr', /FINISHED WITH AN ERROR \(error_during_execution\)/.test(s7.text) && /stderr: fake claude: something went wrong/.test(s7.text) && metaOf('E1').runs[0].exit_code === 1, s7.text);
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'S1' });
      s7 = await pcall('claudedev_phase_status', { project_path: proj });
      check('status without a phase reports the newest run (S1, running)', /^S1 in .*: RUNNING/.test(s7.text), s7.text);
      s7 = await waitFor('S1', /FINISHED/);
      await waitEnded('S1');
      check('the slow run then finishes', /^S1 in .*: FINISHED/.test(s7.text) && !fs.existsSync(lockFile), s7.text);

      const dead = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore', windowsHide: true });
      await new Promise(res => dead.on('exit', res));
      write(path.join(proj, 'docs', 'Z1_prompt.md'), '# Z1\n\nFAKE_MODE: normal\n');
      write(path.join(proj, 'docs', 'Z1_run.json'), JSON.stringify({ phase: 'Z1', project: proj, pid: dead.pid, started: new Date().toISOString(), runs: [{ kind: 'start', requested: new Date().toISOString(), runner_pid: dead.pid, runner_started: new Date().toISOString(), log_offset: 0, err_offset: 0 }] }));
      write(lockFile, JSON.stringify({ phase: 'Z1', runner_pid: dead.pid, started: new Date().toISOString() }));
      s7 = await pcall('claudedev_phase_status', { project_path: proj, phase: 'Z1' });
      check('status of a run whose process is gone (a crash or a restart) says so and clears its stale lock',
        /ENDED WITHOUT A RESULT \(the process is gone/.test(s7.text) && /lock was stale/.test(s7.text) && !fs.existsSync(lockFile), s7.text);
      write(lockFile, JSON.stringify({ phase: 'Z1', runner_pid: dead.pid, started: new Date().toISOString() }));
      r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'N1' });
      check('start clears a stale lock (and says so), and keeps the previous run\'s files in docs\\phase_runs\\',
        !r7.isError && /A stale lock \(Z1, pid \d+, no longer running/.test(r7.text) && /moved to docs\\phase_runs\\/.test(r7.text) &&
        fs.readdirSync(path.join(proj, 'docs', 'phase_runs')).filter(n => /^N1_\d{8}_\d{6}_run\.(log|err|json)$/.test(n)).length === 3, r7.text);
      await waitFor('N1', /FINISHED/);
      await waitEnded('N1');

      const legacyLog = fs.readFileSync(path.join(proj, 'docs', 'N1_run.log'), 'utf8');
      write(path.join(proj, 'docs', 'P0_run.log'), legacyLog);
      write(path.join(proj, 'docs', 'P0_run.json'), JSON.stringify({ phase: 'P0', pid: dead.pid, started: new Date(Date.now() - 600000).toISOString(), model: 'claude-opus-5-5', effort: 'high', log: path.join(proj, 'docs', 'P0_run.log') }));
      s7 = await pcall('claudedev_phase_status', { project_path: proj, phase: 'P0' });
      check('status reads a run started by run-phase.ps1 (its .json has no runs)', /^P0 in .*: FINISHED/.test(s7.text) && /started by run-phase\.ps1/.test(s7.text) && /Tool calls: 2/.test(s7.text), s7.text);

      // ---- P9: modes, QUESTION blocks, the conversation, manual mode, outcome and index, Claude Code's states ----
      const p9 = !!phaseMod.MODES;
      const check9 = (label, ok, detail) => { if (p9) check(label, ok, detail); else console.log(`SKIP  ${label} (this cds-phase.js predates P9)`); };
      if (!p9) {
        for (const l of ['P9: QUESTION blocks', 'P9: the conversation formatter', 'P9: modes', 'P9: manual mode', 'P9: outcome and phases.json', 'P9: claude-code status states']) console.log(`SKIP  ${l} (this cds-phase.js predates P9)`);
      } else {
        // QUESTION: parsing (verbatim), and a non-question
        const qt = 'Done with the parser.\n\n**QUESTION:** Should the cache live in Documents or in LocalAppData?\nIt matters for the packaged app.\n1. Documents: safe under MSIX.\n   OneDrive may sync it.\n2) LocalAppData: local only.\nRECOMMENDATION: 1, because the server runs inside the package.';
        const pq = phaseMod.parseQuestion(qt);
        check9('P9: parseQuestion returns the question, each option (with its continuation) and the recommendation verbatim, and the text before it',
          !!pq && pq.question === 'Should the cache live in Documents or in LocalAppData?\nIt matters for the packaged app.' && pq.options.length === 2 &&
          pq.options[0] === '1. Documents: safe under MSIX.\nOneDrive may sync it.' && pq.options[1] === '2) LocalAppData: local only.' &&
          pq.recommendation === 'RECOMMENDATION: 1, because the server runs inside the package.' && pq.before === 'Done with the parser.', JSON.stringify(pq));
        const nq = phaseMod.parseQuestion('All done. Should be fine?\n1. a list that is not a question block');
        check9('P9: a text without a QUESTION: block is not parsed as one (the old "ends with a question" rule still applies separately)',
          nq === null && phaseMod.parseQuestion('') === null && phaseMod.looksLikeQuestion('Should I also add a test?'), JSON.stringify(nq));

        // The conversation formatter against a fixture (module and command line)
        const fx = path.join(here, 'fixtures', 'phase-log-sample.jsonl');
        const conv = phaseMod.conversation(fs.readFileSync(fx, 'utf8'));
        const kinds = conv.entries.map(e => e.kind).join(',');
        const byKind = (k) => conv.entries.filter(e => e.kind === k);
        check9('P9: the conversation: start, Claude\'s text in full, one line per tool call with its target, results collapsed (with their text), a QUESTION block apart, the end; no subagent text',
          kinds === 'start,claude,tool,result,tool,result,tool,result,claude,question,end' && conv.session_id === '11111111-2222-3333-4444-555555555555' &&
          byKind('tool')[0].text === 'Read: C:\\proj\\docs\\T1_prompt.md' && byKind('tool')[1].text === 'Bash: git status --short' &&
          byKind('tool')[2].text === 'claudedevstudio: claudedev_record_activity: C:\\proj' &&
          byKind('result')[0].text === 'result: # T1 (+2 lines)' && byKind('result')[0].detail === '# T1\nline two\nline three' && byKind('result')[1].error === true &&
          byKind('question')[0].text === 'Keep the old names, or switch to the new scheme?\n1. Keep them: nothing else changes.\n2. Switch: two scripts change too.\nRECOMMENDATION: 2, because both scripts are in scope.' &&
          byKind('claude')[1].text === 'Both layouts work.' && !conv.entries.some(e => /subagent/.test(e.text)) && /^Run ended: success, 4 turns, 1\.1 min/.test(byKind('end')[0].text), JSON.stringify(conv, null, 1).slice(0, 2500));
        const cj = spawnSync(process.execPath, [path.join(path.dirname(serverPath), 'cds-phase.js'), '--conversation', fx, '--json'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
        const ct = spawnSync(process.execPath, [path.join(path.dirname(serverPath), 'cds-phase.js'), '--conversation', fx], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
        check9('P9: cds-phase.js --conversation (the Dashboard\'s reader): the same entries as JSON; as text, the QUESTION block marked',
          cj.status === 0 && JSON.stringify(JSON.parse(cj.stdout)) === JSON.stringify(conv) && ct.status === 0 && /=== QUESTION ===\nKeep the old names/.test(ct.stdout) && /Claude: Reading the prompt first\./.test(ct.stdout), `${cj.stderr}${ct.stdout.slice(0, 800)}`);

        // Modes: refused when unknown; collaborative by default, with its guidance; a QUESTION block in Status
        write(path.join(proj, 'docs', 'QB1_prompt.md'), '# QB1\n\nFAKE_MODE: qblock\n');
        write(path.join(proj, 'docs', 'D1_prompt.md'), '# D1\n\nFAKE_MODE: normal\n');
        r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'QB1', mode: 'autopilot' });
        check9('P9: start refuses an unknown mode, naming the three', r7.isError && /mode must be one of collaborative, delegated, manual/.test(r7.text) && !fs.existsSync(lockFile), r7.text);
        r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'QB1' });
        const collab = /Mode: collaborative\. If it asks something, answer it yourself only if the answer follows from the ground truth or what is already decided, is easily undone, and is technical; otherwise put it to the user with the options and your recommendation/;
        check9('P9: start without a mode is collaborative: recorded in the .json, and its result says what to do with a question', !r7.isError && collab.test(r7.text) && /tell the user what was asked and what was answered/.test(r7.text) && metaOf('QB1').mode === 'collaborative', r7.text);
        s7 = await waitFor('QB1', /FINISHED/);
        await waitEnded('QB1');
        const qbSid = JSON.parse(fs.readFileSync(path.join(proj, 'docs', 'QB1_run.log'), 'utf8').trim().split('\n').pop()).session_id;
        check9('P9: status gives the QUESTION block verbatim and apart: the question, each option, the recommendation; the mode\'s guidance; the text before it',
          collab.test(s7.text) && /It ends with a QUESTION \(verbatim from the phase; relay it as written\):\nQuestion:\nShould the export keep the old file names, or switch to the new scheme\?\nOptions:\n1\. Keep the old names: nothing else changes\.\n2\. Switch to the new scheme: consistent, but two scripts must change\.\nBoth are in scope\.\nIts recommendation: RECOMMENDATION: 2, because the two scripts are in this phase's scope anyway\./.test(s7.text) &&
          /"I checked both layouts\."/.test(s7.text) && /Answer with claudedev_phase_reply/.test(s7.text), s7.text);
        check9('P9: a finished run\'s status says how to open it: claude --resume <its session id> in the project', s7.text.includes(`Open it: in ${proj}, run claude --resume ${qbSid} (read the whole conversation, or take it over).`), s7.text);
        const qbRun = metaOf('QB1').runs[0];
        check9('P9: the runner records the outcome (question, with the question) and whether OUTPUT was written',
          qbRun.outcome === 'question' && qbRun.question === 'Should the export keep the old file names, or switch to the new scheme?' && qbRun.output_written === false, JSON.stringify(qbRun).slice(0, 700));
        r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'D1', mode: 'delegated' });
        check9('P9: delegated mode: recorded, and its result says to answer and tell the user afterwards', !r7.isError && /Mode: delegated\. If it asks something, answer it yourself with claudedev_phase_reply, and tell the user afterwards/.test(r7.text) && metaOf('D1').mode === 'delegated', r7.text);
        s7 = await waitFor('D1', /FINISHED/);
        await waitEnded('D1');
        const d1 = metaOf('D1').runs[0];
        check9('P9: status of a delegated run says delegated; its outcome is finished, OUTPUT written', /Mode: delegated\./.test(s7.text) && d1.outcome === 'finished' && d1.output_written === true, `${s7.text}\n${JSON.stringify(d1).slice(0, 400)}`);

        // Manual mode: a window (opened hidden for the test), interactive, the user's own permission mode
        const ccfg = path.join(p7, 'ccfg');
        write(path.join(proj, 'docs', 'M1_prompt.md'), `# M1\n\nFAKE_MODE: manual\nFAKE_CONFIG_DIR: ${ccfg}\n`);
        r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'M1', mode: 'manual', allowed_tools: 'Read' });
        const m1m = metaOf('M1');
        // (Start returns once the runner has started Claude Code; the fake logs its call a moment later.)
        for (let i = 0; i < 50 && !calls().some(x => (x.argv || []).includes('--session-id')); i++) await sleep(200);
        c = calls().filter(x => (x.argv || []).includes('--session-id')).pop() || calls().pop() || {};
        const mv = (f) => { const i = (c.argv || []).indexOf(f); return i >= 0 ? c.argv[i + 1] : undefined; };
        check9(`P9: manual start opens the window (${r7.ms} ms): says so, the mode's guidance, the session id; allowed_tools noted as unused`,
          !r7.isError && /Opened M1 in a Claude Code window the user can see \(hidden \(test\)\)/.test(r7.text) && /Mode: manual\./.test(r7.text) && r7.text.includes(m1m.session_id) && /allowed_tools is not used in manual mode/.test(r7.text) &&
          m1m.mode === 'manual' && m1m.runs[0].launched_by === 'wmi' && m1m.runs[0].window === 'hidden (test)', r7.text);
        check9('P9: manual mode\'s command: interactive (no -p), the prompt as its first message, --session-id; no --permission-mode, no --allowedTools, no bypass',
          !(c.argv || []).includes('-p') && c.argv[c.argv.length - 1] === 'Read docs\\M1_prompt.md and carry it out.' && mv('--session-id') === m1m.session_id &&
          !(c.argv || []).includes('--permission-mode') && !(c.argv || []).includes('--allowedTools') && !(c.argv || []).some(x => /dangerously|bypass/i.test(x)) && c.cwd.toLowerCase() === proj.toLowerCase(), JSON.stringify(c));
        r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'D1' });
        check9('P9: the lock holds the project while the manual window is open', r7.isError && /M1 is already running in this project/.test(r7.text) && JSON.parse(fs.readFileSync(lockFile, 'utf8')).phase === 'M1', r7.text);
        s7 = await waitFor('M1', /QUESTION/);
        check9('P9: manual status: OPEN in a window, its transcript (found by the session id), tool calls from it, the question for the user in the window, no "Open it" while open',
          /^M1 in .*: OPEN in a Claude Code window \(manual mode, hidden \(test\)/.test(s7.text) && /Mode: manual\./.test(s7.text) && s7.text.includes(path.join(ccfg, 'projects', 'fake-project', `${m1m.session_id}.jsonl`)) &&
          /Tool calls: 1 \|/.test(s7.text) && /the user answers it in the window/.test(s7.text) && /Should the export keep the old file names/.test(s7.text) && !/Open it:/.test(s7.text) && !/subagent/.test(s7.text), s7.text);
        r7 = await pcall('claudedev_phase_reply', { project_path: proj, phase: 'M1', message: 'yes' });
        check9('P9: reply is refused for a manual run (the user answers in the window)', r7.isError && /manual mode: the user answers in its Claude Code window/.test(r7.text), r7.text);
        const mRunner = metaOf('M1').runs[0].runner_pid;
        r7 = await pcall('claudedev_phase_stop', { project_path: proj, phase: 'M1' });
        check9('P9: stop on a manual run asks the user to close the window first (nothing ended)', !r7.isError && /Ask the user to finish there and close the window/.test(r7.text) && /force: true/.test(r7.text) && alive(mRunner) && fs.existsSync(lockFile), r7.text);
        r7 = await pcall('claudedev_phase_stop', { project_path: proj, phase: 'M1', force: true });
        await sleep(300);
        const m1r = metaOf('M1').runs[0];
        const mStatus = (await pcall('claudedev_phase_status', { project_path: proj, phase: 'M1' })).text;
        check9(`P9: stop with force: true ends it with two Ctrl+C (the interactive way: it exits and runs SessionEnd), releases the lock (${r7.ms} ms)`,
          !r7.isError && /with Ctrl\+C/.test(r7.text) && m1r.stop_method === 'ctrl_c' && m1r.ctrl_c_presses === 2 && m1r.exit_code === 0 && !fs.existsSync(lockFile) &&
          /SessionEnd ran \(interactive/.test(fs.readFileSync(path.join(proj, 'docs', 'fake_session_end.txt'), 'utf8')), `${r7.text}\n${JSON.stringify(m1r).slice(0, 600)}`);
        check9('P9: a stopped manual run\'s status: STOPPED, and how to open it again (claude --resume <its session id>)', /^M1 in .*: STOPPED/.test(mStatus) && mStatus.includes(`claude --resume ${m1m.session_id}`), mStatus);

        // phases.json (the tray app's list): the runs, newest first, each pointing at its .json
        const ix = (() => { try { return JSON.parse(fs.readFileSync(path.join(W7, 'phases.json'), 'utf8')); } catch { return null; } })();
        check9('P9: phases.json in the memory root lists the runs (project, phase, mode, the .json), newest first, each once',
          !!ix && ix.runs[0].phase === 'M1' && ix.runs[0].mode === 'manual' && ix.runs.some(x => x.phase === 'QB1' && x.mode === 'collaborative' && x.meta === path.join(proj, 'docs', 'QB1_run.json')) &&
          ix.runs.filter(x => x.phase === 'D1').length === 1 && ix.runs.every(x => x.project === proj), JSON.stringify(ix).slice(0, 800));

        // Signed in? (claude auth status exits 1: refused, with the next step)
        fs.writeFileSync(path.join(bin, 'fake-auth.txt'), 'out');
        r7 = await pcall('claudedev_phase_start', { project_path: proj, phase: 'D1' });
        check9('P9: start refuses when Claude Code is installed but not signed in, saying to run "claude" once and sign in', r7.isError && /installed but not signed in/.test(r7.text) && /run "claude" once and sign in/.test(r7.text) && !fs.existsSync(lockFile), r7.text);
        fs.unlinkSync(path.join(bin, 'fake-auth.txt'));

        // cds-claude-code.js status: the five states, with the fake (and --no-claude)
        const ccJs = [path.resolve(path.dirname(serverPath), '..', 'Installer', 'cds-claude-code.js'), path.resolve(path.dirname(serverPath), '..', 'cds-claude-code.js')].find(f => fs.existsSync(f));
        if (!ccJs) console.log('SKIP  P9: claude-code status states (no cds-claude-code.js next to this copy)');
        else {
          const cs = path.join(p7, 'cc_settings.json'), cjf = path.join(p7, 'cc_claude.json');
          const ccRun = (...extra) => spawnSync(process.execPath, [ccJs, ...extra, '--settings', cs, '--claude-json', cjf], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
          const stateOf = (r) => (/State: (\S+)/.exec(r.stdout || '') || [])[1];
          const st = {};
          st.none = ccRun('status', '--no-claude');
          fs.writeFileSync(path.join(bin, 'fake-version.txt'), '2.0.42');
          st.old = ccRun('status', '--claude', fakeClaude);
          fs.unlinkSync(path.join(bin, 'fake-version.txt'));
          fs.writeFileSync(path.join(bin, 'fake-auth.txt'), 'out');
          st.out = ccRun('status', '--claude', fakeClaude);
          fs.unlinkSync(path.join(bin, 'fake-auth.txt'));
          st.unset = ccRun('status', '--claude', fakeClaude);
          const su = ccRun('setup', '--node', process.execPath, '--mcp', path.dirname(serverPath), '--no-claude-cli');
          st.ready = ccRun('status', '--claude', fakeClaude, '--node', process.execPath, '--mcp', path.dirname(serverPath));
          const det = spawnSync(process.execPath, [ccJs, 'detect', '--claude', fakeClaude], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
          const detNo = spawnSync(process.execPath, [ccJs, 'detect', '--no-claude'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
          check9('P9: claude-code status names the state and the next step: not-installed (the install command), too-old (claude update), not-signed-in (run claude), not-set-up, ready',
            stateOf(st.none) === 'not-installed' && /irm https:\/\/claude\.ai\/install\.ps1 \| iex/.test(st.none.stdout) &&
            stateOf(st.old) === 'too-old' && /2\.0\.42 is too old/.test(st.old.stdout) && /claude update/.test(st.old.stdout) &&
            stateOf(st.out) === 'not-signed-in' && /run "claude" once in a terminal and sign in/.test(st.out.stdout) &&
            stateOf(st.unset) === 'not-set-up' && /claudedev claude-code setup/.test(st.unset.stdout) &&
            su.status === 0 && stateOf(st.ready) === 'ready' && /signed in/.test(st.ready.stdout) && !/@/.test(Object.values(st).map(x => x.stdout).join('')),
            Object.entries(st).map(([k, v]) => `${k}: ${(v.stdout || v.stderr).split('\n').slice(1, 4).join(' / ')}`).join('\n'));
          check9('P9: detect (the installer\'s): exit 0 with the version when found, 4 with the install command when not', det.status === 0 && /Claude Code 2\.1\.322 found at/.test(det.stdout) && detNo.status === 4 && /install\.ps1/.test(detNo.stdout), `${det.stdout}${detNo.stdout}`);
        }
      }

      // Nothing outside the throwaway project and %TEMP%
      const tmp = path.resolve(os.tmpdir()).toLowerCase();
      const allMeta = ['N1', 'Q1', 'L1', 'K1', 'E1', 'S1'].map(metaOf);
      const paths = allMeta.flatMap(m => [m.log, m.err, m.mcp_config, ...m.runs.map(x => x.stdin).filter(Boolean)]);
      const realAfter = fs.readdirSync(realProjects).filter(n => n.includes(scratchName)).length;
      check('everything the runs wrote is in the throwaway project or %TEMP%; no memory folder in the real store for them; no MCP config left outside %TEMP%',
        paths.every(p => path.resolve(p).toLowerCase().startsWith(tmp)) && realAfter === realBefore,
        `${paths.join('\n')}\nreal store folders for this test: ${realBefore} -> ${realAfter}`);
      const every = calls().flatMap(x => x.argv);
      check('no run was given --dangerously-skip-permissions or bypassPermissions', !every.some(x => /dangerously|bypassPermissions/.test(x)), every.filter(x => /^--/.test(x)).join(' '));
      for (const m of allMeta) { try { fs.unlinkSync(m.mcp_config); } catch { /* gone */ } }
    } finally {
      await wb7.close().catch(() => {});
    }

    // The automatic handoff lists only the project's files (GROUND_TRUTH §7 item 23), with a throwaway memory root.
    if (!cliPath) {
      console.log('SKIP  "the automatic handoff lists only the project\'s files" (needs the new CLI: --cli; an older CLI would write to the real store)');
    } else {
      const hp = path.join(p7, 'hookproj');
      write(path.join(hp, 'docs', 'readme.md'), 'x\n');
      const root7 = path.join(p7, 'hookroot');
      const hookEnv = { ...process.env, CDS_HOOK_LOG: path.join(p7, 'hooks.log'), CDS_MEMORY_ROOT: root7, CDS_CLI_PATH: cliPath, CLAUDE_PROJECT_DIR: hp };
      const runHook = (event, input) => spawnSync(process.execPath, [path.join(path.dirname(serverPath), 'cds-hook.js'), event], { input: JSON.stringify(input), encoding: 'utf8', env: hookEnv, windowsHide: true, timeout: 30000 });
      const esc = (p) => p.replace(/\\/g, '\\\\');
      const extra = [path.join(os.tmpdir(), `${scratchName}_scratch.ps1`), path.join(p7, 'elsewhere', 'other.txt')].map((f, k) =>
        JSON.stringify({ isSidechain: false, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `tx${k}`, name: 'Write', input: { file_path: f, content: 'x' } }] }, uuid: `x${k}`, sessionId: 'p7' }));
      const tr = path.join(p7, 'transcript.jsonl');
      const lines = fs.readFileSync(path.join(here, 'fixtures', 'transcript-sample.jsonl'), 'utf8').replace(/\{\{PROJECT\}\}/g, esc(hp)).split('\n');
      lines.splice(2, 0, ...extra);
      fs.writeFileSync(tr, lines.join('\n'), 'utf8');
      runHook('session-start', { session_id: 'p7', cwd: hp, hook_event_name: 'SessionStart', source: 'startup' });
      const h7 = runHook('session-end', { session_id: 'p7', cwd: hp, hook_event_name: 'SessionEnd', reason: 'other', transcript_path: tr });
      const md = (() => { try { return fs.readFileSync(path.join(root7, 'Projects', 'hookproj', 'session_handoff.md'), 'utf8'); } catch { return ''; } })();
      check('the automatic handoff lists only the project\'s files and says how many outside ones were left out, in one line',
        h7.status === 0 && md.includes('Files edited in this session (3): src\\parser.js, test\\parser.test.js, notes\\explore.ipynb') &&
        md.includes('(2 files edited outside the project not listed.)') && !md.includes('_scratch.ps1') && !md.includes('other.txt'), md || h7.stderr);
    }
  }

  // ---- P10: backups that run, export/import, restore, sync status, OneDrive conflict copies ----
  // All against throwaway memory roots in %TEMP% (CDS_MEMORY_ROOT); the OneDrive state is set with the
  // test-only CDS_ONEDRIVE_FOLDERS / CDS_ONEDRIVE_RUNNING. Needs a 1.7 CLI (--cli).
  const p10Cli = cliPath && /export \[file\]/.test(cli('help').out);
  if (!p10Cli) {
    console.log('SKIP  P10 checks (need --cli with a 1.7 CLI): daily backup once a day and pruned, pre-upgrade backup, export -> import file by file, overlapping import, dry run, conflict copies merged and reported by load, restore backs up first, the sync line, git/cloud/sync removed, search reads a conflict copy');
  } else {
    const p10 = path.join(os.tmpdir(), `${scratchName}_p10`);
    const env10 = (root, extra = {}) => ({ ...process.env, CDS_MEMORY_ROOT: root, CDS_AUTO_BACKUP: 'off', CDS_ONEDRIVE_FOLDERS: 'none', CDS_ONEDRIVE_RUNNING: '0', ...extra });
    const c10 = (root, args, extra = {}, input = '') => { const x = spawnSync(cliPath, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, env: env10(root, extra), input }); return { code: x.status, out: `${x.stdout || ''}${x.stderr || ''}` }; };
    const RA = path.join(p10, 'A'), RB = path.join(p10, 'B'), RE = path.join(p10, 'E'), RC = path.join(p10, 'C');
    const proj = path.join(p10, 'proj', 'P10Proj');
    write(path.join(proj, 'docs', 'readme.md'), 'x\n');
    const memA = path.join(RA, 'Projects', 'P10Proj'), memB = path.join(RB, 'Projects', 'P10Proj');
    const storeOf = (root) => path.join(root, 'Backups', 'store');
    const zips = (root) => { try { return fs.readdirSync(storeOf(root)).filter(n => n.endsWith('.zip')).sort(); } catch { return []; } };
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const fileMap = (root) => {
      const m = {};
      const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) { if (!rel && e.name === 'Backups') continue; walk(path.join(d, e.name), r); } else m[r] = sha(path.join(d, e.name)); } };
      if (fs.existsSync(root)) walk(root, '');
      return m;
    };
    const sameMap = (a, b) => { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]); };
    const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()); } catch { return []; } };
    const countText = (f, t) => lines(f).filter(l => l.includes(t)).length;

    // Store A: a project with a mistake, an activity, a decision, a handoff, and a lesson.
    c10(RA, ['init', proj]);
    c10(RA, ['record', proj, 'mistake', JSON.stringify({ mistake: 'p10 mistake one', impact: 'i', fix: 'f', lesson: 'l' })]);
    c10(RA, ['record', proj, 'activity', JSON.stringify({ action: 'code_change', description: 'p10 activity one' })]);
    c10(RA, ['record', proj, 'decision', JSON.stringify({ decision: 'p10 decision one', reasoning: 'r' })]);
    c10(RA, ['record', proj, 'handoff', JSON.stringify({ where_i_stopped: 'p10 handoff from A', next_step: 'n' })]);
    c10(RA, ['lesson', 'add', JSON.stringify({ lesson: 'Zip the whole memory store before every upgrade', why: 'p10 smoke' })]);

    // Daily: made once per day.
    const d1 = c10(RA, ['backup', '--auto']);
    const d2 = c10(RA, ['backup', '--auto']);
    const daily = zips(RA).filter(n => n.endsWith('-daily.zip'));
    check('P10: backup --auto makes today\'s daily store backup once (the second run makes none)', d1.code === 0 && d2.code === 0 && daily.length === 1 && /No backup needed/.test(d2.out), `${daily.join(', ')}\n${d1.out}\n${d2.out}`);

    // Pruning: 20 older daily, 6 older pre-upgrade, 2 manual, 1 pre-import; then a pre-upgrade backup.
    const src = path.join(storeOf(RA), daily[0]);
    const stamp = (daysAgo, hh) => { const d = new Date(Date.now() - daysAgo * 86400000); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${hh}0000`; };
    for (let i = 1; i <= 20; i++) fs.copyFileSync(src, path.join(storeOf(RA), `ClaudeDevStudio-store-${stamp(i, '02')}-daily.zip`));
    for (let i = 1; i <= 6; i++) fs.copyFileSync(src, path.join(storeOf(RA), `ClaudeDevStudio-store-${stamp(i, '03')}-upgrade.zip`));
    for (let i = 30; i <= 31; i++) fs.copyFileSync(src, path.join(storeOf(RA), `ClaudeDevStudio-store-${stamp(i, '04')}-manual.zip`));
    fs.copyFileSync(src, path.join(storeOf(RA), `ClaudeDevStudio-store-${stamp(40, '05')}-pre-import.zip`));
    const up = c10(RA, ['backup', '--upgrade']);
    const kinds = (root) => zips(root).reduce((m, n) => { const k = n.replace(/^ClaudeDevStudio-store-\d{8}-\d{6}-/, '').replace(/\.zip$/, ''); m[k] = (m[k] || 0) + 1; return m; }, {});
    const k1 = kinds(RA);
    const newestDaily = zips(RA).filter(n => n.endsWith('-daily.zip')).sort().slice(-1)[0];
    check('P10: pruning keeps the newest 14 daily and 4 pre-upgrade backups; manual and pre-import ones are never deleted', up.code === 0 && k1.daily === 14 && k1.upgrade === 4 && k1.manual === 2 && k1['pre-import'] === 1 && newestDaily === daily[0], `${JSON.stringify(k1)}\n${up.out}`);

    // The pre-upgrade backup opens, every hash matches, and holds the project.
    const upZip = zips(RA).filter(n => n.endsWith('-upgrade.zip')).sort().slice(-1)[0];
    const ver = c10(RA, ['backup', '--verify', path.join(storeOf(RA), upZip)]);
    const peek = c10(RE, ['import', path.join(storeOf(RA), upZip), '--dry-run']);
    check('P10: a pre-upgrade backup (backup --upgrade, run by the installer) opens, every hash matches, and holds the store', ver.code === 0 && /every hash matches/.test(ver.out) && /Projects added: 1 \(P10Proj\)/.test(peek.out), `${ver.out}\n${peek.out}`);
    check('P10: import --dry-run writes nothing (an empty root stays absent)', peek.code === 0 && !fs.existsSync(RE), peek.out);

    // Export -> import into an empty root: the same files, byte for byte (Backups\ aside).
    const exp1 = path.join(p10, 'export1.zip');
    const ex = c10(RA, ['export', exp1]);
    const im = c10(RE, ['import', exp1]);
    const mA = fileMap(RA), mE = fileMap(RE);
    check(`P10: export -> import into an empty store reproduces it file by file (${Object.keys(mA).length} files)`, ex.code === 0 && im.code === 0 && Object.keys(mA).length >= 8 && sameMap(mA, mE),
      `${ex.out}\n${im.out}\nA only: ${Object.keys(mA).filter(k => mA[k] !== mE[k]).join(', ')}\nE only: ${Object.keys(mE).filter(k => mE[k] !== mA[k]).join(', ')}`);

    // Overlap: B starts as A, both go on, then A's new export is imported into B.
    c10(RB, ['import', exp1]);
    c10(RB, ['record', proj, 'mistake', JSON.stringify({ mistake: 'p10 only on PC B', impact: 'i', fix: 'f', lesson: 'l' })]);
    c10(RA, ['record', proj, 'mistake', JSON.stringify({ mistake: 'p10 only on PC A', impact: 'i', fix: 'f', lesson: 'l' })]);
    c10(RA, ['lesson', 'add', JSON.stringify({ lesson: 'Before every upgrade zip the whole memory store', why: 'near duplicate' }), '--force']);
    const exp2 = path.join(p10, 'export2.zip');
    c10(RA, ['export', exp2]);
    const treeB = fileMap(RB);
    const dryB = c10(RB, ['import', exp2, '--dry-run']);
    check('P10: import --dry-run into a store with entries changes nothing and says what it would add', dryB.code === 0 && sameMap(treeB, fileMap(RB)) && zips(RB).length === 0 && /Would import/.test(dryB.out) && /Entries added: 1/.test(dryB.out), dryB.out);
    const imB = c10(RB, ['import', exp2]);
    const mis = path.join(memB, 'MISTAKES.jsonl');
    check('P10: import into an overlapping store adds only the missing entries and duplicates nothing',
      imB.code === 0 && countText(mis, 'p10 mistake one') === 1 && countText(mis, 'p10 only on PC A') === 1 && countText(mis, 'p10 only on PC B') === 1 && lines(mis).length === 3 &&
      countText(path.join(memB, 'DECISIONS.jsonl'), 'p10 decision one') === 1 && countText(path.join(memB, 'HANDOFFS.jsonl'), 'p10 handoff from A') === 1,
      `${imB.out}\n${lines(mis).join('\n')}`);
    const ids = lines(mis).map(l => JSON.parse(l).id);
    check('P10: an imported entry whose ID is taken gets the next free ID (and keeps the old one as original_id); lessons: the near-duplicate is skipped',
      new Set(ids).size === ids.length && lines(mis).some(l => /"original_id"/.test(l)) && /near-duplicates: 1/.test(imB.out) && countText(path.join(RB, 'LESSONS.jsonl'), 'memory store') === 1,
      `${ids.join(', ')}\n${imB.out}`);
    check('P10: the import backed the store up first (a pre-import backup)', zips(RB).some(n => n.endsWith('-pre-import.zip')) && /Backed up first/.test(imB.out), zips(RB).join(', '));
    const again = c10(RB, ['import', exp2]);
    check('P10: importing the same export again adds nothing', again.code === 0 && /Entries added: 0/.test(again.out) && lines(mis).length === 3, again.out);

    // OneDrive conflict copies: merged through the CLI on load, moved to Backups\conflicts\, reported by load.
    const firstLine = lines(mis)[0];
    write(path.join(memB, 'MISTAKES-DESKTOP-SMOKE1.jsonl'), `${firstLine}\n${JSON.stringify({ id: 'ERR001', timestamp: '2026-11-12T09:00:00-06:00', mistake: 'p10 written on the other PC', impact: 'i', fix: 'f', lesson: 'l' })}\n`);
    write(path.join(memB, 'session_handoff-DESKTOP-SMOKE1.md'), '<!-- cds-handoff: explicit -->\n# Handoff: P10Proj\n*Written 2020-01-01 09:00 (explicit) · HND009*\n\n**Where I stopped:** p10 an old handoff from the other PC\n\n**Next step:** n\n');
    const handoffBefore = fs.readFileSync(path.join(memB, 'session_handoff.md'), 'utf8');
    const c2 = new Client({ name: 'cds-smoke-p10', version: '1.0.0' });
    await c2.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { CDS_CLI_PATH: cliPath, CDS_MEMORY_ROOT: RB, CDS_LEGACY_ROOT: path.join(p10, 'old'), CDS_AUTO_BACKUP: 'off' } }));
    try {
      const l1 = await c2.callTool({ name: 'claudedev_load', arguments: { project_path: proj } });
      const t1 = l1.content?.[0]?.text ?? '';
      const moved = path.join(RB, 'Backups', 'conflicts', 'P10Proj', 'MISTAKES-DESKTOP-SMOKE1.jsonl');
      check('P10: load merges a OneDrive conflict copy\'s new entry into the main file once (through the CLI) and moves the copy to Backups\\conflicts\\',
        countText(mis, 'p10 written on the other PC') === 1 && lines(mis).length === 4 && !fs.existsSync(path.join(memB, 'MISTAKES-DESKTOP-SMOKE1.jsonl')) && fs.existsSync(moved), lines(mis).join('\n'));
      check('P10: load says so in one short line ("merged 1 entry from a OneDrive conflict copy made on DESKTOP-SMOKE1")', /OneDrive: Merged 1 entry from a OneDrive conflict copy made on DESKTOP-SMOKE1/.test(t1) && t1.indexOf('OneDrive:') < t1.indexOf('--- '), t1.slice(0, 900));
      check('P10: a conflict copy of session_handoff.md: the newer stays the handoff, the older is added to HANDOFFS.jsonl, the copy moved',
        fs.readFileSync(path.join(memB, 'session_handoff.md'), 'utf8') === handoffBefore && countText(path.join(memB, 'HANDOFFS.jsonl'), 'p10 an old handoff from the other PC') === 1 &&
        fs.existsSync(path.join(RB, 'Backups', 'conflicts', 'P10Proj', 'session_handoff-DESKTOP-SMOKE1.md')), lines(path.join(memB, 'HANDOFFS.jsonl')).join('\n'));
      const l2 = await c2.callTool({ name: 'claudedev_load', arguments: { project_path: proj } });
      check('P10: the next load has nothing to merge and says nothing about it', !/OneDrive:/.test(l2.content?.[0]?.text ?? ''), (l2.content?.[0]?.text ?? '').slice(0, 400));
      // search reads an unmerged copy (read-only: it is still there afterwards)
      write(path.join(memB, 'DECISIONS-LAPTOP-SMOKE2.jsonl'), JSON.stringify({ id: 'DEC001', timestamp: '2026-11-12T10:00:00-06:00', decision: 'p10 zebrafish decision from the laptop', reasoning: 'r' }) + '\n');
      const s = await c2.callTool({ name: 'claudedev_search', arguments: { query: 'zebrafish decision', project_path: proj } });
      const st = s.content?.[0]?.text ?? '';
      check('P10: claudedev_search finds an entry in a conflict copy not merged yet, and leaves the copy where it is', /zebrafish/.test(st) && /DECISIONS-LAPTOP-SMOKE2\.jsonl/.test(st) && fs.existsSync(path.join(memB, 'DECISIONS-LAPTOP-SMOKE2.jsonl')), st);
    } finally {
      await c2.close().catch(() => {});
    }

    // Restore: replace, after backing up; a "no" changes nothing.
    const restoreZip = path.join(storeOf(RB), zips(RB).find(n => n.endsWith('-pre-import.zip')));
    const beforeNo = fileMap(RB);
    const no = c10(RB, ['restore', restoreZip], {}, 'n\n');
    check('P10: restore asks first; "n" changes nothing', no.code === 0 && /cancelled/.test(no.out) && sameMap(beforeNo, fileMap(RB)), no.out);
    const preRestoreBefore = zips(RB).filter(n => n.endsWith('-pre-restore.zip')).length;
    const yes = c10(RB, ['restore', restoreZip, '--yes']);
    check('P10: restore backs the store up first, then puts the backup\'s files back (here: the mistakes before the import)',
      yes.code === 0 && zips(RB).filter(n => n.endsWith('-pre-restore.zip')).length === preRestoreBefore + 1 && /Backed up first/.test(yes.out) && countText(mis, 'p10 only on PC A') === 0 && countText(mis, 'p10 only on PC B') === 1, `${yes.out}\n${lines(mis).join('\n')}`);

    // load starts today's daily backup on its own and doesn't wait for it.
    c10(RC, ['init', proj]);
    const t0 = Date.now();
    const ld = spawnSync(cliPath, ['load', proj], { encoding: 'utf8', windowsHide: true, timeout: 60000, env: { ...env10(RC), CDS_AUTO_BACKUP: '' } });
    const loadMs = Date.now() - t0;
    let made = false;
    for (let i = 0; i < 40 && !made; i++) { made = zips(RC).some(n => n.endsWith('-daily.zip')); if (!made) await sleep(250); }
    check(`P10: load starts the daily store backup in the background and returns at once (${loadMs} ms)`, ld.status === 0 && loadMs < 3000 && made, `${ld.stdout}${ld.stderr}; zips: ${zips(RC).join(', ')}`);

    // The sync line.
    const inOd = c10(RA, ['backup', '--status'], { CDS_ONEDRIVE_FOLDERS: p10, CDS_ONEDRIVE_RUNNING: '1' }).out;
    const odOff = c10(RA, ['backup', '--status'], { CDS_ONEDRIVE_FOLDERS: p10, CDS_ONEDRIVE_RUNNING: '0' }).out;
    const notOd = c10(RA, ['backup', '--status'], { CDS_ONEDRIVE_FOLDERS: 'none' }).out;
    check('P10: the sync line: in OneDrive and backed up daily / OneDrive isn\'t running / not in a synced folder',
      /Your memory is in OneDrive \(synced\) and backed up daily \(newest: /.test(inOd) && /OneDrive isn't running: your memory isn't syncing right now/.test(odOff) && /Your memory isn't in a synced folder: export it now and then/.test(notOd),
      `${inOd}\n${odOff}\n${notOd}`);
    const st2 = c10(RA, ['status']).out;
    check('P10: claudedev status ends with the memory\'s sync line', /Memory:\s+Your memory isn't in a synced folder/.test(st2), st2);

    // git, cloud and sync: removed, and say so (no command that silently does nothing).
    const g = c10(RA, ['git', 'status']), cl = c10(RA, ['cloud', 'upload']), sy = c10(RA, ['sync']);
    check('P10: git, cloud and sync are removed and say why and what to use (exit 1, nothing written)',
      [g, cl, sy].every(x => x.code === 1 && /removed in ClaudeDevStudio 1\.7\.0/.test(x.out) && /claudedev export/.test(x.out)) && !fs.existsSync(path.join(memA, '.cds-memory')), `${g.out}\n${cl.out}\n${sy.out}`);
    const leakedP10 = fs.existsSync(path.join(docs, 'ClaudeDevStudio', 'Projects', 'P10Proj')) || fs.existsSync(path.join(docs, 'ClaudeDevStudio', 'Projects', path.basename(p10)));
    check('P10: nothing of these checks reached the real store', !leakedP10, docs);
    try { fs.rmSync(p10, { recursive: true, force: true }); } catch { /* leave it */ }
  }
} catch (e) {
  check('no exception', false, e.stack || e.message);
} finally {
  await client.close().catch(() => {});
  try { fs.rmSync(memDir, { recursive: true, force: true }); } catch { /* leave it */ }
  try { if (createdLegacy) fs.rmSync(legacyDir, { recursive: true, force: true }); } catch { /* leave it */ }
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* leave it */ }
  for (const x of extraProjects) {
    try { fs.rmSync(x.mem, { recursive: true, force: true }); } catch { /* leave it */ }
    try { fs.rmSync(x.dir, { recursive: true, force: true }); } catch { /* leave it */ }
  }
  if (isolated) {
    try { fs.rmSync(storeRoot, { recursive: true, force: true }); } catch { /* leave it */ }
    try { fs.rmSync(isolatedLegacy, { recursive: true, force: true }); } catch { /* leave it */ }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
