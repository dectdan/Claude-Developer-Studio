#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path to ClaudeDevStudio install — works regardless of where this script runs from
const CDS_INSTALL_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local'),
  'ClaudeDevStudio'
);

// ── Startup: check for API keys ────────────────────────────────────────────
(function checkApiKeys() {
  const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const providers = cfg.providers || {};
    const configured = Object.values(providers).filter(p => p.api_key && p.api_key.length > 0);
    if (configured.length === 0) {
      console.error('[CDS] No AI provider API keys configured.');
      console.error('[CDS] Right-click the ClaudeDevStudio tray icon → Configure AI Keys to add them.');
      console.error('[CDS] The qwen_generate tool will not work until at least one key is added.');
    } else {
      console.error(`[CDS] AI providers ready: ${configured.length} of ${Object.keys(providers).length} configured.`);
    }
  } catch {
    console.error('[CDS] qwen_config.json not found or unreadable — AI delegation unavailable.');
  }
})();

// Path to claudedev.exe
const CLAUDEDEV_PATH = path.join(CDS_INSTALL_PATH, 'CLI', 'claudedev.exe');

// CDS data storage base — uses Documents folder, works for any user
const CDS_BASE_PATH = path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Default', 'Documents', 'ClaudeDevStudio', 'Projects');

// Chat mirror log — survives context drops
const MIRROR_PATH = path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Default', 'Documents', 'ClaudeDevStudio', 'chat_mirror.jsonl');
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
        },
        {
          name: 'qwen_generate',
          description: 'Delegate a generation task to a specialized AI model. ' +
            'PROVIDERS: together=Qwen3-Coder-480B (best C#/C++ code), groq=Llama-3.3-70B (fastest, quick iteration), ' +
            'deepinfra=Llama-3.3-70B (cheapest, bulk text), fireworks=Qwen3-235B (broad catalog), openrouter=Qwen3.5-397B (fallback). ' +
            'SMART DEFAULTS: mode=code→together, mode=prose→deepinfra, mode=json→groq, mode=fast→groq, mode=cheap→deepinfra. ' +
            'USE FOR: bulk code generation, scaffolding, repetitive output, getting a fast second opinion, cheap bulk text. ' +
            'DO NOT USE FOR: tasks needing full conversation context or architectural judgment — handle those yourself.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt:     { type: 'string', description: 'The task. Be specific — the model has no conversation context.' },
              context:    { type: 'string', description: 'Optional: code snippets, interfaces, or constraints the model needs.' },
              mode:       { type: 'string', enum: ['code', 'prose', 'json', 'fast', 'cheap', 'broad'], description: 'Determines provider routing if provider not set. code→together, prose→deepinfra, json/fast→groq, cheap→deepinfra, broad→fireworks.' },
              provider:   { type: 'string', enum: ['together', 'groq', 'deepinfra', 'fireworks', 'openrouter'], description: 'Override smart routing and use a specific provider explicitly.' },
              max_tokens: { type: 'number', description: 'Max output tokens. Default 4096, hard cap 16384.' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'display_review',
          description: 'Send code or content to the CDS Review Panel (localhost:63000) for Dan to see visually. ' +
            'Use for large code blocks, generated files, or multi-file changes — keeps the chat clean. ' +
            'Dan opens http://localhost:63000 in his browser to see items in real-time. ' +
            'Items persist until dismissed. LANGUAGES: csharp, javascript, json, markdown, text.',
          inputSchema: {
            type: 'object',
            properties: {
              title:    { type: 'string', description: 'Short descriptive title for the item (e.g. "ReviewPage.xaml.cs — Regen fix")' },
              content:  { type: 'string', description: 'The code or text to display.' },
              language: { type: 'string', enum: ['csharp', 'javascript', 'json', 'markdown', 'xml', 'text'], description: 'Syntax highlighting language. Default: text.' },
              tag:      { type: 'string', description: 'Optional short label shown as a badge (e.g. "NEW", "EDIT", "FIX")' },
            },
            required: ['title', 'content'],
          },
        },
        {
          name: 'display_image',
          description: 'Send a generated image (base64) to the CDS Review Panel (localhost:63000) for Dan to see. ' +
            'Use after generate_image, or any time you have base64 image data. ' +
            'Displays with zoom-on-click and a Save button.',
          inputSchema: {
            type: 'object',
            properties: {
              title:     { type: 'string', description: 'Descriptive title (e.g. "App Icon — 512x512")' },
              imageData: { type: 'string', description: 'Base64-encoded image data (no data URI prefix).' },
              mimeType:  { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'], description: 'Image format. Default: image/png' },
              filename:  { type: 'string', description: 'Optional suggested save filename (e.g. "icon_512.png")' },
              tag:       { type: 'string', description: 'Optional badge label (e.g. "ICON", "512x512")' },
            },
            required: ['title', 'imageData'],
          },
        },
        {
          name: 'generate_image',
          description: 'Generate an image using Fireworks SDXL and display it in the Review Panel. ' +
            'Use for icons, logos, illustrations, mockups, concept art. ' +
            'SDXL produces high quality 1024x1024 images (~15-20s). ' +
            'Result auto-displays in Review Panel at localhost:63000. ' +
            'Valid sizes: 1024x1024 (default), 1152x896, 896x1152, 1216x832, 1344x768 (landscape), 768x1344 (portrait). Odd sizes are snapped to nearest.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt:   { type: 'string', description: 'Image description. Be specific: style, colors, subject, dimensions if important.' },
              title:    { type: 'string', description: 'Display title in Review Panel (e.g. "App Icon — dark theme")' },
              width:    { type: 'number', description: 'Width in pixels. Default 1024. Must be multiple of 32.' },
              height:   { type: 'number', description: 'Height in pixels. Default 1024. Must be multiple of 32.' },
              steps:    { type: 'number', description: 'Inference steps. Default 4 (fast). Max 8 for FLUX schnell.' },
              filename: { type: 'string', description: 'Suggested save filename (e.g. "icon_512.png"). Optional.' },
              tag:      { type: 'string', description: 'Badge label in panel (e.g. "FLUX", "ICON"). Optional.' },
            },
            required: ['prompt', 'title'],
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
          case 'qwen_generate':             result = await this.handleQwenGenerate(args); break;
          case 'display_review':            result = await this.handleDisplayReview(args); break;
          case 'display_image':             result = await this.handleDisplayImage(args); break;
          case 'generate_image':            result = await this.handleGenerateImage(args); break;
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
      path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\\\Users\\\\Default', 'Documents', 'ClaudeDevStudio', 'VSBridge')
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
      path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\\\Users\\\\Default', 'Documents', 'ClaudeDevStudio', 'VSBridge')
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
      path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\\\Users\\\\Default', 'Documents', 'ClaudeDevStudio', 'VSBridge')
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
      path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\\\Users\\\\Default', 'Documents', 'ClaudeDevStudio', 'VSBridge')
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

  // ── Qwen Generate — multi-provider AI delegation ─────────────────────────

  async handleQwenGenerate(args) {
    // Load config
    const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      return { content: [{ type: 'text', text: `[AiDelegate] Cannot read qwen_config.json: ${e.message}` }] };
    }

    const mode      = args.mode || 'code';
    const maxTok    = Math.min(args.max_tokens || cfg.limits.max_tokens_default, cfg.limits.max_tokens_hard_cap);

    // Resolve provider: explicit override → smart routing default
    const providerKey = args.provider || cfg.routing_defaults[mode] || 'together';
    const provider    = cfg.providers[providerKey];
    if (!provider) {
      return { content: [{ type: 'text', text: `[AiDelegate] Unknown provider: ${providerKey}` }] };
    }
    if (!provider.api_key || provider.api_key.trim() === '') {
      return { content: [{ type: 'text', text: `[AiDelegate] No API key for provider '${providerKey}'.\nRight-click the ClaudeDevStudio tray icon → Configure AI Keys to add it.` }] };
    }

    // System prompts per mode
    const systemPrompts = {
      code:  'You are an expert C# and C++ developer. Return clean, production-ready, compilable code only. No markdown fences. No explanations unless asked.',
      prose: 'You are a clear, precise technical writer. Write in well-structured paragraphs.',
      json:  'You are a data API. Return ONLY valid JSON. No markdown, no commentary, no preamble.',
      fast:  'Be concise and direct. Answer quickly and accurately.',
      cheap: 'You are a helpful assistant. Be thorough but efficient.',
      broad: 'You are a versatile AI assistant. Complete the task as specified.',
    };

    const userPrompt = args.context
      ? `## Context\n${args.context}\n\n## Task\n${args.prompt}`
      : args.prompt;

    const body = JSON.stringify({
      model:      provider.model,
      max_tokens: maxTok,
      messages: [
        { role: 'system', content: systemPrompts[mode] || systemPrompts.prose },
        { role: 'user',   content: userPrompt },
      ],
    });

    const urlObj = new URL(provider.base_url);
    const t0     = Date.now();

    return new Promise((resolve) => {
      const options = {
        hostname: urlObj.hostname,
        path:     urlObj.pathname + (urlObj.search || ''),
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Authorization':  `Bearer ${provider.api_key}`,
          'Content-Length': Buffer.byteLength(body),
          'HTTP-Referer':   'https://gainpublications.com',
          'X-Title':        'ClaudeDevStudio',
        },
        timeout: cfg.limits.timeout_ms || 120000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const elapsed = Date.now() - t0;
          try {
            const parsed  = JSON.parse(data);
            const content = parsed?.choices?.[0]?.message?.content ?? '';
            const tokIn   = parsed?.usage?.prompt_tokens     ?? 0;
            const tokOut  = parsed?.usage?.completion_tokens ?? 0;
            const cost    = (tokIn * provider.cost_in / 1_000_000) + (tokOut * provider.cost_out / 1_000_000);

            // Log usage
            try {
              const entry = JSON.stringify({
                ts: new Date().toISOString(),
                provider: providerKey, model: provider.model,
                mode, tokIn, tokOut, cost: cost.toFixed(6), elapsed_ms: elapsed,
              }) + '\n';
              if (cfg.log_path) {
                fs.mkdirSync(path.dirname(cfg.log_path), { recursive: true });
                fs.appendFileSync(cfg.log_path, entry, 'utf8');
              }
            } catch { /* never break on log failure */ }

            // Check daily budget (skip if no log_path configured)
            let budgetWarning = '';
            try {
              if (cfg.log_path && fs.existsSync(cfg.log_path)) {
                const today = new Date().toISOString().slice(0, 10);
                const lines = fs.readFileSync(cfg.log_path, 'utf8').split('\n').filter(Boolean);
                const todayTotal = lines
                  .map(l => { try { return JSON.parse(l); } catch { return null; } })
                  .filter(e => e && e.ts && e.ts.startsWith(today))
                  .reduce((sum, e) => sum + parseFloat(e.cost || 0), 0);
                if (todayTotal > cfg.limits.daily_budget_usd) {
                  budgetWarning = `\n⚠️ DAILY BUDGET EXCEEDED: $${todayTotal.toFixed(4)} spent today (limit $${cfg.limits.daily_budget_usd})`;
                }
              }
            } catch { /* ignore budget calc errors */ }

            const header = `[${providerKey.toUpperCase()} | ${provider.model.split('/').pop()} | ${elapsed}ms | in:${tokIn} out:${tokOut} | $${cost.toFixed(5)}]${budgetWarning}\n\n`;
            resolve({ content: [{ type: 'text', text: header + content }] });

          } catch (e) {
            resolve({ content: [{ type: 'text', text: `[AiDelegate] Parse error (${providerKey}): ${e.message}\nRaw: ${data.slice(0, 500)}` }] });
          }
        });
      });

      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: `[AiDelegate] ${providerKey} timed out after ${cfg.limits.timeout_ms}ms.` }] }); });
      req.on('error',   e  => resolve({ content: [{ type: 'text', text: `[AiDelegate] ${providerKey} network error: ${e.message}` }] }));
      req.write(body);
      req.end();
    });
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

  // ── Display Review — send content to localhost:63000 review panel ────────

  async handleDisplayReview(args) {
    const { title, content, language = 'text', tag } = args;
    if (!title || content === undefined) {
      return { content: [{ type: 'text', text: '[ReviewPanel] title and content are required.' }] };
    }
    return new Promise((resolve) => {
      const body = JSON.stringify({ title, content, language, tag });
      const options = {
        hostname: '127.0.0.1',
        port:     63000,
        path:     '/review',
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 3000,
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) {
              resolve({ content: [{ type: 'text', text: `[ReviewPanel] Sent → "${title}" (id:${parsed.id}). Open http://localhost:63000 to view.` }] });
            } else {
              resolve({ content: [{ type: 'text', text: `[ReviewPanel] Server error: ${data}` }] });
            }
          } catch {
            resolve({ content: [{ type: 'text', text: `[ReviewPanel] Bad response: ${data}` }] });
          }
        });
      });
      req.on('error', (e) => {
        resolve({ content: [{ type: 'text', text: `[ReviewPanel] Cannot reach server — is review-server running? Start it with: cd review-server && node server.js\nError: ${e.message}` }] });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ content: [{ type: 'text', text: '[ReviewPanel] Timed out — server not responding.' }] });
      });
      req.write(body);
      req.end();
    });
  }

  // ── Display Image — send base64 image to review panel ────────────────────

  async handleDisplayImage(args) {
    const { title, imageData, mimeType = 'image/png', filename, tag } = args;
    if (!title || !imageData) {
      return { content: [{ type: 'text', text: '[ReviewPanel] title and imageData are required.' }] };
    }
    // Strip data URI prefix if accidentally included
    const clean = imageData.replace(/^data:[^;]+;base64,/, '');
    return new Promise((resolve) => {
      const body = JSON.stringify({ title, imageData: clean, mimeType, filename, tag });
      const options = {
        hostname: '127.0.0.1',
        port:     63000,
        path:     '/image',
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 5000,
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) {
              resolve({ content: [{ type: 'text', text: `[ReviewPanel] Image sent → "${title}" (id:${parsed.id}). Open http://localhost:63000 to view. Click image to zoom, ⬇ Save to download.` }] });
            } else {
              resolve({ content: [{ type: 'text', text: `[ReviewPanel] Server error: ${data}` }] });
            }
          } catch {
            resolve({ content: [{ type: 'text', text: `[ReviewPanel] Bad response: ${data}` }] });
          }
        });
      });
      req.on('error', (e) => resolve({ content: [{ type: 'text', text: `[ReviewPanel] Cannot reach server: ${e.message}` }] }));
      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: '[ReviewPanel] Timed out.' }] }); });
      req.write(body);
      req.end();
    });
  }

  // ── Generate Image — Fireworks SDXL → Review Panel ───────────────────────

  async handleGenerateImage(args) {
    const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
    catch (e) { return { content: [{ type: 'text', text: `[ImageGen] Cannot read qwen_config.json: ${e.message}` }] }; }

    const fireworksKey = cfg.providers?.fireworks?.api_key;
    if (!fireworksKey) return { content: [{ type: 'text', text: '[ImageGen] No Fireworks key in qwen_config.json.' }] };

    const { prompt, title, width = 1024, height = 1024, steps = 20, filename, tag } = args;

    // Fireworks SDXL valid resolutions — snap to nearest supported
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
      cfg_scale:       7,
      width:           snapW,
      height:          snapH,
      steps:           Math.min(steps, 30),
      samples:         1,
      prompt,
      negative_prompt: 'blurry, low quality, distorted, text, watermark',
    });

    return new Promise((resolve) => {
      const bodyBytes = Buffer.from(bodyStr, 'utf8');
      const urlObj   = new URL('https://api.fireworks.ai/inference/v1/image_generation/accounts/fireworks/models/stable-diffusion-xl-1024-v1-0');
      const options  = {
        hostname: urlObj.hostname,
        path:     urlObj.pathname,
        method:   'POST',
        headers: {
          'Authorization': `Bearer ${fireworksKey}`,
          'Content-Type':  'application/json',
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
            return resolve({ content: [{ type: 'text', text: `[ImageGen] Fireworks error: ${buf.toString('utf8').slice(0, 400)}` }] });
          }

          const b64 = buf.toString('base64');
          const displayResult = await this.handleDisplayImage({
            title,
            imageData: b64,
            mimeType:  'image/png',
            filename:  filename || `generated_${Date.now()}.png`,
            tag:       tag || 'SDXL',
          });
          const displayMsg = displayResult?.content?.[0]?.text ?? '';
          resolve({ content: [{ type: 'text', text: `[ImageGen] Fireworks SDXL done (${snapW}×${snapH}). ${displayMsg}` }] });
        });
      });
      req.on('error', (e) => resolve({ content: [{ type: 'text', text: `[ImageGen] Network error: ${e.message}` }] }));
      req.on('timeout', () => { req.destroy(); resolve({ content: [{ type: 'text', text: '[ImageGen] Timed out after 120s.' }] }); });
      req.write(bodyBytes);
      req.end();
    });
  }

  // ── Auto-start Review Panel server ───────────────────────────────────────

  startReviewPanel() {
    const serverPath = path.join(CDS_INSTALL_PATH, 'review-server', 'server.js');
    if (!fs.existsSync(serverPath)) {
      console.error('[ReviewPanel] server.js not found, skipping auto-start.');
      return;
    }
    // Check if already running
    const checkReq = http.request({ hostname: '127.0.0.1', port: 63000, path: '/status', method: 'GET', timeout: 1000 }, (res) => {
      console.error('[ReviewPanel] Already running on port 63000.');
    });
    checkReq.on('error', () => {
      // Not running — start it
      const child = spawn(process.execPath, [serverPath], {
        detached: true,
        stdio:    'ignore',
      });
      child.unref();
      console.error('[ReviewPanel] Started on http://localhost:63000');
    });
    checkReq.end();
  }

  async run() {
    this.startReviewPanel();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ClaudeDevStudio MCP server running on stdio');
  }
}

// Start the server
const server = new ClaudeDevStudioServer();
server.run().catch(console.error);
