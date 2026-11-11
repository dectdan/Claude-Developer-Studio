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
      ],
    }));


    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case 'claudedev_init':           return await this.handleInit(args);
          case 'claudedev_load':           return await this.handleLoad(args);
          case 'claudedev_record_activity':return await this.handleRecordActivity(args);
          case 'claudedev_record_mistake': return await this.handleRecordMistake(args);
          case 'claudedev_check_mistake':  return await this.handleCheckMistake(args);
          case 'claudedev_stats':          return await this.handleStats(args);
          case 'claudedev_monitor_start':  return await this.handleMonitorStart(args);
          case 'fetch_url':               return await this.handleFetchUrl(args);
          default: throw new Error(`Unknown tool: ${name}`);
        }
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('ClaudeDevStudio MCP server running on stdio');
  }
}

// Start the server
const server = new ClaudeDevStudioServer();
server.run().catch(console.error);
