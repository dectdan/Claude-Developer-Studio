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

// More throwaway projects (P3): each is a folder in %TEMP% with a memory folder of the same name.
const extraProjects = [];
const makeProject = (suffix) => {
  const name = `${scratchName}_${suffix}`;
  const dir = path.join(os.tmpdir(), name);
  fs.mkdirSync(dir, { recursive: true });
  const mem = path.join(docs, 'ClaudeDevStudio', 'Projects', name);
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
const TOOL_COUNT = 12; // 9 before P3 + claudedev_scaffold, claudedev_handoff, claudedev_record_decision

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
  check(`lists ${TOOL_COUNT} tools`, tools.length === TOOL_COUNT, tools.map(t => t.name).join(', '));
  check('server sends instructions', /claudedev_load/.test(client.getInstructions() || ''));

  let r = await call('claudedev_load', { project_path: scratch + '\\' });
  check('load creates memory for a new project (trailing backslash ok)', !r.isError && /created just now/.test(r.text) && fs.existsSync(path.join(memDir, 'session_state.json')), r.text);
  check('memory is in the real Documents folder', r.text.includes(memDir), r.text);
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
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
