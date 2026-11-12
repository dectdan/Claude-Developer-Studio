#!/usr/bin/env node
// ClaudeDevStudio core memory MCP server ("claudedevstudio").
//
// This server is a thin wrapper over the claudedev CLI. The CLI owns the memory
// format (Activity\YYYY-MM-DD.jsonl, MISTAKES.jsonl, DECISIONS.jsonl, PATTERNS.jsonl,
// session_state.json, FACTS.md, UNCERTAINTIES.md). Every write goes through the CLI;
// this server only reads the files to build the context it returns on load.
//
// v1.3.0 (2026-11-11): fixes the split-memory bug. Before this version the server
// called the CLI with the wrong arguments (so init, record and check never ran) and
// read/wrote %USERPROFILE%\Documents while the CLI used the real Documents folder
// (OneDrive-redirected on most Windows 11 PCs). See docs\GROUND_TRUTH.md.
//
// P3 (2026-11-11): load leads with the project's own state (the last handoff, the ground
// truth's Status and Next, the newest docs\Pn_OUTPUT.md) under a size budget; projects
// without a ground truth are offered claudedev_scaffold (templates\); claudedev_handoff and
// claudedev_record_decision write through the CLI. The scaffold writes into the user's
// project, not the memory, so it is the one tool that writes files itself.
//
// P4 (2026-11-11): load's context (buildContext and what it reads) moved unchanged to
// cds-context.js, which the Claude Code hook (cds-hook.js) uses too.
//
// P5 (2026-11-11): claudedev_search (cds-search.js: words across one project's memory or all of
// them, read-only) and lessons for every project (LESSONS.jsonl at the memory root, written by
// the CLI's "lesson add"): load shows them, check_mistake checks them, and record_mistake
// suggests one when the same mistake is recorded in two or more other projects.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { memoryRoot } from './cds-paths.js';
import {
  CLAUDEDEV_PATH, LEGACY_ROOT, projectName, projectMemoryDir, legacyMemoryDir,
  cleanCliText, runCli, cliMessage, readText, readJsonLines, entrySource, collectEntries,
  oneLine, day, localDate, readDoc, findGroundTruth, loadProject, readLessons, lessonsFile,
} from './cds-context.js';
import { similarMistakes, similarLessons, search, sameMistakeElsewhere, KINDS, SEARCH_LIMIT } from './cds-search.js';

// The version is set in package.json beside this file (checked by tools\check-versions.ps1).
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || 'unknown'; }
  catch { return 'unknown'; }
})();
// The scaffold's templates (docs\GROUND_TRUTH.md, CONVENTIONS.md, HOW_WE_WORK.md for a project).
const TEMPLATES_DIR = fileURLToPath(new URL('./templates/', import.meta.url));

const MIRROR_MAX_LINES = 2000;
const MIRROR_TOOL_TTL_MS = 24 * 60 * 60 * 1000;
const MIRROR_CKPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// projectName, projectMemoryDir and legacyMemoryDir are in cds-context.js (shared with cds-hook.js).
const mirrorPath = () => path.join(memoryRoot(), 'chat_mirror.jsonl');
const legacyMirrorPath = () => path.join(LEGACY_ROOT, 'chat_mirror.jsonl');

// Validates project_path and normalises it. The CLI uses Path.GetFileName(path) as the
// project name, so a trailing backslash would give it an empty name: path.resolve strips it.
function requireProjectPath(args) {
  const raw = args && args.project_path ? String(args.project_path).trim() : '';
  if (!raw) throw new Error('project_path is required: the full path to the project folder, e.g. C:\\Projects\\MyApp');
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) throw new Error(`Project folder not found: ${resolved}`);
  if (!projectName(resolved)) throw new Error(`Not a project folder (no folder name): ${resolved}`);
  return resolved;
}

// " (HND004)" when the CLI's output names the new entry's ID.
const idIn = (r, prefix) => { const m = new RegExp(`\\b${prefix}\\d{3,}\\b`).exec(r.stdout); return m ? ` (${m[0]})` : ''; };

// A CLI from before v1.4 has no "handoff" record type.
const olderCliHint = (r) => /Unknown record type/i.test(cliMessage(r))
  ? 'The installed claudedev.exe is older than this server and has no handoffs: update ClaudeDevStudio.\n' : '';

const SCAFFOLD_FILES = ['GROUND_TRUTH.md', 'CONVENTIONS.md', 'HOW_WE_WORK.md'];

// The keyword rule for "does this plan look like a recorded mistake" (keywords, similarMistakes,
// similarLessons) is in cds-search.js, shared with the search; it must stay in step with the
// CLI's MistakeMatching in MemorySchemas.cs.

// A CLI from before P5 has no "lesson" command.
const noLessonsHint = (r) => /Unknown command: lesson/i.test(cliMessage(r))
  ? 'The installed claudedev.exe is older than this server and has no lessons: update ClaudeDevStudio.\n' : '';

// load's context (buildContext and everything it reads) is in cds-context.js, shared with
// the Claude Code hook (cds-hook.js).

// ---------------------------------------------------------------------------
// Chat mirror (checkpoint / resume)
// ---------------------------------------------------------------------------

function mirrorLog(type, data) {
  try {
    const file = mirrorPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n', 'utf8');
    const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean);
    if (lines.length > MIRROR_MAX_LINES) mirrorTrim(file, lines);
  } catch { /* never break a tool call over logging */ }
}

function mirrorTrim(file, lines) {
  try {
    const now = Date.now();
    const kept = lines.filter(line => {
      try {
        const e = JSON.parse(line);
        const age = now - new Date(e.ts).getTime();
        return e.type === 'checkpoint' ? age < MIRROR_CKPT_TTL_MS : age < MIRROR_TOOL_TTL_MS;
      } catch { return false; }
    });
    fs.writeFileSync(file, kept.join('\n') + '\n', 'utf8');
  } catch { /* silent */ }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// Sent with every session: keep it short.
const INSTRUCTIONS =
  'ClaudeDevStudio keeps a software project\'s memory across sessions and teaches one way of working: ' +
  'a docs\\GROUND_TRUTH.md (status, decisions, next steps) and a handoff between sessions. ' +
  'At the start of work on a project, call claudedev_load with its folder: the last handoff, the ground truth\'s status, the newest output and the recorded mistakes. ' +
  'If it has no ground truth, offer claudedev_scaffold to the user; create it only if they agree. ' +
  'Before a risky step, call claudedev_check_mistake. ' +
  'As you go, record activities, mistakes (with the lesson) and decisions (with the reason). ' +
  'To find something from earlier sessions, in this project or any other, call claudedev_search; a lesson that holds for every project goes in claudedev_record_lesson. ' +
  'Before you stop, call claudedev_handoff: where you stopped and the next step.';

const PROJECT_PATH = { type: 'string', description: 'Full path to the project folder, e.g. C:\\Projects\\MyApp' };

const TOOLS = [
  {
    name: 'claudedev_init',
    description: 'Create CDS memory for a project. Optional: claudedev_load does this automatically the first time.',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_load',
    description: 'Start of work on a project: the last handoff, the ground truth\'s status, the newest output, mistakes and decisions. Creates the memory if new.',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_scaffold',
    description: 'Add docs\\GROUND_TRUTH.md, CONVENTIONS.md and HOW_WE_WORK.md from templates to a project without them. Never overwrites. Only if the user agrees.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        title: { type: 'string', description: 'Project name for the headings (default: the folder name)' },
        summary: { type: 'string', description: 'One paragraph: what the project is (optional)' },
      },
      required: ['project_path'],
    },
  },
  {
    name: 'claudedev_handoff',
    description: 'Before you stop: save where you stopped and the next step. The next claudedev_load shows it first.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        where_i_stopped: { type: 'string', description: 'What was done and where it stands' },
        next_step: { type: 'string', description: 'The very next thing to do' },
        open_questions: { type: 'array', items: { type: 'string' }, description: 'Questions waiting for the user (optional)' },
        notes: { type: 'string', description: 'Anything else the next session needs (optional)' },
      },
      required: ['project_path', 'where_i_stopped', 'next_step'],
    },
  },
  {
    name: 'claudedev_record_decision',
    description: 'Record a decision and why, so later sessions don\'t re-argue it.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        decision: { type: 'string', description: 'What was decided' },
        why: { type: 'string', description: 'The reason' },
        alternatives: { type: 'array', items: { type: 'string' }, description: 'Options not chosen (optional)' },
        file: { type: 'string', description: 'Main file involved (optional)' },
      },
      required: ['project_path', 'decision', 'why'],
    },
  },
  {
    name: 'claudedev_record_activity',
    description: 'Record work done to the project\'s memory. Call after meaningful tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        action: { type: 'string', description: 'Kind of work: code_change, fix, debug, build, release, decision, etc.' },
        description: { type: 'string', description: 'What was done and why' },
        file: { type: 'string', description: 'Main file involved (optional)' },
        outcome: { type: 'string', description: 'success (default) or failed' },
      },
      required: ['project_path', 'action', 'description'],
    },
  },
  {
    name: 'claudedev_record_mistake',
    description: 'Record a mistake and its lesson so it is not repeated.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: PROJECT_PATH,
        mistake: { type: 'string', description: 'What went wrong' },
        impact: { type: 'string', description: 'What it caused' },
        fix: { type: 'string', description: 'How it was fixed' },
        lesson: { type: 'string', description: 'What to do differently' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Default medium' },
      },
      required: ['project_path', 'mistake', 'impact', 'fix', 'lesson'],
    },
  },
  {
    name: 'claudedev_check_mistake',
    description: 'Check a planned action against the project\'s recorded mistakes and the lessons for every project before doing it.',
    inputSchema: {
      type: 'object',
      properties: { project_path: PROJECT_PATH, action_description: { type: 'string', description: 'The action you plan to take' } },
      required: ['project_path', 'action_description'],
    },
  },
  {
    name: 'claudedev_search',
    description: 'Find past mistakes, decisions, patterns, handoffs, lessons and activity by words, in one project or all of them.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words (4+ letters count); "quoted phrases" must appear as written' },
        project_path: { type: 'string', description: 'Only this project (default: all projects)' },
        kinds: { type: 'array', items: { type: 'string', enum: KINDS }, description: 'Only these kinds (default: all)' },
        limit: { type: 'number', description: `Most lines to show (default ${SEARCH_LIMIT}, at most 40)` },
      },
      required: ['query'],
    },
  },
  {
    name: 'claudedev_record_lesson',
    description: 'Record a lesson for every project: load shows it in all projects and check_mistake checks it.',
    inputSchema: {
      type: 'object',
      properties: {
        lesson: { type: 'string', description: 'The lesson, in one plain sentence' },
        why: { type: 'string', description: 'Where it was learned: the project, the date, what happened' },
        source_project: { type: 'string', description: 'The project it was learned in (optional)' },
      },
      required: ['lesson', 'why'],
    },
  },
  {
    name: 'claudedev_stats',
    description: 'Show memory statistics for a project.',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_monitor_start',
    description: 'Start capturing Visual Studio debug output into the project\'s memory (needs Sysinternals DebugView installed).',
    inputSchema: { type: 'object', properties: { project_path: PROJECT_PATH }, required: ['project_path'] },
  },
  {
    name: 'claudedev_chat_checkpoint',
    description: 'Save a short checkpoint to the session log. Survives context drops.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'What to record (under 300 characters)' } },
      required: ['text'],
    },
  },
  {
    name: 'claudedev_chat_resume',
    description: 'Recover context after a session drop: recent checkpoints and tool activity.',
    inputSchema: {
      type: 'object',
      properties: { hours: { type: 'number', description: 'Hours of tool history to show (default 4)' } },
      required: [],
    },
  },
];

class ClaudeDevStudioServer {
  constructor() {
    this.server = new Server(
      { name: 'claudedevstudio', version: VERSION },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
    );
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    this.server.setRequestHandler(CallToolRequestSchema, (request) => this.callTool(request));
  }

  async callTool(request) {
    const { name, arguments: args } = request.params;
    let result;
    try {
      switch (name) {
        case 'claudedev_init':            result = await this.handleInit(args); break;
        case 'claudedev_load':            result = await this.handleLoad(args); break;
        case 'claudedev_scaffold':        result = this.handleScaffold(args); break;
        case 'claudedev_handoff':         result = await this.handleHandoff(args); break;
        case 'claudedev_record_decision': result = await this.handleRecordDecision(args); break;
        case 'claudedev_record_activity': result = await this.handleRecordActivity(args); break;
        case 'claudedev_record_mistake':  result = await this.handleRecordMistake(args); break;
        case 'claudedev_check_mistake':   result = await this.handleCheckMistake(args); break;
        case 'claudedev_search':          result = await this.handleSearch(args); break;
        case 'claudedev_record_lesson':   result = await this.handleRecordLesson(args); break;
        case 'claudedev_stats':           result = await this.handleStats(args); break;
        case 'claudedev_monitor_start':   result = await this.handleMonitorStart(args); break;
        case 'claudedev_chat_checkpoint': return this.handleChatCheckpoint(args);
        case 'claudedev_chat_resume':     return this.handleChatResume(args);
        default: return fail(`Unknown tool: ${name}`);
      }
    } catch (error) {
      result = fail(`Error: ${error.message}`);
    }
    // Search is read-only, so it writes nothing at all: not even its line in the chat mirror.
    if (name === 'claudedev_search') return result;
    const summary = (result?.content?.[0]?.text ?? '').slice(0, 120).replace(/\n/g, ' ');
    mirrorLog('tool', { tool: name, summary });
    return result;
  }

  async handleInit(args) {
    const p = requireProjectPath(args);
    const r = await runCli(['init', p]);
    if (r.code !== 0) return fail(`Could not create memory for ${projectName(p)}.\n${cliMessage(r)}`);
    return text(`\u2713 Memory ready for ${projectName(p)}.\nMemory folder: ${projectMemoryDir(p)}\nNext: call claudedev_load.`);
  }

  async handleLoad(args) {
    const p = requireProjectPath(args);
    // cds-context.js: init on first use, CLI load, then the context (the hook uses the same).
    const r = await loadProject(p);
    return r.ok ? text(r.text) : fail(r.text);
  }

  // Writes the three method files into the user's project (not memory, so this server writes
  // them itself). Never overwrites: each file is created with the exclusive flag.
  handleScaffold(args) {
    const p = requireProjectPath(args);
    const templates = {};
    for (const name of SCAFFOLD_FILES) {
      const t = readDoc(path.join(TEMPLATES_DIR, name));
      if (t === null) return fail(`Nothing created: the template ${path.join(TEMPLATES_DIR, name)} is missing. Reinstall ClaudeDevStudio.`);
      templates[name] = t;
    }
    const title = oneLine(args.title || projectName(p), 120);
    const summary = args.summary && String(args.summary).trim()
      ? String(args.summary).trim()
      : '*(Not written yet: one paragraph on what this project is, who it is for, and what "done" looks like. Write it with the owner.)*';
    const date = localDate();
    const docs = path.join(p, 'docs');
    // A ground truth under another name (or at the root) is this project's: don't add a second one.
    const existingGt = findGroundTruth(p);
    const created = [], skipped = [];
    fs.mkdirSync(docs, { recursive: true });
    for (const name of SCAFFOLD_FILES) {
      const target = path.join(docs, name);
      const rel = path.relative(p, target);
      if (name === 'GROUND_TRUTH.md' && existingGt && path.resolve(existingGt).toLowerCase() !== target.toLowerCase()) {
        skipped.push(`${rel} (the project's ground truth is ${path.relative(p, existingGt)})`);
        continue;
      }
      const content = templates[name]
        .replace(/\{\{PROJECT\}\}/g, () => title)
        .replace(/\{\{DATE\}\}/g, () => date)
        .replace(/\{\{SUMMARY\}\}/g, () => summary)
        .replace(/\n/g, '\r\n');
      try {
        fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
        created.push(rel);
      } catch (e) {
        if (e.code !== 'EEXIST') return fail(`Stopped at ${rel}: ${e.message}\nCreated before that: ${created.join(', ') || 'nothing'}.`);
        skipped.push(`${rel} (already there, not changed)`);
      }
    }
    const out = [`Scaffold for ${title} (${docs}):`];
    out.push(created.length ? `Created: ${created.join(', ')}` : 'Created: nothing.');
    if (skipped.length) out.push(`Skipped: ${skipped.join('; ')}`);
    if (created.includes(path.join('docs', 'GROUND_TRUTH.md'))) {
      out.push('Next: fill in sections 1–3 of docs\\GROUND_TRUTH.md with the user (what this is, the status, where things are). claudedev_load shows its Status from now on.');
    } else if (created.length) {
      out.push('Next: read the new files with the user and add this project\'s own rules to docs\\CONVENTIONS.md.');
    }
    return text(out.join('\n'));
  }

  async handleHandoff(args) {
    const p = requireProjectPath(args);
    const where = String(args.where_i_stopped ?? '').trim();
    const next = String(args.next_step ?? '').trim();
    if (!where || !next) return fail('where_i_stopped and next_step are required.');
    let questions = args.open_questions ?? [];
    if (typeof questions === 'string') questions = questions.split(/\r?\n/);
    if (!Array.isArray(questions)) questions = [String(questions)];
    const entry = {
      where_i_stopped: where,
      next_step: next,
      open_questions: questions.map(q => String(q ?? '').trim()).filter(Boolean),
    };
    if (args.notes && String(args.notes).trim()) entry.notes = String(args.notes).trim();
    const r = await runCli(['record', p, 'handoff', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Handoff was NOT saved for ${projectName(p)}.\n${olderCliHint(r)}${cliMessage(r)}`);
    return text(`✓ Handoff saved for ${projectName(p)}${idIn(r, 'HND')}. The next claudedev_load shows it first.`);
  }

  async handleRecordDecision(args) {
    const p = requireProjectPath(args);
    const decision = String(args.decision ?? '').trim();
    const why = String(args.why ?? '').trim();
    if (!decision || !why) return fail('decision and why are required.');
    let alternatives = args.alternatives ?? [];
    if (typeof alternatives === 'string') alternatives = [alternatives];
    if (!Array.isArray(alternatives)) alternatives = [String(alternatives)];
    const entry = {
      decision, chose: decision, reasoning: why,
      alternatives_considered: alternatives.map(a => String(a ?? '').trim()).filter(Boolean),
    };
    if (args.file) entry.file = String(args.file);
    const r = await runCli(['record', p, 'decision', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Decision was NOT recorded for ${projectName(p)}.\n${cliMessage(r)}`);
    return text(`✓ Decision recorded for ${projectName(p)}${idIn(r, 'DEC')}: ${oneLine(decision, 80)}`);
  }

  async handleRecordActivity(args) {
    const p = requireProjectPath(args);
    if (!args.action || !args.description) return fail('action and description are required.');
    const outcome = args.outcome ? String(args.outcome).trim() : '';
    const description = outcome && outcome.toLowerCase() !== 'success'
      ? `${args.description} [outcome: ${outcome}]` : String(args.description);
    const entry = { action: String(args.action), description };
    if (args.file) entry.file = String(args.file);
    const r = await runCli(['record', p, 'activity', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Activity was NOT recorded for ${projectName(p)}.\n${cliMessage(r)}`);
    return text(`\u2713 Activity recorded for ${projectName(p)}: ${oneLine(args.action, 60)}`);
  }

  async handleRecordMistake(args) {
    const p = requireProjectPath(args);
    for (const k of ['mistake', 'impact', 'fix', 'lesson']) {
      if (!args[k]) return fail(`${k} is required.`);
    }
    const entry = {
      mistake: String(args.mistake), impact: String(args.impact),
      fix: String(args.fix), lesson: String(args.lesson),
      severity: ['low', 'medium', 'high', 'critical'].includes(args.severity) ? args.severity : 'medium',
    };
    const r = await runCli(['record', p, 'mistake', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Mistake was NOT recorded for ${projectName(p)}.\n${cliMessage(r)}`);
    const out = [`\u2713 Mistake recorded for ${projectName(p)}. claudedev_check_mistake will now warn on similar actions.`];
    // The same mistake in two or more other projects: suggest a lesson for every project (only a
    // suggestion; nothing more is written unless Claude calls claudedev_record_lesson).
    try {
      const words = `${entry.mistake} ${entry.lesson}`;
      const covered = similarLessons(words, readLessons(), 1)[0];
      if (covered) {
        out.push(`A lesson for every project already covers it: ${covered.l.id || ''} ${oneLine(covered.l.lesson, 200)}`.replace('  ', ' '));
      } else {
        const elsewhere = await sameMistakeElsewhere(words, projectName(p));
        if (elsewhere.length >= 2) {
          const list = elsewhere.slice(0, 5).map(x => `${x.project} ${day(x.ts)}`).join(', ');
          out.push(`The same mistake is recorded in ${elsewhere.length} other projects (${list}${elsewhere.length > 5 ? ', ...' : ''}). ` +
            'If its lesson holds for every project, record it once with claudedev_record_lesson (a suggestion: nothing else was written).');
        }
      }
    } catch { /* the suggestion is optional; the mistake is recorded */ }
    return text(out.join('\n'));
  }

  // The CLI's check (the same keyword rule, MistakeMatching in MemorySchemas.cs) and the same rule
  // here, which also covers the v1.2.x store and works with an older CLI. From P5 both also check
  // the lessons for every project. The CLI's text is shown only if it found what this didn't.
  async handleCheckMistake(args) {
    const p = requireProjectPath(args);
    if (!args.action_description) return fail('action_description is required.');
    const plan = String(args.action_description);
    const r = await runCli(['check', p, plan]);
    const cliHit = /Mistake ID:|Lesson ID:/i.test(r.stdout);
    if (!cliHit && r.code !== 0) return fail(`The mistake check could not run.\n${cliMessage(r)}`);

    const dirs = [...new Set([projectMemoryDir(p), legacyMemoryDir(p)])];
    const hits = similarMistakes(plan, collectEntries(dirs).mistakes);
    const lessonHits = similarLessons(plan, readLessons());
    if (!cliHit && hits.length === 0 && lessonHits.length === 0) {
      return text(`\u2713 No recorded mistake or lesson for every project matches this action in ${projectName(p)}.`);
    }

    const out = [];
    if (hits.length) out.push(`\u26a0 This plan resembles ${hits.length} recorded mistake${hits.length > 1 ? 's' : ''} in ${projectName(p)}:`);
    for (const { m, shared } of hits) {
      out.push(`- [${day(m.timestamp)}] ${oneLine(m.mistake, 220)}\n  lesson: ${oneLine(m.lesson, 220)}\n  fix: ${oneLine(m.fix, 220)}\n  (shared words: ${shared.join(', ')})`);
    }
    if (lessonHits.length) {
      out.push(`\u26a0 ${hits.length ? 'It also matches' : 'This plan matches'} ${lessonHits.length} lesson${lessonHits.length > 1 ? 's' : ''} for every project (machine-wide, ${lessonsFile()}):`);
      for (const { l, shared } of lessonHits) {
        out.push(`- ${l.id || '(no id)'}: ${oneLine(l.lesson, 220)}${l.why ? `\n  learned: ${oneLine(l.why, 200)}` : ''}\n  (shared words: ${shared.join(', ')})`);
      }
    }
    if (cliHit && !hits.length && !lessonHits.length) {
      out.push(`\u26a0 This plan resembles a recorded mistake in ${projectName(p)}:`, r.stdout);
    }
    return text(out.join('\n'));
  }

  // Read-only: lists and reads memory files, never creates or changes anything.
  async handleSearch(args) {
    args = args || {};
    const query = String(args.query ?? '').trim();
    if (!query) return fail('query is required: a few words, e.g. "OneDrive Documents path".');
    let project = '';
    if (args.project_path && String(args.project_path).trim()) {
      project = projectName(path.resolve(String(args.project_path).trim()));
      if (!project) return fail(`Not a project folder (no folder name): ${args.project_path}`);
      const exists = [...new Set([projectMemoryDir(project), legacyMemoryDir(project)])].some(d => fs.existsSync(d));
      if (!exists) return text(`No memory for ${project} (nothing under ${path.dirname(projectMemoryDir(project))}). Search all projects without project_path.`);
    }
    const r = await search({ query, project, kinds: args.kinds, limit: args.limit });
    return r.error ? fail(r.error) : text(r.text);
  }

  // Machine-wide: written by the CLI ("lesson add"), which refuses an empty lesson and a
  // near-duplicate of an existing one (the mistake-matching rule), naming the match.
  async handleRecordLesson(args) {
    args = args || {};
    const lesson = String(args.lesson ?? '').trim();
    const why = String(args.why ?? '').trim();
    if (!lesson) return fail('Lesson was NOT recorded: the lesson is empty.');
    if (!why) return fail('Lesson was NOT recorded: why is required (where it was learned: the project, the date, what happened).');
    const entry = { lesson, why };
    if (args.source_project && String(args.source_project).trim()) entry.source_project = oneLine(args.source_project, 120);
    const r = await runCli(['lesson', 'add', JSON.stringify(entry)]);
    if (r.code !== 0) return fail(`Lesson was NOT recorded.\n${noLessonsHint(r)}${cliMessage(r)}`);
    return text(`\u2713 Lesson for every project recorded${idIn(r, 'LSN')}: ${oneLine(lesson, 120)}\nclaudedev_load shows it in every project; claudedev_check_mistake checks it. File: ${lessonsFile()}`);
  }

  // Counts what is actually stored. (The CLI's own stats report uptime, a token counter
  // that is never updated, and today's activity only.)
  async handleStats(args) {
    const p = requireProjectPath(args);
    const dir = projectMemoryDir(p);
    const legacy = legacyMemoryDir(p);
    if (!fs.existsSync(dir) && !fs.existsSync(legacy)) {
      return text(`No memory yet for ${projectName(p)}. claudedev_load creates it.`);
    }
    const { activities, mistakes } = collectEntries([...new Set([dir, legacy])]);
    const decisions = readJsonLines(path.join(dir, 'DECISIONS.jsonl'));
    const patterns = readJsonLines(path.join(dir, 'PATTERNS.jsonl'));
    let session = '';
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'session_state.json'), 'utf8').replace(/^\uFEFF/, ''));
      session = s.sessionId || s.session_id || '';
    } catch { /* none */ }
    const lines = [
      `=== ClaudeDevStudio memory stats: ${projectName(p)} ===`,
      `Memory folder: ${dir}`,
      `Activities: ${activities.length}${activities.length ? ` (latest ${day(activities[0].timestamp)}, first ${day(activities[activities.length - 1].timestamp)})` : ''}`,
      `Mistakes:   ${mistakes.length}`,
      `Decisions:  ${decisions.length}`,
      `Patterns:   ${patterns.length}`,
    ];
    if (session) lines.push(`Session:    ${session}`);
    // Only when an old-store entry was counted (same source tracking as buildContext).
    const countsLegacy = legacy !== dir &&
      [...activities, ...mistakes].some(e => entrySource.get(e) === legacy);
    if (countsLegacy) lines.push(`(Includes older entries from ${legacy}.)`);
    return text(lines.join('\n'));
  }

  // The CLI's monitor runs until stopped, so it is started detached with its output in
  // a log file. Before v1.3.0 it ran under a 30-second timeout that killed it.
  async handleMonitorStart(args) {
    const p = requireProjectPath(args);
    if (!fs.existsSync(CLAUDEDEV_PATH)) return fail(`claudedev.exe not found at ${CLAUDEDEV_PATH}.`);
    const dir = projectMemoryDir(p);
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, 'monitor.log');
    const fd = fs.openSync(logPath, 'w');
    let child;
    try {
      child = spawn(CLAUDEDEV_PATH, ['monitor', p], { detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    let exitCode = null;
    child.on('exit', (code) => { exitCode = code; });
    child.unref();
    await new Promise(r => setTimeout(r, 3000));
    const log = cleanCliText(readText(logPath, 2000));
    if (exitCode !== null) return fail(`The debug monitor stopped right away (exit code ${exitCode}).\n${log}`);
    return text(`\u2713 Debug monitor running (PID ${child.pid}). Log: ${logPath}\n${log}`);
  }

  handleChatCheckpoint(args) {
    const t = (args && args.text) ? String(args.text).trim() : '';
    if (!t) return fail('[mirror] No text provided.');
    mirrorLog('checkpoint', { text: t });
    return text(`[mirror] Checkpoint saved: "${t.slice(0, 80)}${t.length > 80 ? '...' : ''}"`);
  }

  // Reads the current log and, until the stores are merged, the v1.2.x log as well.
  handleChatResume(args) {
    try {
      const hours = (args && args.hours) ? Number(args.hours) : 4;
      const toolCutoff = Date.now() - hours * 60 * 60 * 1000;
      const ckptCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const files = [...new Set([mirrorPath(), legacyMirrorPath()])].filter(f => fs.existsSync(f));
      if (files.length === 0) return text('[mirror] No chat mirror log found. Starting fresh.');
      const seen = new Set();
      const entries = [];
      for (const f of files) {
        for (const e of readJsonLines(f)) {
          const ts = new Date(e.ts).getTime();
          const key = `${e.ts}|${e.type}|${e.text || e.tool || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if ((e.type === 'checkpoint' && ts >= ckptCutoff) || (e.type === 'tool' && ts >= toolCutoff)) entries.push(e);
        }
      }
      if (entries.length === 0) return text('[mirror] No recent entries found.');
      entries.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      const lines = entries.map(e => {
        const when = new Date(e.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return e.type === 'checkpoint' ? `[${when}] * CHECKPOINT: ${e.text}` : `[${when}]   tool: ${e.tool} -> ${e.summary}`;
      });
      return text(`=== Chat Mirror Resume (checkpoints: 7 days, tools: ${hours}h) ===\n` + lines.join('\n'));
    } catch (err) {
      return fail(`[mirror] Error reading log: ${err.message}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`ClaudeDevStudio MCP server v${VERSION} running on stdio`);
  }
}

new ClaudeDevStudioServer().run().catch(console.error);
