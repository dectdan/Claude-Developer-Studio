// Drives an installed CDS MCP server over stdio for the Windows Sandbox test. Copied into
// the installed mcp-server\test\ so the MCP SDK resolves from the installed node_modules.
// Prints one JSON object.
//
//   node mcp-probe.mjs tools  <server.js>                    (lists the tools)
//   node mcp-probe.mjs memory <index.js> <project> <text>    (load, record an activity, load again)
//   node mcp-probe.mjs load   <index.js> <project> <text>    (load only; is <text> shown? P10)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [mode, server, project, text] = process.argv.slice(2);
const out = { mode, server };
const client = new Client({ name: 'cds-sandbox-probe', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], stderr: 'ignore' }));
  if (mode === 'tools') {
    const { tools } = await client.listTools();
    out.count = tools.length;
    out.names = tools.map(t => t.name);
  } else if (mode === 'memory') {
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      return { isError: !!r.isError, text: r.content?.[0]?.text ?? '' };
    };
    out.load = await call('claudedev_load', { project_path: project });
    out.record = await call('claudedev_record_activity', { project_path: project, action: 'test', description: text });
    out.reload = await call('claudedev_load', { project_path: project });
    out.memoryFolder = (out.reload.text.match(/^Memory folder: (.+)$/m) || [])[1] || null;
    out.shown = out.reload.text.includes(text);
  } else if (mode === 'load') {
    // P10 (machine to machine): load only; is <text> in what Claude would see?
    const r = await client.callTool({ name: 'claudedev_load', arguments: { project_path: project } });
    out.isError = !!r.isError;
    out.text = (r.content?.[0]?.text ?? '').slice(0, 4000);
    out.shown = !!text && out.text.includes(text);
  }
  out.ok = true;
} catch (e) {
  out.ok = false;
  out.error = e.stack || e.message;
} finally {
  await client.close().catch(() => {});
}
console.log(JSON.stringify(out));
process.exit(0);
