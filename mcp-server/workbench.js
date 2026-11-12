#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { vsBridgeDir } from './cds-paths.js';
import { phaseStart, phaseStatus, phaseReply, phaseStop } from './cds-phase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The version is set in package.json beside this file (checked by tools\check-versions.ps1).
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || 'unknown'; }
  catch { return 'unknown'; }
})();

const CDS_INSTALL_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local'),
  'ClaudeDevStudio'
);

// The VS Bridge writes to [Documents]\ClaudeDevStudio\VSBridge, where [Documents] is the
// folder Windows reports (it may be redirected anywhere, not only to OneDrive). Asked once,
// on the first VS tool call, exactly as index.js asks for the memory folder (cds-paths.js).

// Startup: check for AI keys
(function checkApiKeys() {
  const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const providers = cfg.providers || {};
    const configured = Object.values(providers).filter(p => p.api_key && p.api_key.length > 0);
    if (configured.length === 0) {
      console.error('[Workbench] No AI provider API keys configured. Use tray icon → Configure AI Keys.');
    } else {
      console.error(`[Workbench] AI providers ready: ${configured.length} of ${Object.keys(providers).length}.`);
    }
  } catch {
    console.error('[Workbench] qwen_config.json not found — AI delegation unavailable.');
  }
})();

function fetchUrl(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    client.get(url, { headers: { 'User-Agent': `ClaudeDevStudio/${VERSION}` } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ success: true, statusCode: res.statusCode, headers: res.headers, body: data }));
    }).on('error', (err) => resolve({ success: false, error: err.message }));
  });
}

// The VS Bridge's port (VsBridgeServer.cs). CDS_VS_BRIDGE_PORT moves it for tests only
// (smoke.mjs runs a fake bridge); never set it in normal use.
const VS_BRIDGE_PORT = Number(process.env.CDS_VS_BRIDGE_PORT) || 62000;

// GET from the VS Bridge: { status, body, json } or { unreachable: <reason> }.
function bridgeGet(urlPath) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port: VS_BRIDGE_PORT, path: urlPath, method: 'GET', timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body, json });
      });
    });
    req.on('error', (e) => resolve({ unreachable: e.code === 'ECONNREFUSED' ? 'nothing is listening' : e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ unreachable: 'timed out after 5 s' }); });
    req.end();
  });
}

class WorkbenchServer {
  constructor() {
    this.server = new Server(
      { name: 'cds-workbench', version: VERSION },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'fetch_url',
          description: 'Fetch content from a URL.',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string', description: 'URL to fetch' } },
            required: ['url'],
          },
        },
        {
          name: 'claudedev_vs_get_state',
          description: 'Get current Visual Studio state: solution, file, debug mode.',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'claudedev_vs_get_errors',
          description: 'Get VS build errors and warnings.',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'claudedev_vs_get_output',
          description: 'Get a VS Output pane: build (default), debug (a running program\'s Debug.WriteLine/trace output), any pane by name, or list.',
          inputSchema: {
            type: 'object',
            properties: {
              pane: { type: 'string', description: 'build (default), debug, a pane name, or list' },
              lines: { type: 'number', description: 'Lines from end (default 100)' },
            },
            required: [],
          },
        },
        {
          name: 'claudedev_vs_get_events',
          description: 'Get recent VS events (build, debug, solution changes).',
          inputSchema: {
            type: 'object',
            properties: {
              since: { type: 'string', description: 'ISO timestamp filter (optional)' },
              limit: { type: 'number', description: 'Max events (default 50)' },
            },
            required: [],
          },
        },
        {
          name: 'claudedev_vs_get_debugger',
          description: 'Get VS debugger state: call stack, locals, current line. Only when paused.',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'claudedev_vs_evaluate',
          description: 'Evaluate an expression in the VS debugger. Only when paused.',
          inputSchema: {
            type: 'object',
            properties: { expression: { type: 'string', description: 'Expression to evaluate' } },
            required: ['expression'],
          },
        },
        {
          name: 'claudedev_vs_command',
          description: 'Send a command to VS: debugger.break/go/stepinto/stepover/stepout/stop, build.solution/clean, navigate.',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Command to execute' },
              file: { type: 'string', description: 'File path (for navigate)' },
              line: { type: 'number', description: 'Line number (for navigate)' },
            },
            required: ['action'],
          },
        },
        {
          name: 'qwen_generate',
          description: 'Delegate work to an external AI model. Modes: code, prose, json, fast, cheap, broad. Providers: together, groq, deepinfra, fireworks, openrouter.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt:     { type: 'string', description: 'The task. Be specific — no conversation context.' },
              context:    { type: 'string', description: 'Code snippets or constraints (optional)' },
              mode:       { type: 'string', enum: ['code', 'prose', 'json', 'fast', 'cheap', 'broad'] },
              provider:   { type: 'string', enum: ['together', 'groq', 'deepinfra', 'fireworks', 'openrouter'] },
              max_tokens: { type: 'number', description: 'Max output tokens (default 4096, cap 16384)' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'display_review',
          description: 'Send code/content to the Review Panel at localhost:63000.',
          inputSchema: {
            type: 'object',
            properties: {
              title:    { type: 'string' },
              content:  { type: 'string' },
              language: { type: 'string', enum: ['csharp', 'javascript', 'json', 'markdown', 'xml', 'text'] },
              tag:      { type: 'string' },
            },
            required: ['title', 'content'],
          },
        },
        {
          name: 'display_image',
          description: 'Send a base64 image to the Review Panel.',
          inputSchema: {
            type: 'object',
            properties: {
              title:     { type: 'string' },
              imageData: { type: 'string', description: 'Base64-encoded image data' },
              mimeType:  { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
              filename:  { type: 'string' },
              tag:       { type: 'string' },
            },
            required: ['title', 'imageData'],
          },
        },
        {
          name: 'generate_image',
          description: 'Generate an image via Fireworks SDXL and display in Review Panel.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt:   { type: 'string', description: 'Image description' },
              title:    { type: 'string', description: 'Display title' },
              width:    { type: 'number' }, height: { type: 'number' },
              steps:    { type: 'number' },
              filename: { type: 'string' }, tag: { type: 'string' },
            },
            required: ['prompt', 'title'],
          },
        },
        {
          name: 'list_models',
          description: 'List available models from a provider. Returns model IDs, context length, and pricing when available.',
          inputSchema: {
            type: 'object',
            properties: {
              provider: { type: 'string', enum: ['together', 'groq', 'deepinfra', 'fireworks', 'openrouter', 'all'], description: 'Provider to query, or "all" for all providers' },
            },
            required: ['provider'],
          },
        },
        // P7: run a phase (docs\<phase>_prompt.md) in Claude Code, headless. cds-phase.js.
        {
          name: 'claudedev_phase_start',
          description: 'Windows. Start Claude Code headless on docs\\<phase>_prompt.md in a project (the file must exist). It is an agent that reads, edits and runs commands there with the allowed tools, without asking (acceptEdits; never bypasses permissions), on the user\'s Claude Code sign-in and plan. Returns at once; one phase per project; logs in docs\\.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: { type: 'string' },
              phase: { type: 'string', description: 'e.g. P8' },
              model: { type: 'string', description: 'Optional, e.g. claude-opus-5-5' },
              effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
              allowed_tools: { type: 'string', description: 'Optional, comma-separated; default: file, shell and web tools plus CDS memory' },
            },
            required: ['project_path', 'phase'],
          },
        },
        {
          name: 'claudedev_phase_status',
          description: 'Status of a phase run: running/finished/stopped, minutes, tool calls, permission denials, Claude\'s latest text, the result, whether it ends in a question, whether docs\\<phase>_OUTPUT.md exists.',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string' }, phase: { type: 'string', description: 'Default: the newest' } },
            required: ['project_path'],
          },
        },
        {
          name: 'claudedev_phase_reply',
          description: 'Answer a phase run that has finished: continues the same Claude Code session with the same model, effort and tools. Refused while it runs.',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string' }, phase: { type: 'string' }, message: { type: 'string' } },
            required: ['project_path', 'phase', 'message'],
          },
        },
        {
          name: 'claudedev_phase_stop',
          description: 'Stop a phase run: Ctrl+C first (Claude Code ends its turn and runs its SessionEnd hooks), else ends its process tree by force; releases the project\'s lock. Touches no other process.',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string' }, phase: { type: 'string' } },
            required: ['project_path', 'phase'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case 'fetch_url':                 return await this.handleFetchUrl(args);
          case 'claudedev_vs_get_state':    return this.handleVsFile('vs_state.json');
          case 'claudedev_vs_get_errors':   return this.handleVsErrors();
          case 'claudedev_vs_get_output':   return await this.handleVsOutput(args);
          case 'claudedev_vs_get_events':   return this.handleVsEvents(args);
          case 'claudedev_vs_get_debugger': return this.handleVsHttp('GET', '/debugger');
          case 'claudedev_vs_evaluate':     return this.handleVsHttp('POST', '/command', { action: 'evaluate', expression: args.expression });
          case 'claudedev_vs_command':      return this.handleVsHttp('POST', '/command', args);
          case 'qwen_generate':             return await this.handleQwenGenerate(args);
          case 'display_review':            return await this.handleDisplayReview(args);
          case 'display_image':             return await this.handleDisplayImage(args);
          case 'generate_image':            return await this.handleGenerateImage(args);
          case 'list_models':               return await this.handleListModels(args);
          case 'claudedev_phase_start':     return this.phaseResult(await phaseStart(args));
          case 'claudedev_phase_status':    return this.phaseResult(await phaseStatus(args));
          case 'claudedev_phase_reply':     return this.phaseResult(await phaseReply(args));
          case 'claudedev_phase_stop':      return this.phaseResult(await phaseStop(args));
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    });
  }

  // cds-phase.js answers { ok, text }; a refusal is an error result, with the reason and what to do.
  phaseResult(r) {
    return { content: [{ type: 'text', text: r.text }], ...(r.ok ? {} : { isError: true }) };
  }

  async handleFetchUrl(args) {
    const result = await fetchUrl(args.url);
    if (!result.success) return { content: [{ type: 'text', text: `Failed: ${result.error}` }], isError: true };
    return { content: [{ type: 'text', text: `Status: ${result.statusCode}\nContent-Type: ${result.headers['content-type']}\n\n${result.body}` }] };
  }

  handleVsFile(filename) {
    const filePath = path.join(vsBridgeDir(),filename);
    if (!fs.existsSync(filePath)) return { content: [{ type: 'text', text: `[VS Bridge] ${filename} not found.` }] };
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const state = JSON.parse(raw);
      const age = Math.round((Date.now() - new Date(state.timestamp).getTime()) / 1000);
      return { content: [{ type: 'text', text: `VS State (${age}s ago):\n${JSON.stringify(state, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `[VS Bridge] Read error: ${e.message}` }] };
    }
  }

  handleVsErrors() {
    const errFile = path.join(vsBridgeDir(),'vs_errors.json');
    if (!fs.existsSync(errFile)) return { content: [{ type: 'text', text: '[VS Bridge] vs_errors.json not found.' }] };
    try {
      const snap = JSON.parse(fs.readFileSync(errFile, 'utf8'));
      const age = Math.round((Date.now() - new Date(snap.timestamp).getTime()) / 1000);
      let out = `Build: ${snap.buildResult} | Errors: ${snap.errorCount} | Warnings: ${snap.warningCount} (${age}s ago)\n\n`;
      if (snap.errors && snap.errors.length > 0) {
        out += '=== ERRORS ===\n';
        for (const e of snap.errors) out += `  ${e.file}(${e.line},${e.col}): ${e.code ? e.code + ' ' : ''}${e.message}  [${e.project}]\n`;
      }
      if (snap.warnings && snap.warnings.length > 0) {
        out += '\n=== WARNINGS ===\n';
        for (const w of snap.warnings) out += `  ${w.file}(${w.line},${w.col}): ${w.code ? w.code + ' ' : ''}${w.message}  [${w.project}]\n`;
      }
      if (snap.errorCount === 0 && snap.warningCount === 0) out += '(Clean build)';
      return { content: [{ type: 'text', text: out }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `[VS Bridge] Read error: ${e.message}` }] };
    }
  }

  // pane "build" (the default) is the copy the VS Bridge saves when a build ends, as before 1.5.0
  // (it works with Visual Studio closed). Any other pane is read live from the running Visual Studio
  // (VS Bridge 1.5.0+: GET /pane, GET /panes); "list" names the panes. Same size limit for all:
  // the newest `lines` lines (default 100).
  async handleVsOutput(args) {
    const pane = String((args && args.pane) || 'build').trim() || 'build';
    const n = Number(args && args.lines);
    const limit = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 100;
    const key = pane.toLowerCase();
    const say = (t) => ({ content: [{ type: 'text', text: t }] });

    if (key === 'build') {
      const outFile = path.join(vsBridgeDir(),'vs_build_output.txt');
      if (!fs.existsSync(outFile)) return say('[VS Bridge] vs_build_output.txt not found.');
      try {
        const lines = fs.readFileSync(outFile, 'utf8').split('\n');
        return say(`Build Output (last ${limit} lines):\n\n${lines.slice(-limit).join('\n')}`);
      } catch (e) {
        return say(`[VS Bridge] Read error: ${e.message}`);
      }
    }

    const listing = key === 'list' || key === 'panes';
    const r = await bridgeGet(listing ? '/panes' : `/pane?name=${encodeURIComponent(pane)}&lines=${limit}`);
    if (r.unreachable) {
      return say(`[VS HTTP Bridge] Visual Studio with the CDS VS Bridge isn't reachable on localhost:${VS_BRIDGE_PORT} (${r.unreachable}). ` +
        'Open Visual Studio with a solution and try again. The last build\'s output is pane "build" (no Visual Studio needed).');
    }
    if (r.status === 404) {
      return say('[VS Bridge] The VS Bridge in this Visual Studio is older than 1.5.0 and reads only the Build pane (pane "build"). ' +
        'Install ClaudeDevStudio 1.5.0 or later, which updates the VS Bridge, then restart Visual Studio.');
    }
    const j = r.json;
    if (!j) return say(`[VS Bridge] Unexpected answer (HTTP ${r.status}): ${String(r.body).slice(0, 300)}`);
    const names = (list) => (list || []).map(p => `"${p.name}"${p.kind ? ` (${p.kind})` : ''}`).join(', ') || 'none';
    if (j.error) return say(`[VS Bridge] ${j.error}${j.panes ? `\nOutput panes now: ${names(j.panes)}.` : ''}`);
    if (listing) {
      const rows = (j.panes || []).map(p => `  ${p.name}${p.kind ? `  [pane: "${p.kind}"]` : ''}${p.lines != null ? `  ${p.lines} line${p.lines === 1 ? '' : 's'}` : '  (no text yet)'}`);
      return say(rows.length
        ? `Output panes (${rows.length}); pass a name as pane:\n${rows.join('\n')}`
        : 'Visual Studio has no Output panes yet.');
    }
    if (j.note) return say(`Output pane "${j.pane}": ${j.note}${String(j.pane).toLowerCase() === 'debug' || j.kind === 'debug' ? ' A program started under the debugger writes its Debug.WriteLine/trace output here.' : ''}`);
    const of = j.shown < j.lines ? `last ${j.shown} of ${j.lines} lines` : `all ${j.lines} lines`;
    return say(`Output pane "${j.pane}" (${of}, live):\n\n${j.text ?? ''}`);
  }

  handleVsEvents(args) {
    const eventsFile = path.join(vsBridgeDir(),'vs_events.jsonl');
    if (!fs.existsSync(eventsFile)) return { content: [{ type: 'text', text: '[VS Bridge] vs_events.jsonl not found.' }] };
    try {
      const since = (args && args.since) ? new Date(args.since) : null;
      const limit = (args && args.limit) ? args.limit : 50;
      const events = fs.readFileSync(eventsFile, 'utf8')
        .split('\n').filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(e => e !== null)
        .filter(e => !since || new Date(e.ts) > since)
        .slice(-limit);
      if (events.length === 0) return { content: [{ type: 'text', text: '[VS Bridge] No events found.' }] };
      const out = events.map(e => {
        const ago = Math.round((Date.now() - new Date(e.ts).getTime()) / 1000);
        return `  [${ago}s ago] ${e.event}${e.extra ? ' ' + JSON.stringify(e.extra) : ''}`;
      }).join('\n');
      return { content: [{ type: 'text', text: `VS Events (${events.length}):\n${out}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `[VS Bridge] Read error: ${e.message}` }] };
    }
  }

  handleVsHttp(method, urlPath, body) {
    return new Promise((resolve) => {
      const bodyStr = body ? JSON.stringify(body) : null;
      const options = {
        hostname: 'localhost', port: VS_BRIDGE_PORT, path: urlPath, method,
        headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) },
        timeout: 5000,
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ content: [{ type: 'text', text: JSON.stringify(JSON.parse(data), null, 2) }] }); }
          catch { resolve({ content: [{ type: 'text', text: data }] }); }
        });
      });
      req.on('error', (e) => resolve({ content: [{ type: 'text', text: `[VS HTTP Bridge] Cannot connect to localhost:62000: ${e.message}` }] }));
      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: '[VS HTTP Bridge] Timed out.' }] }); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  async handleQwenGenerate(args) {
    const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
    catch (e) { return { content: [{ type: 'text', text: `[AiDelegate] Cannot read qwen_config.json: ${e.message}` }] }; }

    const mode = args.mode || 'code';
    const maxTok = Math.min(args.max_tokens || cfg.limits.max_tokens_default, cfg.limits.max_tokens_hard_cap);
    const providerKey = args.provider || cfg.routing_defaults[mode] || 'together';
    const provider = cfg.providers[providerKey];
    if (!provider) return { content: [{ type: 'text', text: `[AiDelegate] Unknown provider: ${providerKey}` }] };
    if (!provider.api_key || provider.api_key.trim() === '') {
      return { content: [{ type: 'text', text: `[AiDelegate] No API key for '${providerKey}'. Use tray icon → Configure AI Keys.` }] };
    }

    const systemPrompts = {
      code:  'You are an expert C# and C++ developer. Return clean, production-ready, compilable code only. No markdown fences. No explanations unless asked.',
      prose: 'You are a clear, precise technical writer.',
      json:  'Return ONLY valid JSON. No markdown, no commentary.',
      fast:  'Be concise and direct.',
      cheap: 'Be thorough but efficient.',
      broad: 'Complete the task as specified.',
    };

    const userPrompt = args.context ? `## Context\n${args.context}\n\n## Task\n${args.prompt}` : args.prompt;
    const body = JSON.stringify({
      model: provider.model, max_tokens: maxTok,
      messages: [
        { role: 'system', content: systemPrompts[mode] || systemPrompts.prose },
        { role: 'user', content: userPrompt },
      ],
    });
    const urlObj = new URL(provider.base_url);
    const t0 = Date.now();

    return new Promise((resolve) => {
      const options = {
        hostname: urlObj.hostname, path: urlObj.pathname + (urlObj.search || ''), method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.api_key}`,
          'Content-Length': Buffer.byteLength(body),
          'HTTP-Referer': 'https://gainpublications.com', 'X-Title': 'ClaudeDevStudio',
        },
        timeout: cfg.limits.timeout_ms || 120000,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const elapsed = Date.now() - t0;
          try {
            const parsed = JSON.parse(data);
            const content = parsed?.choices?.[0]?.message?.content ?? '';
            const tokIn = parsed?.usage?.prompt_tokens ?? 0;
            const tokOut = parsed?.usage?.completion_tokens ?? 0;
            const cost = (tokIn * provider.cost_in / 1_000_000) + (tokOut * provider.cost_out / 1_000_000);
            // Log usage
            try {
              const entry = JSON.stringify({
                ts: new Date().toISOString(), provider: providerKey, model: provider.model,
                mode, tokIn, tokOut, cost: cost.toFixed(6), elapsed_ms: elapsed,
              }) + '\n';
              if (cfg.log_path) {
                fs.mkdirSync(path.dirname(cfg.log_path), { recursive: true });
                fs.appendFileSync(cfg.log_path, entry, 'utf8');
              }
            } catch { /* never break on log failure */ }
            // Budget check
            let budgetWarning = '';
            try {
              if (cfg.log_path && fs.existsSync(cfg.log_path)) {
                const today = new Date().toISOString().slice(0, 10);
                const lines = fs.readFileSync(cfg.log_path, 'utf8').split('\n').filter(Boolean);
                const todayTotal = lines
                  .map(l => { try { return JSON.parse(l); } catch { return null; } })
                  .filter(e => e && e.ts && e.ts.startsWith(today))
                  .reduce((sum, e) => sum + parseFloat(e.cost || 0), 0);
                if (todayTotal > cfg.limits.daily_budget_usd) budgetWarning = `\n⚠️ DAILY BUDGET EXCEEDED: $${todayTotal.toFixed(4)} (limit $${cfg.limits.daily_budget_usd})`;
              }
            } catch { /* ignore */ }
            const header = `[${providerKey.toUpperCase()} | ${provider.model.split('/').pop()} | ${elapsed}ms | in:${tokIn} out:${tokOut} | $${cost.toFixed(5)}]${budgetWarning}\n\n`;
            resolve({ content: [{ type: 'text', text: header + content }] });
          } catch (e) {
            resolve({ content: [{ type: 'text', text: `[AiDelegate] Parse error: ${e.message}\nRaw: ${data.slice(0, 500)}` }] });
          }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: `[AiDelegate] ${providerKey} timed out.` }] }); });
      req.on('error', e => resolve({ content: [{ type: 'text', text: `[AiDelegate] Network error: ${e.message}` }] }));
      req.write(body);
      req.end();
    });
  }

  async handleDisplayReview(args) {
    const { title, content, language = 'text', tag } = args;
    if (!title || content === undefined) return { content: [{ type: 'text', text: '[ReviewPanel] title and content required.' }] };
    return new Promise((resolve) => {
      const body = JSON.stringify({ title, content, language, tag });
      const options = {
        hostname: '127.0.0.1', port: 63000, path: '/review', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 3000,
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ content: [{ type: 'text', text: parsed.ok ? `[ReviewPanel] Sent → "${title}" (id:${parsed.id})` : `[ReviewPanel] Error: ${data}` }] });
          } catch { resolve({ content: [{ type: 'text', text: `[ReviewPanel] Bad response: ${data}` }] }); }
        });
      });
      req.on('error', (e) => resolve({ content: [{ type: 'text', text: `[ReviewPanel] Cannot reach server: ${e.message}` }] }));
      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: '[ReviewPanel] Timed out.' }] }); });
      req.write(body);
      req.end();
    });
  }

  async handleDisplayImage(args) {
    const { title, imageData, mimeType = 'image/png', filename, tag } = args;
    if (!title || !imageData) return { content: [{ type: 'text', text: '[ReviewPanel] title and imageData required.' }] };
    const clean = imageData.replace(/^data:[^;]+;base64,/, '');
    return new Promise((resolve) => {
      const body = JSON.stringify({ title, imageData: clean, mimeType, filename, tag });
      const options = {
        hostname: '127.0.0.1', port: 63000, path: '/image', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 5000,
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ content: [{ type: 'text', text: parsed.ok ? `[ReviewPanel] Image → "${title}" (id:${parsed.id})` : `[ReviewPanel] Error: ${data}` }] });
          } catch { resolve({ content: [{ type: 'text', text: `[ReviewPanel] Bad response: ${data}` }] }); }
        });
      });
      req.on('error', (e) => resolve({ content: [{ type: 'text', text: `[ReviewPanel] Cannot reach: ${e.message}` }] }));
      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: '[ReviewPanel] Timed out.' }] }); });
      req.write(body);
      req.end();
    });
  }

  async handleGenerateImage(args) {
    const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
    catch (e) { return { content: [{ type: 'text', text: `[ImageGen] Cannot read qwen_config.json: ${e.message}` }] }; }

    const fireworksKey = cfg.providers?.fireworks?.api_key;
    if (!fireworksKey) return { content: [{ type: 'text', text: '[ImageGen] No Fireworks key configured.' }] };

    const { prompt, title, width = 1024, height = 1024, steps = 20, filename, tag } = args;
    const validSizes = [
      [1024,1024],[1152,896],[896,1152],[1216,832],[832,1216],
      [1344,768],[768,1344],[1536,640],[640,1536]
    ];
    const snap = (w, h) => {
      let best = validSizes[0], bestDist = Infinity;
      for (const [vw, vh] of validSizes) {
        const dist = Math.abs(vw - w) + Math.abs(vh - h);
        if (dist < bestDist) { bestDist = dist; best = [vw, vh]; }
      }
      return best;
    };
    const [snapW, snapH] = snap(width, height);

    const bodyStr = JSON.stringify({
      cfg_scale: 7, width: snapW, height: snapH,
      steps: Math.min(steps, 30), samples: 1, prompt,
      negative_prompt: 'blurry, low quality, distorted, text, watermark',
    });

    return new Promise((resolve) => {
      const bodyBytes = Buffer.from(bodyStr, 'utf8');
      const urlObj = new URL('https://api.fireworks.ai/inference/v1/image_generation/accounts/fireworks/models/stable-diffusion-xl-1024-v1-0');
      const options = {
        hostname: urlObj.hostname, path: urlObj.pathname, method: 'POST',
        headers: {
          'Authorization': `Bearer ${fireworksKey}`,
          'Content-Type': 'application/json',
          'Content-Length': bodyBytes.length,
        },
        timeout: 120000,
      };
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', async () => {
          const contentType = res.headers['content-type'] || '';
          const buf = Buffer.concat(chunks);
          if (!contentType.includes('image/')) {
            return resolve({ content: [{ type: 'text', text: `[ImageGen] Error: ${buf.toString('utf8').slice(0, 400)}` }] });
          }
          const b64 = buf.toString('base64');
          const displayResult = await this.handleDisplayImage({
            title, imageData: b64, mimeType: 'image/png',
            filename: filename || `generated_${Date.now()}.png`,
            tag: tag || 'SDXL',
          });
          const displayMsg = displayResult?.content?.[0]?.text ?? '';
          resolve({ content: [{ type: 'text', text: `[ImageGen] Done (${snapW}×${snapH}). ${displayMsg}` }] });
        });
      });
      req.on('error', (e) => resolve({ content: [{ type: 'text', text: `[ImageGen] Network error: ${e.message}` }] }));
      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: '[ImageGen] Timed out.' }] }); });
      req.write(bodyBytes);
      req.end();
    });
  }

  async handleListModels(args) {
    const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
    catch (e) { return { content: [{ type: 'text', text: `[Models] Cannot read config: ${e.message}` }] }; }

    const providerEndpoints = {
      together:   { url: 'https://api.together.xyz/v1/models', header: 'Bearer' },
      groq:       { url: 'https://api.groq.com/openai/v1/models', header: 'Bearer' },
      deepinfra:  { url: 'https://api.deepinfra.com/v1/openai/models', header: 'Bearer' },
      fireworks:  { url: 'https://api.fireworks.ai/inference/v1/models', header: 'Bearer' },
      openrouter: { url: 'https://openrouter.ai/api/v1/models', header: 'Bearer' },
    };

    const queryProvider = (name) => {
      const provider = cfg.providers[name];
      const endpoint = providerEndpoints[name];
      if (!provider || !endpoint) return Promise.resolve({ name, error: 'Unknown provider' });
      if (!provider.api_key) return Promise.resolve({ name, error: 'No API key configured' });

      return new Promise((resolve) => {
        const urlObj = new URL(endpoint.url);
        const options = {
          hostname: urlObj.hostname, path: urlObj.pathname, method: 'GET',
          headers: { 'Authorization': `Bearer ${provider.api_key}` },
          timeout: 15000,
        };
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const models = parsed.data || parsed || [];
              const list = (Array.isArray(models) ? models : []).map(m => ({
                id: m.id || m.modelId || 'unknown',
                context: m.context_length || m.context_window || null,
                type: m.type || m.object || null,
                pricing: m.pricing || null,
              }));
              resolve({ name, count: list.length, models: list });
            } catch (e) {
              resolve({ name, error: `Parse error: ${e.message}` });
            }
          });
        });
        req.on('error', e => resolve({ name, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ name, error: 'Timed out' }); });
        req.end();
      });
    };

    const targets = args.provider === 'all'
      ? Object.keys(providerEndpoints)
      : [args.provider];

    const results = await Promise.all(targets.map(queryProvider));

    let out = '';
    for (const r of results) {
      out += `\n=== ${r.name.toUpperCase()} ===\n`;
      if (r.error) { out += `  Error: ${r.error}\n`; continue; }
      out += `  ${r.count} models available\n`;
      const chatModels = r.models
        .filter(m => !m.type || m.type === 'model' || m.type === 'chat' || m.type === 'language')
        .slice(0, 30);
      for (const m of chatModels) {
        let line = `  • ${m.id}`;
        if (m.context) line += ` (ctx:${m.context})`;
        if (m.pricing) {
          const pi = m.pricing.prompt || m.pricing.input;
          const po = m.pricing.completion || m.pricing.output;
          if (pi && po) line += ` [$${pi}/$${po} per tok]`;
        }
        out += line + '\n';
      }
      if (r.models.length > 30) out += `  ... and ${r.models.length - 30} more\n`;
    }
    return { content: [{ type: 'text', text: out.trim() }] };
  }

  startReviewPanel() {
    const serverPath = path.join(CDS_INSTALL_PATH, 'review-server', 'server.js');
    if (!fs.existsSync(serverPath)) {
      console.error('[ReviewPanel] server.js not found, skipping.');
      return;
    }
    const checkReq = http.request({ hostname: '127.0.0.1', port: 63000, path: '/status', method: 'GET', timeout: 1000 }, () => {
      console.error('[ReviewPanel] Already running.');
    });
    checkReq.on('error', () => {
      const child = spawn(process.execPath, [serverPath], { detached: true, stdio: 'ignore' });
      child.unref();
      console.error('[ReviewPanel] Started on http://localhost:63000');
    });
    checkReq.end();
  }

  async run() {
    this.startReviewPanel();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('CDS Workbench MCP server running on stdio');
  }
}

const server = new WorkbenchServer();
server.run().catch(console.error);
