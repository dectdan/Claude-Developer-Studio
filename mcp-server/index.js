#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to claudedev.exe
const CLAUDEDEV_PATH = path.join(__dirname, '..', 'CLI', 'claudedev.exe');

// CDS data storage base (OneDrive)
const CDS_BASE_PATH = 'C:\\Users\\Big_D\\OneDrive\\Documents\\ClaudeDevStudio\\Projects';

// Chat mirror log — survives context drops, stored on OneDrive
const MIRROR_PATH = 'C:\\Users\\Big_D\\OneDrive\\Documents\\ClaudeDevStudio\\chat_mirror.jsonl';
const MIRROR_MAX_LINES = 2000;
const MIRROR_TOOL_TTL_MS  = 24 * 60 * 60 * 1000;  // 24h for tool entries
const MIRROR_CKPT_TTL_MS  = 30 * 24 * 60 * 60 * 1000; // 30d for checkpoints

/**
 * Extract project name from source code path and return CDS data path.
 * e.g. C:\Projects\SmartScribe -> C:\Users\Big_D\OneDrive\...\SmartScribe
 */
function getCdsProjectPath(sourceProjectPath) {
  const projectName = path.basename(sourceProjectPath);
  return path.join(CDS_BASE_PATH, projectName);
}

/**
 * Execute claudedev command and return result
 */
async function runClaudeDevCommand(args) {
  try {
    const command = `& "${CLAUDEDEV_PATH}" ${args}`;
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
      shell: 'powershell.exe'
    });
    return {
      success: true,
      output: stdout || stderr,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.message
    };
  }
}

/**
 * Switch CDS active project to match source project path
 */
async function switchToProject(sourceProjectPath) {
  const projectName = path.basename(sourceProjectPath);
  await runClaudeDevCommand(`switch ${projectName}`);
}


/**
 * Fetch URL content
 */
async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const options = { headers: { 'User-Agent': 'ClaudeDevStudio/1.0.0' } };

    client.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ success: true, statusCode: res.statusCode, headers: res.headers, body: data });
      });
    }).on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Read CDS context files directly and return rich context string.
 * This bypasses the CLI's load command which outputs nothing useful.
 */
function readCdsContext(sourceProjectPath) {
  const cdsPath = getCdsProjectPath(sourceProjectPath);
  const projectName = path.basename(sourceProjectPath);
  let context = `=== ClaudeDevStudio Context: ${projectName} ===\n`;
  context += `CDS Data Path: ${cdsPath}\n\n`;

  if (!fs.existsSync(cdsPath)) {
    return context + `[No CDS data found at ${cdsPath}. Run claudedev_init first.]\n`;
  }

  // Core context files
  const coreFiles = [
    { label: 'Session State', file: 'CURRENT_SESSION_STATE.md' },
    { label: 'Facts', file: 'FACTS.md' },
    { label: 'Uncertainties', file: 'UNCERTAINTIES.md' },
  ];

  for (const { label, file } of coreFiles) {
    const filePath = path.join(cdsPath, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content) {
        context += `--- ${label} ---\n${content}\n\n`;
      }
    }
  }

  // Recent activity
  const activityDir = path.join(cdsPath, 'Activity');
  if (fs.existsSync(activityDir)) {
    const files = fs.readdirSync(activityDir)
      .filter(f => f.endsWith('.json') || f.endsWith('.md'))
      .sort()
      .slice(-10);

    if (files.length > 0) {
      context += `--- Recent Activity (last ${files.length} entries) ---\n`;
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(activityDir, f), 'utf8').trim();
          context += `[${f}]\n${raw}\n\n`;
        } catch { /* skip unreadable */ }
      }
    }
  }

  return context;
}


/**
 * Append one entry to the chat mirror log, then trim if oversized.
 * type: 'tool' | 'checkpoint'
 */
function mirrorLog(type, data) {
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n';
    fs.mkdirSync(path.dirname(MIRROR_PATH), { recursive: true });
    fs.appendFileSync(MIRROR_PATH, entry, 'utf8');
    // Trim on every write if file is large
    const lines = fs.readFileSync(MIRROR_PATH, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean);
    if (lines.length > MIRROR_MAX_LINES) mirrorTrim(lines);
  } catch { /* never break a tool call over logging */ }
}

/**
 * Purge expired entries. Checkpoints kept 30d, tool entries kept 24h.
 */
function mirrorTrim(lines) {
  try {
    const now = Date.now();
    const kept = lines.filter(line => {
      try {
        const e = JSON.parse(line);
        const age = now - new Date(e.ts).getTime();
        return e.type === 'checkpoint' ? age < MIRROR_CKPT_TTL_MS : age < MIRROR_TOOL_TTL_MS;
      } catch { return false; }
    });
    fs.writeFileSync(MIRROR_PATH, kept.join('\n') + '\n', 'utf8');
  } catch { /* silent */ }
}

/**
 * MCP Server for ClaudeDevStudio
 */
class ClaudeDevStudioServer {
  constructor() {
    this.server = new Server(
      { name: 'claudedevstudio', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'claudedev_init',
          description: 'Initialize ClaudeDevStudio memory for a project',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string', description: 'Absolute path to the project source directory' } },
            required: ['project_path'],
          },
        },
        {
          name: 'claudedev_load',
          description: 'Load context from ClaudeDevStudio memory (call at session start)',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string', description: 'Absolute path to the project source directory' } },
            required: ['project_path'],
          },
        },
        {
          name: 'claudedev_record_activity',
          description: 'Record an activity/action taken during development',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: { type: 'string', description: 'Absolute path to the project source directory' },
              action: { type: 'string', description: 'Type of action (e.g., "code_change", "debug", "fix")' },
              description: { type: 'string', description: 'Description of what was done' },
              file: { type: 'string', description: 'File that was modified (optional)' },
              outcome: { type: 'string', description: 'Result of the action (e.g., "success", "failed")' },
            },
            required: ['project_path', 'action', 'description'],
          },
        },
        {
          name: 'claudedev_record_mistake',
          description: 'Record a mistake/failed attempt with lesson learned',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: { type: 'string', description: 'Absolute path to the project source directory' },
              mistake: { type: 'string', description: 'What went wrong' },
              impact: { type: 'string', description: 'How it affected the project' },
              fix: { type: 'string', description: 'How it was fixed' },
              lesson: { type: 'string', description: 'What was learned' },
            },
            required: ['project_path', 'mistake', 'impact', 'fix', 'lesson'],
          },
        },
        {
          name: 'claudedev_check_mistake',
          description: 'Check if an action matches a prior mistake (prevents repeating errors)',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: { type: 'string', description: 'Absolute path to the project source directory' },
              action_description: { type: 'string', description: 'Description of the action you plan to take' },
            },
            required: ['project_path', 'action_description'],
          },
        },
        {
          name: 'claudedev_stats',
          description: 'Get memory statistics for current project',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string', description: 'Absolute path to the project source directory' } },
            required: ['project_path'],
          },
        },
        {
          name: 'claudedev_monitor_start',
          description: 'Start monitoring Visual Studio debug output (captures exceptions/errors)',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string', description: 'Absolute path to the project source directory' } },
            required: ['project_path'],
          },
        },
        {
          name: 'fetch_url',
          description: 'Fetch content from a URL - allows Claude to verify websites, fetch documentation, or get current information',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string', description: 'URL to fetch (http:// or https://)' } },
            required: ['url'],
          },
        },
        {
          name: 'claudedev_speak',
          description: 'Speak text aloud using Kokoro TTS (on-machine, no API cost). Use only for actual conversational moments, alerts, or key findings — NOT for status dumps. Examples: "Build failed — 3 errors", "Found the bug — null reference in ProcessQueue", "Done, all tests pass." Keep it concise.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to speak (keep under 200 chars for natural speech)' },
            },
            required: ['text'],
          },
        },
        {
          name: 'claudedev_vs_get_state',
          description: 'Get current Visual Studio state: active solution, open file, debug mode, exception message. Written by the CDS VS Bridge VSIX extension.',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'claudedev_vs_get_errors',
          description: 'Get the Visual Studio Error List from the last build: errors and warnings with file/line/message. Written by the CDS VS Bridge VSIX extension.',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'claudedev_vs_get_output',
          description: 'Get the Visual Studio build output text from the last build. Written by the CDS VS Bridge VSIX extension.',
          inputSchema: {
            type: 'object',
            properties: {
              lines: { type: 'number', description: 'Number of lines from end to return (default: 100)' },
            },
            required: [],
          },
        },
        {
          name: 'claudedev_vs_get_events',
          description: 'Get recent Visual Studio events (build start/end, debugger break/run, solution open/close). Optionally filter by timestamp.',
          inputSchema: {
            type: 'object',
            properties: {
              since: { type: 'string', description: 'ISO timestamp — only return events after this time (optional)' },
              limit: { type: 'number', description: 'Max events to return (default: 50)' },
            },
            required: [],
          },
        },
        {
          name: 'claudedev_vs_get_debugger',
          description: 'Get full Visual Studio debugger state when paused: call stack, local variables, current file and line. Only useful when debug mode is "break".',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'claudedev_vs_evaluate',
          description: 'Evaluate an expression in the current Visual Studio debugger frame. Only works when debugger is paused (break mode).',
          inputSchema: {
            type: 'object',
            properties: {
              expression: { type: 'string', description: 'Expression to evaluate (e.g. "myVar", "this.Count", "$exception")' },
            },
            required: ['expression'],
          },
        },
        {
          name: 'claudedev_vs_command',
          description: 'Send a command to Visual Studio. Actions: debugger.break, debugger.go, debugger.stepinto, debugger.stepover, debugger.stepout, debugger.stop, build.solution, build.clean, navigate (requires file + optional line).',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Command to execute' },
              file: { type: 'string', description: 'File path (for navigate action)' },
              line: { type: 'number', description: 'Line number (for navigate action)' },
            },
            required: ['action'],
          },
        },
        {
          name: 'claudedev_chat_checkpoint',
          description: 'Write a checkpoint to the chat mirror log. Call at key moments: task complete, plan decided, important finding, before risky operation. These survive context drops and are shown on resume. Keep under 300 chars.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'What to record (task state, decision made, next step). Under 300 chars.' },
            },
            required: ['text'],
          },
        },
        {
          name: 'claudedev_chat_resume',
          description: 'Recover context after a drop. Returns all checkpoints from last 7 days + tool activity from recent hours. Call at session start when context may be missing.',
          inputSchema: {
            type: 'object',
            properties: {
              hours: { type: 'number', description: 'Hours of tool activity to include (default: 4)' },
            },
            required: [],
          },
        },
      ],
    }));


    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      // Mirror tools write their own entries — skip auto-log for them
      const skipMirror = name === 'claudedev_chat_checkpoint' || name === 'claudedev_chat_resume';
      try {
        let result;
        switch (name) {
          case 'claudedev_init':            result = await this.handleInit(args); break;
          case 'claudedev_load':            result = await this.handleLoad(args); break;
          case 'claudedev_record_activity': result = await this.handleRecordActivity(args); break;
          case 'claudedev_record_mistake':  result = await this.handleRecordMistake(args); break;
          case 'claudedev_check_mistake':   result = await this.handleCheckMistake(args); break;
          case 'claudedev_stats':           result = await this.handleStats(args); break;
          case 'claudedev_monitor_start':   result = await this.handleMonitorStart(args); break;
          case 'fetch_url':                 result = await this.handleFetchUrl(args); break;
          case 'claudedev_speak':           result = await this.handleSpeak(args); break;
          case 'claudedev_vs_get_state':    result = this.handleVsGetState(); break;
          case 'claudedev_vs_get_errors':   result = this.handleVsGetErrors(); break;
          case 'claudedev_vs_get_output':   result = this.handleVsGetOutput(args); break;
          case 'claudedev_vs_get_events':   result = this.handleVsGetEvents(args); break;
          case 'claudedev_vs_get_debugger': result = this.handleVsHttp('GET', '/debugger'); break;
          case 'claudedev_vs_evaluate':     result = this.handleVsHttp('POST', '/command', { action: 'evaluate', expression: args.expression }); break;
          case 'claudedev_vs_command':      result = this.handleVsHttp('POST', '/command', args); break;
          case 'claudedev_chat_checkpoint': return this.handleChatCheckpoint(args);
          case 'claudedev_chat_resume':     return this.handleChatResume(args);
          default: throw new Error(`Unknown tool: ${name}`);
        }
        // Resolve promise if needed, then auto-log
        const resolved = result && typeof result.then === 'function' ? await result : result;
        if (!skipMirror) {
          const summary = (resolved?.content?.[0]?.text ?? '').slice(0, 120).replace(/\n/g, ' ');
          mirrorLog('tool', { tool: name, summary });
        }
        return resolved;
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  // Init: run CLI init with CDS data path (not source path)
  async handleInit(args) {
    const cdsPath = getCdsProjectPath(args.project_path);
    const result = await runClaudeDevCommand(`init "${cdsPath}"`);
    return {
      content: [{ type: 'text', text: result.success ? result.output : `Error: ${result.error}\n${result.output}` }],
    };
  }

  // Load: bypass the useless CLI output — read files directly
  async handleLoad(args) {
    await switchToProject(args.project_path);
    const context = readCdsContext(args.project_path);
    return {
      content: [{ type: 'text', text: context }],
    };
  }

  // Record activity: switch project first, then use correct CLI syntax
  async handleRecordActivity(args) {
    await switchToProject(args.project_path);
    const activityJson = JSON.stringify({
      action: args.action,
      description: args.description,
      file: args.file || '',
      outcome: args.outcome || 'success'
    });
    const escapedJson = activityJson.replace(/'/g, "''");
    const result = await runClaudeDevCommand(`record activity '${escapedJson}'`);
    // Also write directly to file as fallback
    this.writeActivityFile(args.project_path, 'activity', {
      action: args.action,
      description: args.description,
      file: args.file || '',
      outcome: args.outcome || 'success',
      timestamp: new Date().toISOString()
    });
    return {
      content: [{ type: 'text', text: result.success ? '✓ Activity recorded' : `CLI error (wrote directly): ${result.error}` }],
    };
  }

  // Record mistake: switch project first, then use correct CLI syntax
  async handleRecordMistake(args) {
    await switchToProject(args.project_path);
    const mistakeJson = JSON.stringify({
      mistake: args.mistake,
      impact: args.impact,
      fix: args.fix,
      lesson: args.lesson
    });
    const escapedJson = mistakeJson.replace(/'/g, "''");
    const result = await runClaudeDevCommand(`record mistake '${escapedJson}'`);
    // Also write directly to file as fallback
    this.writeActivityFile(args.project_path, 'mistake', {
      mistake: args.mistake,
      impact: args.impact,
      fix: args.fix,
      lesson: args.lesson,
      timestamp: new Date().toISOString()
    });
    return {
      content: [{ type: 'text', text: result.success ? '✓ Mistake recorded' : `CLI error (wrote directly): ${result.error}` }],
    };
  }


  // Write activity/mistake directly to CDS Activity folder — belt-and-suspenders
  writeActivityFile(sourceProjectPath, type, data) {
    try {
      const cdsPath = getCdsProjectPath(sourceProjectPath);
      const activityDir = path.join(cdsPath, 'Activity');
      if (!fs.existsSync(activityDir)) {
        fs.mkdirSync(activityDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `${timestamp}_${type}.json`;
      fs.writeFileSync(path.join(activityDir, filename), JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      // Non-fatal — log to stderr only
      console.error(`writeActivityFile failed: ${err.message}`);
    }
  }

  async handleCheckMistake(args) {
    await switchToProject(args.project_path);
    const result = await runClaudeDevCommand(`check "${args.action_description}"`);
    return {
      content: [{ type: 'text', text: result.output || '✓ No matching prior mistakes found' }],
    };
  }

  async handleStats(args) {
    await switchToProject(args.project_path);
    const result = await runClaudeDevCommand(`stats`);
    // Also append direct file counts for transparency
    let extra = '';
    try {
      const cdsPath = getCdsProjectPath(args.project_path);
      const activityDir = path.join(cdsPath, 'Activity');
      if (fs.existsSync(activityDir)) {
        const files = fs.readdirSync(activityDir);
        const activities = files.filter(f => f.includes('_activity'));
        const mistakes = files.filter(f => f.includes('_mistake'));
        extra = `\nDirect file counts — Activities: ${activities.length}, Mistakes: ${mistakes.length}`;
      }
    } catch { /* skip */ }
    return {
      content: [{ type: 'text', text: (result.success ? result.output : `Error: ${result.error}`) + extra }],
    };
  }

  async handleMonitorStart(args) {
    const result = await runClaudeDevCommand(`monitor "${args.project_path}"`);
    return {
      content: [{
        type: 'text',
        text: result.success ?
          'Debug monitor started. Capturing exceptions and errors from Visual Studio.' :
          `Error: ${result.error}`,
      }],
    };
  }

  async handleFetchUrl(args) {
    const result = await fetchUrl(args.url);
    if (!result.success) {
      return {
        content: [{ type: 'text', text: `Failed to fetch ${args.url}: ${result.error}` }],
        isError: true,
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Status: ${result.statusCode}\nContent-Type: ${result.headers['content-type']}\n\n${result.body}`,
      }],
    };
  }

  // ── Chat Mirror ────────────────────────────────────────────────────────────

  handleChatCheckpoint(args) {
    const text = (args && args.text) ? String(args.text).trim() : '';
    if (!text) return { content: [{ type: 'text', text: '[mirror] No text provided.' }] };
    mirrorLog('checkpoint', { text });
    return { content: [{ type: 'text', text: `[mirror] Checkpoint saved: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"` }] };
  }

  handleChatResume(args) {
    try {
      if (!fs.existsSync(MIRROR_PATH)) {
        return { content: [{ type: 'text', text: '[mirror] No chat mirror log found. Starting fresh.' }] };
      }
      const hours = (args && args.hours) ? Number(args.hours) : 4;
      const toolCutoff = Date.now() - hours * 60 * 60 * 1000;
      const ckptCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const lines = fs.readFileSync(MIRROR_PATH, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean);
      const entries = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          const ts = new Date(e.ts).getTime();
          if (e.type === 'checkpoint' && ts >= ckptCutoff) entries.push(e);
          else if (e.type === 'tool' && ts >= toolCutoff) entries.push(e);
        } catch { /* skip malformed */ }
      }
      if (entries.length === 0) {
        return { content: [{ type: 'text', text: '[mirror] No recent entries found.' }] };
      }
      const lines_out = entries.map(e => {
        const time = new Date(e.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        if (e.type === 'checkpoint') return `[${time}] ✦ CHECKPOINT: ${e.text}`;
        return `[${time}]   tool: ${e.tool} → ${e.summary}`;
      });
      const out = `=== Chat Mirror Resume (checkpoints: 7d, tools: ${hours}h) ===\n` + lines_out.join('\n');
      return { content: [{ type: 'text', text: out }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `[mirror] Error reading log: ${err.message}` }] };
    }
  }

  // ── Voice / TTS ────────────────────────────────────────────────────────────

  async handleSpeak(args) {
    const text = (args && args.text) ? String(args.text).trim() : '';
    if (!text) {
      return { content: [{ type: 'text', text: '[speak] No text provided.' }] };
    }
    return new Promise((resolve) => {
      const bodyStr = JSON.stringify({ text });
      const options = {
        hostname: 'localhost',
        port: 62001,
        path: '/speak',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
        timeout: 3000,
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          resolve({ content: [{ type: 'text', text: res.statusCode === 200 ? `[speak] queued: "${text}"` : `[speak] server error: ${data}` }] });
        });
      });
      req.on('error', () => {
        // Voice server not running — silently succeed (speech is optional, never block work)
        resolve({ content: [{ type: 'text', text: `[speak] VoiceServer offline — run VoiceServer.exe to enable speech.` }] });
      });
      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: '[speak] timeout' }] }); });
      req.write(bodyStr);
      req.end();
    });
  }

  // ── VS Bridge handlers ─────────────────────────────────────────────────────

  handleVsGetState() {
    const bridgeDir = path.join(
      'C:\\Users\\Big_D\\OneDrive\\Documents\\ClaudeDevStudio\\VSBridge'
    );
    const stateFile = path.join(bridgeDir, 'vs_state.json');
    if (!fs.existsSync(stateFile)) {
      return { content: [{ type: 'text', text: '[VS Bridge] vs_state.json not found. Is the CDS VS Bridge extension installed and a solution open?' }] };
    }
    try {
      const raw = fs.readFileSync(stateFile, 'utf8');
      const state = JSON.parse(raw);
      const age = Math.round((Date.now() - new Date(state.timestamp).getTime()) / 1000);
      return {
        content: [{ type: 'text', text: `VS State (${age}s ago):\n${JSON.stringify(state, null, 2)}` }],
      };
    } catch (e) {
      return { content: [{ type: 'text', text: `[VS Bridge] Failed to read state: ${e.message}` }] };
    }
  }

  handleVsGetErrors() {
    const bridgeDir = path.join(
      'C:\\Users\\Big_D\\OneDrive\\Documents\\ClaudeDevStudio\\VSBridge'
    );
    const errFile = path.join(bridgeDir, 'vs_errors.json');
    if (!fs.existsSync(errFile)) {
      return { content: [{ type: 'text', text: '[VS Bridge] vs_errors.json not found. Build the project first.' }] };
    }
    try {
      const raw = fs.readFileSync(errFile, 'utf8');
      const snap = JSON.parse(raw);
      const age = Math.round((Date.now() - new Date(snap.timestamp).getTime()) / 1000);
      let out = `Build: ${snap.buildResult} | Errors: ${snap.errorCount} | Warnings: ${snap.warningCount} (${age}s ago)\n\n`;
      if (snap.errors && snap.errors.length > 0) {
        out += '=== ERRORS ===\n';
        for (const e of snap.errors) {
          out += `  ${e.file}(${e.line},${e.col}): ${e.code ? e.code + ' ' : ''}${e.message}  [${e.project}]\n`;
        }
      }
      if (snap.warnings && snap.warnings.length > 0) {
        out += '\n=== WARNINGS ===\n';
        for (const w of snap.warnings) {
          out += `  ${w.file}(${w.line},${w.col}): ${w.code ? w.code + ' ' : ''}${w.message}  [${w.project}]\n`;
        }
      }
      if (snap.errorCount === 0 && snap.warningCount === 0) {
        out += '(Clean build — no errors or warnings)';
      }
      return { content: [{ type: 'text', text: out }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `[VS Bridge] Failed to read errors: ${e.message}` }] };
    }
  }

  handleVsGetOutput(args) {
    const bridgeDir = path.join(
      'C:\\Users\\Big_D\\OneDrive\\Documents\\ClaudeDevStudio\\VSBridge'
    );
    const outFile = path.join(bridgeDir, 'vs_build_output.txt');
    if (!fs.existsSync(outFile)) {
      return { content: [{ type: 'text', text: '[VS Bridge] vs_build_output.txt not found. Build the project first.' }] };
    }
    try {
      const lines = fs.readFileSync(outFile, 'utf8').split('\n');
      const limit = (args && args.lines) ? args.lines : 100;
      const tail = lines.slice(-limit).join('\n');
      return { content: [{ type: 'text', text: `Build Output (last ${limit} lines):\n\n${tail}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `[VS Bridge] Failed to read output: ${e.message}` }] };
    }
  }

  handleVsGetEvents(args) {
    const bridgeDir = path.join(
      'C:\\Users\\Big_D\\OneDrive\\Documents\\ClaudeDevStudio\\VSBridge'
    );
    const eventsFile = path.join(bridgeDir, 'vs_events.jsonl');
    if (!fs.existsSync(eventsFile)) {
      return { content: [{ type: 'text', text: '[VS Bridge] vs_events.jsonl not found. Extension may not be installed yet.' }] };
    }
    try {
      const since = (args && args.since) ? new Date(args.since) : null;
      const limit = (args && args.limit) ? args.limit : 50;
      const lines = fs.readFileSync(eventsFile, 'utf8')
        .split('\n')
        .filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(e => e !== null)
        .filter(e => !since || new Date(e.ts) > since)
        .slice(-limit);
      if (lines.length === 0) {
        return { content: [{ type: 'text', text: '[VS Bridge] No events found.' }] };
      }
      const out = lines.map(e => {
        const ago = Math.round((Date.now() - new Date(e.ts).getTime()) / 1000);
        const extra = e.extra ? ' ' + JSON.stringify(e.extra) : '';
        return `  [${ago}s ago] ${e.event}${extra}`;
      }).join('\n');
      return { content: [{ type: 'text', text: `VS Events (${lines.length}):\n${out}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `[VS Bridge] Failed to read events: ${e.message}` }] };
    }
  }

  // ── VS HTTP Bridge (Phase 2) ───────────────────────────────────────────────

  async handleVsHttp(method, path, body) {
    return new Promise((resolve) => {
      const bodyStr = body ? JSON.stringify(body) : null;
      const options = {
        hostname: 'localhost',
        port: 62000,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
        timeout: 5000,
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const pretty = JSON.stringify(parsed, null, 2);
            resolve({ content: [{ type: 'text', text: pretty }] });
          } catch {
            resolve({ content: [{ type: 'text', text: data }] });
          }
        });
      });
      req.on('error', (e) => {
        resolve({ content: [{ type: 'text', text: `[VS HTTP Bridge] Cannot connect to localhost:62000 — is the VSIX loaded? Error: ${e.message}` }] });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ content: [{ type: 'text', text: '[VS HTTP Bridge] Request timed out after 5s' }] });
      });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ClaudeDevStudio MCP server running on stdio');
  }
}

// Start the server
const server = new ClaudeDevStudioServer();
server.run().catch(console.error);
