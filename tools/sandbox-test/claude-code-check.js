// claude-code-check.js -- helper for sandbox scenario E (Claude Code setup). Run with the
// installed Node, inside Windows Sandbox only. Prints one JSON object.
//
//   node claude-code-check.js files <settings.json> <.claude.json> <seed settings> <seed .claude.json> expect-cds|expect-seed <install dir>
//   node claude-code-check.js hooks <settings.json> <project dir> <transcript fixture> <memory root>
//
// "hooks" runs every CDS hook command exactly as settings.json has it (command + args, no shell,
// as Claude Code's exec form does) with sample input on stdin, the way Claude Code would.

'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const out = (o) => { process.stdout.write(JSON.stringify(o)); };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const hasBom = (f) => { const b = fs.readFileSync(f); return b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF; };
const isCds = (h) => h && [h.command, ...(Array.isArray(h.args) ? h.args : [])].some(x => typeof x === 'string' && x.toLowerCase().includes('cds-hook.js'));
const SERVERS = ['claudedevstudio', 'cds-workbench'];
const EVENTS = { SessionStart: 'session-start', PreCompact: 'pre-compact', SessionEnd: 'session-end', PostToolUse: 'post-tool-use' };

function withoutCds(s) {
  const c = JSON.parse(JSON.stringify(s));
  if (!c.hooks) return c;
  for (const ev of Object.keys(c.hooks)) {
    c.hooks[ev] = c.hooks[ev].map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isCds(h)) })).filter(g => g.hooks.length);
    if (!c.hooks[ev].length) delete c.hooks[ev];
  }
  if (!Object.keys(c.hooks).length) delete c.hooks;
  return c;
}

function files([settingsF, claudeF, seedS, seedC, mode, installDir]) {
  const problems = [];
  const info = {};
  if (mode === 'expect-seed') {
    const sSame = fs.readFileSync(settingsF).equals(fs.readFileSync(seedS));
    const cSame = fs.readFileSync(claudeF).equals(fs.readFileSync(seedC));
    if (!sSame) problems.push('settings.json differs from the seed');
    if (!cSame) problems.push('.claude.json differs from the seed');
    return out({ ok: !problems.length, problems, settingsSame: sSame, claudeJsonSame: cSame });
  }
  let s, c;
  try { s = read(settingsF); } catch (e) { problems.push(`settings.json: ${e.message}`); }
  try { c = read(claudeF); } catch (e) { problems.push(`.claude.json: ${e.message}`); }
  if (s && c) {
    const handlers = [];
    for (const [ev, groups] of Object.entries(s.hooks || {})) for (const g of groups) for (const h of g.hooks || []) if (isCds(h)) handlers.push({ ev, h, matcher: g.matcher });
    info.cdsHooks = handlers.map(x => `${x.ev}:${x.h.args[1]}`);
    for (const [ev, arg] of Object.entries(EVENTS)) {
      const hs = handlers.filter(x => x.ev === ev);
      if (hs.length !== 1) { problems.push(`${ev}: ${hs.length} CDS hooks (want 1)`); continue; }
      const h = hs[0].h;
      if (h.type !== 'command' || !fs.existsSync(h.command) || h.args[1] !== arg || !fs.existsSync(h.args[0])) problems.push(`${ev}: bad handler ${JSON.stringify(h)}`);
      if (installDir && path.resolve(h.args[0]).toLowerCase() !== path.join(installDir, 'mcp-server', 'cds-hook.js').toLowerCase()) problems.push(`${ev}: hook script ${h.args[0]} is not the installed one`);
    }
    if (handlers.length !== 4) problems.push(`${handlers.length} CDS hooks in all (want 4)`);
    for (const n of SERVERS) {
      const e = c.mcpServers && c.mcpServers[n];
      if (!e || !fs.existsSync(e.command) || !e.args || !fs.existsSync(e.args[0])) problems.push(`server ${n}: ${JSON.stringify(e)}`);
    }
    info.servers = Object.keys(c.mcpServers || {});
    const restS = withoutCds(s);
    const restC = JSON.parse(JSON.stringify(c));
    for (const n of SERVERS) if (restC.mcpServers) delete restC.mcpServers[n];
    if (JSON.stringify(restS) !== JSON.stringify(read(seedS))) problems.push('settings.json: something other than CDS\'s hooks changed');
    if (JSON.stringify(restC) !== JSON.stringify(read(seedC))) problems.push('.claude.json: something other than CDS\'s servers changed');
    info.bom = hasBom(settingsF) || hasBom(claudeF);
    if (info.bom) problems.push('a BOM');
  }
  out({ ok: !problems.length, problems, ...info });
}

async function hooks([settingsF, project, fixture, memRoot]) {
  const s = read(settingsF);
  const handler = {};
  for (const [ev, groups] of Object.entries(s.hooks || {})) for (const g of groups) for (const h of g.hooks || []) if (isCds(h)) handler[h.args[1]] = h;
  const run = (event, input, projectDir) => {
    const h = handler[event];
    if (!h) return { code: -1, out: '', ms: 0, missing: true };
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir;
    const t0 = Date.now();
    const r = spawnSync(h.command, h.args, { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env, windowsHide: true, timeout: 60000 });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '', ms: Date.now() - t0 };
  };
  const mem = path.join(memRoot, 'ClaudeDevStudio', 'Projects', path.basename(project));
  const base = (ev) => ({ session_id: 'sandbox-e', transcript_path: '', cwd: project, hook_event_name: ev });
  const checks = [];
  const check = (name, ok, evidence) => checks.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 600) });

  let r = run('session-start', { ...base('SessionStart'), source: 'startup' }, project);
  check(`session-start prints load's context (header first, ${r.out.length} chars <= 9500, ${r.ms} ms)`,
    r.code === 0 && r.out.startsWith(`=== ClaudeDevStudio: ${path.basename(project)} ===`) && r.out.length <= 9500 && fs.existsSync(path.join(mem, 'session_state.json')),
    `exit ${r.code}; ${r.out.slice(0, 160)} ${r.err}`);

  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const sysMem = path.join(memRoot, 'ClaudeDevStudio', 'Projects', 'System32');
  r = run('session-start', { ...base('SessionStart'), cwd: sys32, source: 'startup' }, null);
  const r2 = run('session-start', { ...base('SessionStart'), cwd: sys32, source: 'startup' }, sys32);
  check('session-start from C:\\Windows\\System32 prints nothing and creates no memory folder', r.code === 0 && r2.code === 0 && r.out === '' && r2.out === '' && !fs.existsSync(sysMem), `exit ${r.code}/${r2.code}; out ${r.out.length}/${r2.out.length}; System32 memory folder: ${fs.existsSync(sysMem)}`);

  const edits = () => {
    const d = path.join(mem, 'Activity');
    return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.jsonl')).flatMap(f => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))).filter(a => a.action === 'file_edit') : [];
  };
  const file = path.join(project, 'src', 'app.js');
  const ptu = () => ({ ...base('PostToolUse'), tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, tool_response: { filePath: file, success: true } });
  // As Claude Code runs async hooks: started together, not waited for one by one.
  const h = handler['post-tool-use'];
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project };
  const codes = await Promise.all([0, 1, 2].map(() => new Promise(res => { const c = spawn(h.command, h.args, { env, windowsHide: true }); c.on('exit', res); c.stdin.end(JSON.stringify(ptu())); })));
  const e = edits();
  check('post-tool-use (async, three at once for one file) records one activity line', codes.every(x => x === 0) && e.length === 1 && e[0].file === 'src\\app.js', `codes ${codes.join(',')}; ${JSON.stringify(e)}`);

  const transcript = path.join(path.dirname(settingsF), 'sandbox-transcript.jsonl');
  fs.writeFileSync(transcript, fs.readFileSync(fixture, 'utf8').replace(/\{\{PROJECT\}\}/g, project.replace(/\\/g, '\\\\')), 'utf8');
  r = run('session-end', { ...base('SessionEnd'), reason: 'prompt_input_exit', transcript_path: transcript }, project);
  const md = fs.existsSync(path.join(mem, 'session_handoff.md')) ? fs.readFileSync(path.join(mem, 'session_handoff.md'), 'utf8') : '';
  check(`session-end writes an automatic handoff within 1.5 s (${r.ms} ms)`, r.code === 0 && r.out === '' && r.ms < 1500 && /^<!-- cds-handoff: auto -->/.test(md) && md.includes('src\\parser.js'), `exit ${r.code}; ${md.slice(0, 300)}`);

  const n = fs.readFileSync(path.join(mem, 'HANDOFFS.jsonl'), 'utf8').split('\n').filter(Boolean).length;
  r = run('pre-compact', { ...base('PreCompact'), trigger: 'auto', custom_instructions: null, transcript_path: path.join(project, 'no-such-transcript.jsonl') }, project);
  const n2 = fs.readFileSync(path.join(mem, 'HANDOFFS.jsonl'), 'utf8').split('\n').filter(Boolean).length;
  check('pre-compact with an unreadable transcript writes nothing, prints nothing, exits 0', r.code === 0 && r.out === '' && n2 === n, `exit ${r.code}; handoffs ${n} -> ${n2}`);
  try { fs.unlinkSync(transcript); } catch { /* leave it */ }
  out({ ok: checks.every(c => c.ok), checks });
}

const [cmd, ...rest] = process.argv.slice(2);
(async () => {
  try {
    if (cmd === 'files') files(rest);
    else if (cmd === 'hooks') await hooks(rest);
    else out({ ok: false, problems: [`unknown command ${cmd}`] });
  } catch (e) { out({ ok: false, problems: [e.stack || e.message] }); }
})();
