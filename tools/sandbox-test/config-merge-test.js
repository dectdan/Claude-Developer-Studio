// Tests Installer\cds-config.js on throwaway files in %TEMP%. Never touches the real
// Claude Desktop config.
//
//   node tools\sandbox-test\config-merge-test.js

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'Installer', 'cds-config.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-config-test-'));
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const MCP = 'C:\\Users\\Someone\\AppData\\Local\\ClaudeDevStudio\\mcp-server';

let passed = 0, failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`); }
};
const run = (...args) => {
  try { execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' }); return 0; }
  catch (e) { return e.status; }
};
const install = (cfg, extra = []) => run('install', '--config', cfg, '--node', NODE, '--mcp', MCP, ...extra);
const uninstall = (cfg) => run('uninstall', '--config', cfg);
const bytes = (f) => fs.readFileSync(f);
const hasBom = (f) => { const b = bytes(f); return b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF; };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const backups = (dir) => fs.readdirSync(dir).filter(n => n.includes('.bak-cds-'));
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const seed = {
  mcpServers: {
    'keep-me': { command: 'cmd', args: ['/c', 'echo'] },
    'other': { command: 'C:\\tools\\x.exe', args: [], env: { TOKEN: 'abc', '名前': '✓ ünïcödé 🚀' } },
  },
  preferences: { sidebarMode: 'chat', nested: { a: [1, 2.5, null, true, 'x'] } },
  someOtherSetting: 42,
  coworkUserFilesPath: 'C:\\Users\\Someone\\Files',
};

try {
  // 1. Fresh install over an existing config with a BOM.
  let dir = path.join(root, 't1'); fs.mkdirSync(dir);
  let cfg = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(cfg, '\uFEFF' + JSON.stringify(seed, null, 2), 'utf8');
  const original = bytes(cfg);
  check('install exits 0', install(cfg) === 0);
  let c = read(cfg);
  check('keep-me unchanged', deepEq(c.mcpServers['keep-me'], seed.mcpServers['keep-me']));
  check('other server (with unicode env) unchanged', deepEq(c.mcpServers.other, seed.mcpServers.other));
  check('preferences, someOtherSetting, coworkUserFilesPath unchanged',
    deepEq(c.preferences, seed.preferences) && c.someOtherSetting === 42 && c.coworkUserFilesPath === seed.coworkUserFilesPath);
  check('both CDS entries with the full node path',
    c.mcpServers.claudedevstudio.command === NODE && c.mcpServers['cds-workbench'].command === NODE &&
    c.mcpServers.claudedevstudio.args[0] === path.join(MCP, 'index.js') && c.mcpServers['cds-workbench'].args[0] === path.join(MCP, 'workbench.js'));
  check('no BOM', !hasBom(cfg));
  const b = backups(dir);
  check('one backup, identical to the original', b.length === 1 && bytes(path.join(dir, b[0])).equals(original), b.join(', '));
  check('no temp file left', !fs.readdirSync(dir).some(n => n.includes('.tmp-cds-')));

  // 2. Install again: nothing twice, nothing rewritten.
  const before = bytes(cfg);
  check('second install exits 0', install(cfg) === 0);
  c = read(cfg);
  check('each CDS entry once, file unchanged', Object.keys(c.mcpServers).filter(k => k === 'claudedevstudio').length === 1 && bytes(cfg).equals(before));

  // 3. Upgrade from an old install with other paths: replaced in place, order kept.
  dir = path.join(root, 't3'); fs.mkdirSync(dir);
  cfg = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { a: { command: 'a' }, claudedevstudio: { command: 'node', args: ['old.js'] }, z: { command: 'z' } } }));
  check('upgrade exits 0', install(cfg) === 0);
  c = read(cfg);
  check('old CDS entry replaced in place', deepEq(Object.keys(c.mcpServers), ['a', 'claudedevstudio', 'z', 'cds-workbench']) && c.mcpServers.claudedevstudio.command === NODE);

  // 4. Invalid JSON: untouched, exit 2, manual steps written.
  dir = path.join(root, 't4'); fs.mkdirSync(dir);
  cfg = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(cfg, '{"mcpServers": {"x": 1,}');
  const bad = bytes(cfg);
  const manual = path.join(dir, 'manual.txt');
  check('invalid JSON: exit 2', install(cfg, ['--manual', manual]) === 2);
  check('invalid JSON: file untouched, no backup', bytes(cfg).equals(bad) && backups(dir).length === 0);
  check('invalid JSON: manual steps name both entries', fs.existsSync(manual) && /claudedevstudio/.test(fs.readFileSync(manual, 'utf8')) && /cds-workbench/.test(fs.readFileSync(manual, 'utf8')));
  check('invalid JSON: uninstall exit 2, untouched', uninstall(cfg) === 2 && bytes(cfg).equals(bad));

  // 5. mcpServers of the wrong type: untouched.
  fs.writeFileSync(cfg, '{"mcpServers": [1,2]}');
  check('mcpServers not an object: exit 2, untouched', install(cfg) === 2 && fs.readFileSync(cfg, 'utf8') === '{"mcpServers": [1,2]}');

  // 6. No Claude folder yet: created.
  cfg = path.join(root, 't6', 'Claude', 'claude_desktop_config.json');
  check('no folder: exit 0', install(cfg) === 0);
  c = read(cfg);
  check('no folder: file created with just the two entries', deepEq(Object.keys(c), ['mcpServers']) && deepEq(Object.keys(c.mcpServers), ['claudedevstudio', 'cds-workbench']) && !hasBom(cfg));

  // 6b. Never set up: install twice (a backup), uninstall removes the folder it made; with any other file there it stays.
  install(cfg);
  check('no folder: uninstall removes the folder CDS created (only its file and backups were there)',
    uninstall(cfg) === 0 && !fs.existsSync(path.dirname(cfg)));
  check('no folder: install again recreates it', install(cfg) === 0 && fs.existsSync(cfg));
  fs.writeFileSync(path.join(path.dirname(cfg), 'config.json'), '{"claude":"was here"}');
  check('no folder: once Claude Desktop has written its own file there, uninstall keeps the folder',
    uninstall(cfg) === 0 && fs.existsSync(path.join(path.dirname(cfg), 'config.json')) && deepEq(read(cfg), { mcpServers: {} }));

  // 7. Empty file counts as {}.
  dir = path.join(root, 't7'); fs.mkdirSync(dir);
  cfg = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(cfg, '');
  check('empty file: exit 0 and entries written', install(cfg) === 0 && read(cfg).mcpServers.claudedevstudio);

  // 8. Uninstall removes only CDS's entries.
  cfg = path.join(root, 't1', 'claude_desktop_config.json');
  const nBefore = backups(path.join(root, 't1')).length;
  check('uninstall exits 0', uninstall(cfg) === 0);
  c = read(cfg);
  check('uninstall: CDS entries gone', !c.mcpServers.claudedevstudio && !c.mcpServers['cds-workbench']);
  check('uninstall: everything else equals the seed', deepEq(c, seed));
  check('uninstall: no BOM, one more backup', !hasBom(cfg) && backups(path.join(root, 't1')).length === nBefore + 1);
  const after = bytes(cfg);
  check('uninstall again: nothing to do, file unchanged', uninstall(cfg) === 0 && bytes(cfg).equals(after));
  check('uninstall with no file: exit 0', uninstall(path.join(root, 'none', 'claude_desktop_config.json')) === 0);

  // 9. Old Claude Extensions registration is removed; other extensions kept.
  dir = path.join(root, 't9'); fs.mkdirSync(dir);
  cfg = path.join(dir, 'claude_desktop_config.json');
  const id = 'ant.dir.gh.dectdan.claudedevstudio';
  fs.mkdirSync(path.join(dir, 'Claude Extensions', id), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Claude Extensions', id, 'manifest.json'), '{}');
  fs.mkdirSync(path.join(dir, 'Claude Extensions Settings'));
  fs.writeFileSync(path.join(dir, 'Claude Extensions Settings', `${id}.json`), '{}');
  fs.writeFileSync(path.join(dir, 'extensions-installations.json'), JSON.stringify({ extensions: { [id]: { v: 1 }, 'someone.else': { v: 2 } }, other: true }));
  check('legacy: install exits 0', install(cfg) === 0);
  const inst = read(path.join(dir, 'extensions-installations.json'));
  check('legacy: CDS extension removed, others kept',
    !fs.existsSync(path.join(dir, 'Claude Extensions', id)) && !fs.existsSync(path.join(dir, 'Claude Extensions Settings', `${id}.json`)) &&
    deepEq(inst, { extensions: { 'someone.else': { v: 2 } }, other: true }) && !hasBom(path.join(dir, 'extensions-installations.json')));

  // 10. The packaged (MSIX) Claude Desktop's own copy (P5): same rules, its own backup.
  dir = path.join(root, 't10'); fs.mkdirSync(dir);
  cfg = path.join(dir, 'Roaming', 'Claude', 'claude_desktop_config.json');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { real: { command: 'r' } } }));
  const pkgs = path.join(dir, 'Packages');
  const pkgCfg = path.join(pkgs, 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
  fs.mkdirSync(path.dirname(pkgCfg), { recursive: true });
  fs.writeFileSync(pkgCfg, JSON.stringify({ mcpServers: { boxed: { command: 'b' } }, preferences: { x: 1 } }));
  const noFile = path.join(pkgs, 'Claude_otherid', 'LocalCache', 'Roaming', 'Claude'); // a package folder without the file
  fs.mkdirSync(noFile, { recursive: true });
  fs.mkdirSync(path.join(pkgs, 'NotClaude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude'), { recursive: true });
  fs.writeFileSync(path.join(pkgs, 'NotClaude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'), '{}');
  check('packaged: install exits 0', install(cfg, ['--packages', pkgs]) === 0);
  const pc = read(pkgCfg), rc = read(cfg);
  check('packaged: the package copy gets both entries and keeps its own',
    deepEq(Object.keys(pc.mcpServers), ['boxed', 'claudedevstudio', 'cds-workbench']) && deepEq(pc.preferences, { x: 1 }) && backups(path.dirname(pkgCfg)).length === 1);
  check('packaged: the real file is handled too', deepEq(Object.keys(rc.mcpServers), ['real', 'claudedevstudio', 'cds-workbench']));
  check('packaged: no file is created in a package folder without one, nor in another app\'s package',
    fs.readdirSync(noFile).length === 0 && fs.readFileSync(path.join(pkgs, 'NotClaude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'), 'utf8') === '{}');
  check('packaged: uninstall removes the entries from both', run('uninstall', '--config', cfg, '--packages', pkgs) === 0 &&
    deepEq(read(pkgCfg), { mcpServers: { boxed: { command: 'b' } }, preferences: { x: 1 } }) && deepEq(read(cfg), { mcpServers: { real: { command: 'r' } } }));
  fs.writeFileSync(pkgCfg, '{ not json');
  check('packaged: an invalid package copy is left untouched (exit 2), the real file still updated',
    install(cfg, ['--packages', pkgs]) === 2 && fs.readFileSync(pkgCfg, 'utf8') === '{ not json' && read(cfg).mcpServers.claudedevstudio);
  const pkgBytes = bytes(cfg);
  check('packaged: a --config that is not the default %APPDATA% path looks at no packages unless asked',
    install(cfg) === 0 && fs.readFileSync(pkgCfg, 'utf8') === '{ not json' && bytes(cfg).equals(pkgBytes));
} catch (e) {
  check('no exception', false, e.stack);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
