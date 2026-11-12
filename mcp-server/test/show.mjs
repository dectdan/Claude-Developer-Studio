// Prints what a tool returns, its length in characters and how long it took, for eyeballing output.
// Read-only tools only (claudedev_load also saves the project's session_state.json, as every load does).
//   node mcp-server\test\show.mjs <tool> <project_path> [action_description]
//   node mcp-server\test\show.mjs claudedev_search "<query>" [project_path|-] [kinds,comma,separated|-] [limit]
//   node mcp-server\test\show.mjs --tools [path\to\index.js]   (the size of tools/list and the instructions)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const besideMe = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

if (argv[0] === '--tools') {
  const serverPath = argv[1] ? path.resolve(argv[1]) : besideMe;
  const client = new Client({ name: 'cds-show', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'ignore' }));
  const { tools } = await client.listTools();
  const json = JSON.stringify({ tools });
  console.log(`${tools.length} tools; tools/list ${Buffer.byteLength(json, 'utf8')} bytes; instructions ${(client.getInstructions() || '').length} characters`);
  console.log(tools.map(t => t.name).join(', '));
  await client.close();
  process.exit(0);
}

const [tool = 'claudedev_load', target = process.cwd(), extra, extra2, extra3] = argv;
if (!['claudedev_load', 'claudedev_stats', 'claudedev_check_mistake', 'claudedev_search'].includes(tool)) {
  console.error('show.mjs runs only claudedev_load, claudedev_stats, claudedev_check_mistake or claudedev_search.');
  process.exit(2);
}
const client = new Client({ name: 'cds-show', version: '1.0.0' });
// The SDK passes only a few environment variables to the server: hand on the test-only CDS_* ones
// (CDS_CLI_PATH, CDS_MEMORY_ROOT, CDS_LEGACY_ROOT), e.g. to look at load with a throwaway lessons file.
const cdsEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('CDS_')));
await client.connect(new StdioClientTransport({ command: process.execPath, args: [besideMe], stderr: 'ignore', env: cdsEnv }));
let args;
if (tool === 'claudedev_search') {
  args = { query: target };
  if (extra && extra !== '-') args.project_path = extra;
  if (extra2 && extra2 !== '-') args.kinds = extra2.split(',');
  if (extra3) args.limit = Number(extra3);
} else {
  args = { project_path: target };
  if (tool === 'claudedev_check_mistake') args.action_description = extra || '';
}
const t0 = Date.now();
const r = await client.callTool({ name: tool, arguments: args });
const ms = Date.now() - t0;
const out = r.content?.[0]?.text ?? '';
// The length is what load's size budget measures (it aims at 8,000 characters, at most 12,000).
console.log(`${r.isError ? '[isError]' : '[ok]'} ${out.length} characters, ${ms} ms`);
console.log(out);
await client.close();
