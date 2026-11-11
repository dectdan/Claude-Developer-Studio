// Tests Installer\cds-claude-code.js on throwaway files in %TEMP%. Never touches the real
// Claude Code settings (~/.claude/settings.json) or ~/.claude.json: every run passes --settings
// and --claude-json, so the claude CLI is never used.
//
//   node tools\sandbox-test\claude-code-setup-test.js

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'Installer', 'cds-claude-code.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-claude-code-test-'));
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const MCP = 'C:\\Users\\Someone\\AppData\\Local\\ClaudeDevStudio\\mcp-server';

let passed = 0, failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}${detail ? `\n      ${String(detail).split('\n').join('\n      ')}` : ''}`); }
};
const run = (action, dir, extra = []) => {
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  const r = spawnSync(process.execPath, [script, action, '--node', NODE, '--mcp', MCP,
    '--settings', path.join(dir, 'settings.json'), '--claude-json', path.join(dir, '.claude.json'), ...extra],
    { encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const bytes = (f) => fs.readFileSync(f);
const hasBom = (f) => { const b = bytes(f); return b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF; };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const backups = (dir) => fs.readdirSync(dir).filter(n => n.includes('.bak-cds-')).sort();
const isCds = (h) => [h.command, ...(h.args || [])].some(x => String(x).includes('cds-hook.js'));
const countCds = (s) => Object.values(s.hooks || {}).flat().flatMap(g => g.hooks || []).filter(isCds).length;

const seedSettings = {
  $schema: 'https://json.schemastore.org/claude-code-settings.json',
  permissions: { allow: ['Bash(npm run lint)'], deny: ['Read(./.env)'] },
  hooks: {
    PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'prettier --write "$FILE"' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
  },
  model: 'claude-opus-5-5',
  someOtherKey: { nested: [1, 'two', null, true], 'ünïcödé': '✓ 🚀' },
};
const seedClaudeJson = {
  numStartups: 12,
  mcpServers: { 'keep-me': { type: 'stdio', command: 'cmd', args: ['/c', 'echo'], env: { TOKEN: 'abc' } } },
  projects: { 'C:\\Work\\app': { allowedTools: [], mcpServers: {} } },
};

function seed(dir, { indent = 2, eol = '\n' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const fmt = (o) => JSON.stringify(o, null, indent).replace(/\n/g, eol) + eol;
  fs.writeFileSync(path.join(dir, 'settings.json'), fmt(seedSettings), 'utf8');
  fs.writeFileSync(path.join(dir, '.claude.json'), fmt(seedClaudeJson), 'utf8');
  return { s: bytes(path.join(dir, 'settings.json')), c: bytes(path.join(dir, '.claude.json')) };
}

// --- 1. Setup on seeded files ---
const d1 = path.join(root, 'seeded');
const orig = seed(d1);
let r = run('setup', d1);
const S = path.join(d1, 'settings.json'), C = path.join(d1, '.claude.json');
const s1 = read(S), c1 = read(C);
check('setup exits 0', r.code === 0, r.out);
check('CDS servers registered once each, at user scope (top-level mcpServers), node + script',
  c1.mcpServers.claudedevstudio.command === NODE && c1.mcpServers.claudedevstudio.args[0] === `${MCP}\\index.js` &&
  c1.mcpServers['cds-workbench'].args[0] === `${MCP}\\workbench.js` && Object.keys(c1.mcpServers).length === 3, JSON.stringify(c1.mcpServers));
check('the unrelated MCP server and every other key in .claude.json unchanged',
  JSON.stringify(c1.mcpServers['keep-me']) === JSON.stringify(seedClaudeJson.mcpServers['keep-me']) && c1.numStartups === 12 &&
  JSON.stringify(c1.projects) === JSON.stringify(seedClaudeJson.projects));
check('four CDS hooks, once each, exec form (node.exe + cds-hook.js + event)',
  countCds(s1) === 4 &&
  ['SessionStart:session-start', 'PreCompact:pre-compact', 'SessionEnd:session-end', 'PostToolUse:post-tool-use'].every(x => {
    const [ev, arg] = x.split(':');
    const hs = (s1.hooks[ev] || []).flatMap(g => g.hooks).filter(isCds);
    return hs.length === 1 && hs[0].command === NODE && hs[0].args[0] === `${MCP}\\cds-hook.js` && hs[0].args[1] === arg && hs[0].type === 'command';
  }), JSON.stringify(s1.hooks, null, 1));
const grp = (ev) => s1.hooks[ev].find(g => g.hooks.some(isCds));
check('matchers and timing: SessionStart startup|clear|compact (timeout 15), PreCompact async, SessionEnd timeout 5, PostToolUse Edit|Write|MultiEdit|NotebookEdit async',
  grp('SessionStart').matcher === 'startup|clear|compact' && grp('SessionStart').hooks[0].timeout === 15 &&
  grp('PreCompact').matcher === 'manual|auto' && grp('PreCompact').hooks[0].async === true &&
  grp('SessionEnd').matcher === undefined && grp('SessionEnd').hooks[0].timeout === 5 &&
  grp('PostToolUse').matcher === 'Edit|Write|MultiEdit|NotebookEdit' && grp('PostToolUse').hooks[0].async === true);
check('the unrelated hooks, permissions and other keys in settings.json unchanged',
  JSON.stringify(s1.permissions) === JSON.stringify(seedSettings.permissions) &&
  JSON.stringify(s1.hooks.Stop) === JSON.stringify(seedSettings.hooks.Stop) &&
  JSON.stringify(s1.hooks.PostToolUse[0]) === JSON.stringify(seedSettings.hooks.PostToolUse[0]) &&
  s1.model === seedSettings.model && JSON.stringify(s1.someOtherKey) === JSON.stringify(seedSettings.someOtherKey) && s1.$schema === seedSettings.$schema);
check('no BOM in either file', !hasBom(S) && !hasBom(C));
const b1 = backups(d1);
check('both files backed up first, and each backup equals the file before setup',
  b1.length === 2 && bytes(path.join(d1, b1.find(n => n.startsWith('.claude.json')))).equals(orig.c) &&
  bytes(path.join(d1, b1.find(n => n.startsWith('settings.json')))).equals(orig.s), b1.join(', '));

// --- 2. Setup again: nothing changes ---
const after1 = { s: bytes(S), c: bytes(C) };
r = run('setup', d1);
check('setup a second time exits 0, changes nothing and makes no new backup',
  r.code === 0 && bytes(S).equals(after1.s) && bytes(C).equals(after1.c) && backups(d1).length === 2 && /already/.test(r.out), r.out);

// --- 3. Status ---
r = run('status', d1);
check('status reports both servers and all four hooks',
  r.code === 0 && (r.out.match(/registered \(user scope\)/g) || []).length === 2 && (r.out.match(/: set up/g) || []).length === 4, r.out);

// --- 4. Remove: back to exactly the seed ---
r = run('remove', d1);
check('remove exits 0', r.code === 0, r.out);
check('remove restores settings.json byte for byte', bytes(S).equals(orig.s), fs.readFileSync(S, 'utf8'));
check('remove restores .claude.json byte for byte', bytes(C).equals(orig.c), fs.readFileSync(C, 'utf8'));
check('remove backed up both files first', backups(d1).length === 4, backups(d1).join(', '));
const nb = backups(d1).length;
r = run('remove', d1);
check('remove a second time changes nothing', r.code === 0 && bytes(S).equals(orig.s) && bytes(C).equals(orig.c) && backups(d1).length === nb, r.out);
r = run('status', d1);
check('status after remove: nothing set up', (r.out.match(/not registered/g) || []).length === 2 && (r.out.match(/not set up/g) || []).length === 4, r.out);

// --- 5. Another file style: 4-space indent, CRLF; round trip exact ---
const d2 = path.join(root, 'crlf');
const orig2 = seed(d2, { indent: 4, eol: '\r\n' });
run('setup', d2);
const txt = fs.readFileSync(path.join(d2, 'settings.json'), 'utf8');
check('setup keeps the file\'s own indentation and line endings', /\r\n {4}"\$schema"/.test(txt) && !/[^\r]\n/.test(txt), txt.slice(0, 120));
run('remove', d2);
check('a CRLF, 4-space file comes back byte for byte after remove',
  bytes(path.join(d2, 'settings.json')).equals(orig2.s) && bytes(path.join(d2, '.claude.json')).equals(orig2.c));

// --- 6. No files at all ---
const d3 = path.join(root, 'empty');
fs.mkdirSync(d3);
r = run('setup', d3);
const s3 = read(path.join(d3, 'settings.json')), c3 = read(path.join(d3, '.claude.json'));
check('setup with no files creates both (no backup needed), each with only CDS\'s entries',
  r.code === 0 && countCds(s3) === 4 && Object.keys(s3).join() === 'hooks' && Object.keys(c3.mcpServers).length === 2 && backups(d3).length === 0, r.out);
run('remove', d3);
check('remove then leaves both as {} (no CDS keys left)', JSON.stringify(read(path.join(d3, 'settings.json'))) === '{}' && JSON.stringify(read(path.join(d3, '.claude.json'))) === '{}');

// --- 7. Invalid JSON: nothing changed in either file ---
const d4 = path.join(root, 'invalid');
seed(d4);
fs.writeFileSync(path.join(d4, 'settings.json'), '{ "hooks": { oops }', 'utf8');
const inv = { s: bytes(path.join(d4, 'settings.json')), c: bytes(path.join(d4, '.claude.json')) };
r = run('setup', d4);
check('invalid settings.json: setup exits 2 and changes neither file',
  r.code === 2 && bytes(path.join(d4, 'settings.json')).equals(inv.s) && bytes(path.join(d4, '.claude.json')).equals(inv.c) && backups(d4).length === 0 && /NOT CHANGED/.test(r.out), r.out);
r = run('remove', d4);
check('invalid settings.json: remove exits 2 and changes nothing', r.code === 2 && bytes(path.join(d4, 'settings.json')).equals(inv.s), r.out);
const d5 = path.join(root, 'badhooks');
seed(d5);
fs.writeFileSync(path.join(d5, 'settings.json'), JSON.stringify({ hooks: { SessionStart: 'not a list' } }, null, 2) + '\n', 'utf8');
r = run('setup', d5);
check('a "hooks" event that is not a list: exit 2, nothing changed', r.code === 2 && backups(d5).length === 0, r.out);

// --- 8. A user hook placed after CDS's keeps the order on a second setup; a moved install is updated in place ---
const d6 = path.join(root, 'order');
seed(d6);
run('setup', d6);
const s6 = read(path.join(d6, 'settings.json'));
s6.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'echo mine' }] });
fs.writeFileSync(path.join(d6, 'settings.json'), JSON.stringify(s6, null, 2) + '\n', 'utf8');
const before6 = bytes(path.join(d6, 'settings.json'));
run('setup', d6);
check('setup again keeps a hook the user added after CDS\'s, in its place', bytes(path.join(d6, 'settings.json')).equals(before6));
const r6 = spawnSync(process.execPath, [script, 'setup', '--node', NODE, '--mcp', 'D:\\Elsewhere\\mcp-server', '--settings', path.join(d6, 'settings.json'), '--claude-json', path.join(d6, '.claude.json')], { encoding: 'utf8' });
const s6b = read(path.join(d6, 'settings.json'));
check('setup from a new install folder replaces CDS\'s entries in place (still once each)',
  r6.status === 0 && countCds(s6b) === 4 && s6b.hooks.SessionStart[0].hooks[0].args[0] === 'D:\\Elsewhere\\mcp-server\\cds-hook.js' &&
  s6b.hooks.SessionStart[1].hooks[0].command === 'echo mine' && read(path.join(d6, '.claude.json')).mcpServers.claudedevstudio.args[0] === 'D:\\Elsewhere\\mcp-server\\index.js');

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
