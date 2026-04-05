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

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CDS_INSTALL_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local'),
  'ClaudeDevStudio'
);
const CLAUDEDEV_PATH = path.join(CDS_INSTALL_PATH, 'CLI', 'claudedev.exe');
const CDS_BASE_PATH = path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Default', 'Documents', 'ClaudeDevStudio', 'Projects');
const MIRROR_PATH = path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Default', 'Documents', 'ClaudeDevStudio', 'chat_mirror.jsonl');
const MIRROR_MAX_LINES = 2000;
const MIRROR_TOOL_TTL_MS  = 24 * 60 * 60 * 1000;
const MIRROR_CKPT_TTL_MS  = 30 * 24 * 60 * 60 * 1000;

function getCdsProjectPath(sourceProjectPath) {
  const projectName = path.basename(sourceProjectPath);
  return path.join(CDS_BASE_PATH, projectName);
}

async function runClaudeDevCommand(args) {
  try {
    const command = `& "${CLAUDEDEV_PATH}" ${args}`;
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
      shell: 'powershell.exe'
    });
    return { success: true, output: stdout || stderr, error: null };
  } catch (error) {
    return { success: false, output: error.stdout || '', error: error.message };
  }
}

async function switchToProject(sourceProjectPath) {
  const projectName = path.basename(sourceProjectPath);
  await runClaudeDevCommand(`switch ${projectName}`);
}

function readCdsContext(sourceProjectPath) {
  const cdsPath = getCdsProjectPath(sourceProjectPath);
  const projectName = path.basename(sourceProjectPath);
  let context = `=== ClaudeDevStudio Context: ${projectName} ===\nCDS Data Path: ${cdsPath}\n\n`;
  if (!fs.existsSync(cdsPath)) {
    return context + `[No CDS data found at ${cdsPath}. Run claudedev_init first.]\n`;
  }
  const coreFiles = [
    { label: 'Session State', file: 'CURRENT_SESSION_STATE.md' },
    { label: 'Facts', file: 'FACTS.md' },
    { label: 'Uncertainties', file: 'UNCERTAINTIES.md' },
  ];
  for (const { label, file } of coreFiles) {
    const filePath = path.join(cdsPath, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content) context += `--- ${label} ---\n${content}\n\n`;
    }
  }
  const activityDir = path.join(cdsPath, 'Activity');
  if (fs.existsSync(activityDir)) {
    const files = fs.readdirSync(activityDir)
      .filter(f => f.endsWith('.json') || f.endsWith('.md'))
      .sort().slice(-10);
    if (files.length > 0) {
      context += `--- Recent Activity (last ${files.length} entries) ---\n`;
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(activityDir, f), 'utf8').trim();
          context += `[${f}]\n${raw}\n\n`;
        } catch { /* skip */ }
      }
    }
  }
  return context;
}

function mirrorLog(type, data) {
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n';
    fs.mkdirSync(path.dirname(MIRROR_PATH), { recursive: true });
    fs.appendFileSync(MIRROR_PATH, entry, 'utf8');
    const lines = fs.readFileSync(MIRROR_PATH, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean);
    if (lines.length > MIRROR_MAX_LINES) mirrorTrim(lines);
  } catch { /* never break a tool call over logging */ }
}

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

class ClaudeDevStudioServer {
  constructor() {
    this.server = new Server(
      { name: 'claudedevstudio', version: '1.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'claudedev_init',
          description: 'Initialize CDS memory for a project. Call once per project, then call claudedev_load.',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string', description: 'Full path to the project folder' } },
            required: ['project_path'],
          },
        },
        {
          name: 'claudedev_load',
          description: 'Load project memory into this session. Call at session start.',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string', description: 'Full path to the project folder' } },
            required: ['project_path'],
          },
        },
        {
          name: 'claudedev_record_activity',
          description: 'Record work done to persistent memory. Call after meaningful tasks.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: { type: 'string', description: 'Project folder path' },
              action: { type: 'string', description: 'Type: code_change, debug, fix, etc.' },
              description: { type: 'string', description: 'What was done' },
              file: { type: 'string', description: 'File modified (optional)' },
              outcome: { type: 'string', description: 'success or failed' },
            },
            required: ['project_path', 'action', 'description'],
          },
        },
        {
          name: 'claudedev_record_mistake',
          description: 'Record a mistake to prevent repeating it.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: { type: 'string', description: 'Project folder path' },
              mistake: { type: 'string' }, impact: { type: 'string' },
              fix: { type: 'string' }, lesson: { type: 'string' },
            },
            required: ['project_path', 'mistake', 'impact', 'fix', 'lesson'],
          },
        },
        {
          name: 'claudedev_check_mistake',
          description: 'Check if a planned action matches a past mistake.',
          inputSchema: {
            type: 'object',
            properties: {
              project_path: { type: 'string' },
              action_description: { type: 'string', description: 'Action you plan to take' },
            },
            required: ['project_path', 'action_description'],
          },
        },
        {
          name: 'claudedev_stats',
          description: 'Show memory statistics for a project.',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string' } },
            required: ['project_path'],
          },
        },
        {
          name: 'claudedev_monitor_start',
          description: 'Start monitoring Visual Studio debug output.',
          inputSchema: {
            type: 'object',
            properties: { project_path: { type: 'string' } },
            required: ['project_path'],
          },
        },
        {
          name: 'claudedev_chat_checkpoint',
          description: 'Save a checkpoint to the session log. Survives context drops.',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: 'What to record (under 300 chars)' } },
            required: ['text'],
          },
        },
        {
          name: 'claudedev_chat_resume',
          description: 'Recover context after a session drop. Returns recent checkpoints and tool activity.',
          inputSchema: {
            type: 'object',
            properties: { hours: { type: 'number', description: 'Hours of tool history to show (default 4)' } },
            required: [],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
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
          case 'claudedev_chat_checkpoint': return this.handleChatCheckpoint(args);
          case 'claudedev_chat_resume':     return this.handleChatResume(args);
          default: throw new Error(`Unknown tool: ${name}`);
        }
        const resolved = result && typeof result.then === 'function' ? await result : result;
        if (!skipMirror) {
          const summary = (resolved?.content?.[0]?.text ?? '').slice(0, 120).replace(/\n/g, ' ');
          mirrorLog('tool', { tool: name, summary });
        }
        return resolved;
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
      }
    });
  }

  async handleInit(args) {
    const cdsPath = getCdsProjectPath(args.project_path);
    const result = await runClaudeDevCommand(`init "${cdsPath}"`);
    return { content: [{ type: 'text', text: result.success ? result.output : `Error: ${result.error}\n${result.output}` }] };
  }

  async handleLoad(args) {
    await switchToProject(args.project_path);
    const context = readCdsContext(args.project_path);
    return { content: [{ type: 'text', text: context }] };
  }

  async handleRecordActivity(args) {
    await switchToProject(args.project_path);
    const activityJson = JSON.stringify({
      action: args.action, description: args.description,
      file: args.file || '', outcome: args.outcome || 'success'
    });
    const escapedJson = activityJson.replace(/'/g, "''");
    const result = await runClaudeDevCommand(`record activity '${escapedJson}'`);
    this.writeActivityFile(args.project_path, 'activity', {
      action: args.action, description: args.description,
      file: args.file || '', outcome: args.outcome || 'success',
      timestamp: new Date().toISOString()
    });
    return { content: [{ type: 'text', text: result.success ? '✓ Activity recorded' : `CLI error (wrote directly): ${result.error}` }] };
  }

  async handleRecordMistake(args) {
    await switchToProject(args.project_path);
    const mistakeJson = JSON.stringify({
      mistake: args.mistake, impact: args.impact, fix: args.fix, lesson: args.lesson
    });
    const escapedJson = mistakeJson.replace(/'/g, "''");
    const result = await runClaudeDevCommand(`record mistake '${escapedJson}'`);
    this.writeActivityFile(args.project_path, 'mistake', {
      mistake: args.mistake, impact: args.impact, fix: args.fix, lesson: args.lesson,
      timestamp: new Date().toISOString()
    });
    return { content: [{ type: 'text', text: result.success ? '✓ Mistake recorded' : `CLI error (wrote directly): ${result.error}` }] };
  }

  writeActivityFile(sourceProjectPath, type, data) {
    try {
      const cdsPath = getCdsProjectPath(sourceProjectPath);
      const activityDir = path.join(cdsPath, 'Activity');
      if (!fs.existsSync(activityDir)) fs.mkdirSync(activityDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.writeFileSync(path.join(activityDir, `${timestamp}_${type}.json`), JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`writeActivityFile failed: ${err.message}`);
    }
  }

  async handleCheckMistake(args) {
    await switchToProject(args.project_path);
    const result = await runClaudeDevCommand(`check "${args.action_description}"`);
    return { content: [{ type: 'text', text: result.output || '✓ No matching prior mistakes found' }] };
  }

  async handleStats(args) {
    await switchToProject(args.project_path);
    const result = await runClaudeDevCommand(`stats`);
    let extra = '';
    try {
      const cdsPath = getCdsProjectPath(args.project_path);
      const activityDir = path.join(cdsPath, 'Activity');
      if (fs.existsSync(activityDir)) {
        const files = fs.readdirSync(activityDir);
        extra = `\nDirect file counts — Activities: ${files.filter(f => f.includes('_activity')).length}, Mistakes: ${files.filter(f => f.includes('_mistake')).length}`;
      }
    } catch { /* skip */ }
    return { content: [{ type: 'text', text: (result.success ? result.output : `Error: ${result.error}`) + extra }] };
  }

  async handleMonitorStart(args) {
    const result = await runClaudeDevCommand(`monitor "${args.project_path}"`);
    return { content: [{ type: 'text', text: result.success ? 'Debug monitor started.' : `Error: ${result.error}` }] };
  }

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
        } catch { /* skip */ }
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ClaudeDevStudio MCP server running on stdio');
  }
}

const server = new ClaudeDevStudioServer();
server.run().catch(console.error);
