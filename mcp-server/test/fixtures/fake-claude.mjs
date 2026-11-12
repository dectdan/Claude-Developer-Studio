// A fake Claude Code for smoke.mjs's phase checks (P7): CDS_PHASE_CLAUDE points the workbench at it.
// It answers --version, and for a run writes a stream-json log to stdout the way `claude -p
// --output-format stream-json --verbose` does: a system init event, assistant text and tool_use
// events, user tool_result events (one a permission denial), and a result event with a session id.
//
// What it does comes from the phase's prompt file (a line "FAKE_MODE: <mode>"):
//   normal    finishes at once and writes docs\<phase>_OUTPUT.md
//   question  finishes with a result that asks a question (no OUTPUT file)
//   slow      like normal, after 4 seconds
//   forever   starts a child process (its pid in docs\fake_child.pid) and runs until killed
//   error     writes to stderr, ends with an error result, exit code 1
//   stubborn  like forever, but ignores Ctrl+C (so Stop must fall back to force)
// With --resume <id> (a reply) it continues that session id and answers the message read from
// stdin (or the prompt argument). Every call is recorded in docs\fake_calls.jsonl (argv, prompt,
// whether it came on stdin, a marker variable, the P8 environment settings) so the test can check
// the flags and environment it got.
// Ctrl+C (P8): like the real Claude Code 2.1.322 (seen in P8), it ends the turn: a user message
// "[Request interrupted by user for tool use]", a result error_during_execution with
// terminal_reason aborted_tools, then "runs its SessionEnd hooks" (writes docs\fake_session_end.txt)
// and exits 0. Each Ctrl+C it gets is a line in docs\fake_signals.jsonl.
// It writes nothing outside the project's docs\ folder. Its version: fake-version.txt beside it,
// else 2.1.322.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

if (argv.includes('--version')) {
  let v = '2.1.322';
  try { v = fs.readFileSync(path.join(here, 'fake-version.txt'), 'utf8').trim() || v; } catch { /* default */ }
  process.stdout.write(`${v} (Claude Code)\n`);
  process.exit(0);
}

const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const VALUE_FLAGS = new Set(['--resume', '--model', '--effort', '--permission-mode', '--allowedTools', '--mcp-config', '--output-format']);
let prompt = null;
for (let i = 0; i < argv.length; i++) {
  if (VALUE_FLAGS.has(argv[i])) { i++; continue; }
  if (argv[i].startsWith('-')) continue;
  prompt = argv[i]; break;
}
let fromStdin = false;
if (prompt == null) {
  try { prompt = fs.readFileSync(0, 'utf8'); fromStdin = true; } catch { prompt = ''; }
}

const docs = path.join(process.cwd(), 'docs');
const resume = opt('--resume');
const sessionId = resume || crypto.randomUUID();
fs.appendFileSync(path.join(docs, 'fake_calls.jsonl'), JSON.stringify({
  argv, prompt, fromStdin, pid: process.pid, cwd: process.cwd(),
  mark: process.env.CDS_FAKE_MARK || null, claudecode: process.env.CLAUDECODE || null, project_dir: process.env.CLAUDE_PROJECT_DIR || null,
  bg_wait_ceiling: process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS || null, bash_max_timeout: process.env.BASH_MAX_TIMEOUT_MS || null,
}) + '\n');

const phase = (/docs\\(.+?)_prompt\.md/.exec(prompt || '') || [])[1] || null;
let mode = resume ? 'continue' : 'normal';
if (!resume && phase) {
  try { mode = (/FAKE_MODE:\s*(\w+)/.exec(fs.readFileSync(path.join(docs, `${phase}_prompt.md`), 'utf8')) || [])[1] || 'normal'; } catch { /* normal */ }
}

const t0 = Date.now();
const emit = (o) => process.stdout.write(JSON.stringify({ ...o, session_id: sessionId }) + '\n');
const say = (text) => emit({ type: 'assistant', parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'text', text }] } });
const tool = (id, name, input) => emit({ type: 'assistant', parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError) => emit({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!isError }] } });
const result = (text, extra = {}) => emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, duration_ms: Date.now() - t0, result: text, permission_denials: [], ...extra });

for (const sig of ['SIGINT', 'SIGBREAK']) {
  process.on(sig, () => {
    fs.appendFileSync(path.join(docs, 'fake_signals.jsonl'), JSON.stringify({ signal: sig, pid: process.pid, mode, at: new Date().toISOString() }) + '\n');
    if (mode === 'stubborn') return;
    emit({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
    emit({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_tools', num_turns: 3, duration_ms: Date.now() - t0, result: '' });
    fs.writeFileSync(path.join(docs, 'fake_session_end.txt'), `SessionEnd ran after ${sig}\n`, 'utf8');
    setTimeout(() => process.exit(0), 100);
  });
}

emit({ type: 'system', subtype: 'init', cwd: process.cwd(), model: opt('--model') || 'fake-default-model', permissionMode: opt('--permission-mode'), tools: ['Read', 'Write', 'Bash'], mcp_servers: [{ name: 'claudedevstudio', status: 'connected' }] });

const finishNormal = () => {
  say(`Reading docs\\${phase}_prompt.md.`);
  tool('t1', 'Read', { file_path: `docs\\${phase}_prompt.md` });
  toolResult('t1', 'FAKE_MODE: ...');
  tool('t2', 'Bash', { command: 'curl https://example.com' });
  toolResult('t2', 'Claude requested permissions to use Bash, but you haven\'t granted it yet.', true);
  if (mode !== 'question') fs.writeFileSync(path.join(docs, `${phase}_OUTPUT.md`), `# ${phase} output\n\nFake.\n`, 'utf8');
  say('Wrote the output file.');
  result(mode === 'question' ? 'I made the file. Should I also add a test for it?' : `Done: wrote docs\\${phase}_OUTPUT.md.`,
    { permission_denials: [{ tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'curl https://example.com' } }] });
};

if (mode === 'continue') {
  say('Continuing.');
  tool('t9', 'Write', { file_path: 'docs\\reply.txt' });
  fs.writeFileSync(path.join(docs, 'reply.txt'), prompt, 'utf8');
  toolResult('t9', 'ok');
  result(`Continued: ${String(prompt).trim()}`, { num_turns: 2 });
} else if (mode === 'forever' || mode === 'stubborn') {
  // The child ignores Ctrl+C (P8): something the run started that outlives Claude Code, which Stop must end.
  const child = spawn(process.execPath, ['-e', "for (const s of ['SIGINT', 'SIGBREAK']) process.on(s, () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore', windowsHide: true });
  fs.writeFileSync(path.join(docs, 'fake_child.pid'), String(child.pid), 'utf8');
  say('Working on a long task.');
  tool('t1', 'Read', { file_path: 'README.md' });
  toolResult('t1', 'readme');
  setInterval(() => say('Still working.'), 2000);
} else if (mode === 'error') {
  process.stderr.write('fake claude: something went wrong\n');
  say('Something failed.');
  emit({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 1, duration_ms: Date.now() - t0, result: 'Error: the fake failed on purpose.' });
  process.exitCode = 1;
} else if (mode === 'slow') {
  say('Starting a slow one.');
  setTimeout(finishNormal, 4000);
} else {
  finishNormal();
}
