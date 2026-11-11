// Prints what a tool returns, and its length in characters, for eyeballing output.
// Read-only tools only (claudedev_load also saves the project's session_state.json, as every load does).
//   node mcp-server\test\show.mjs <tool> <project_path> [action_description]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const [tool = 'claudedev_load', project = process.cwd(), extra] = process.argv.slice(2);
if (!['claudedev_load', 'claudedev_stats', 'claudedev_check_mistake'].includes(tool)) {
  console.error('show.mjs runs only claudedev_load, claudedev_stats or claudedev_check_mistake.');
  process.exit(2);
}
const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const client = new Client({ name: 'cds-show', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'ignore' }));
const args = { project_path: project };
if (tool === 'claudedev_check_mistake') args.action_description = extra || '';
const r = await client.callTool({ name: tool, arguments: args });
const out = r.content?.[0]?.text ?? '';
// The length is what load's size budget measures (it aims at 8,000 characters, at most 12,000).
console.log(`${r.isError ? '[isError]' : '[ok]'} ${out.length} characters`);
console.log(out);
await client.close();
