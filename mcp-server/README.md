# ClaudeDevStudio MCP servers

This folder holds the two MCP servers that the installer adds to Claude Desktop (and, if you turn it on, to Claude Code), plus the Claude Code hook. They run with Node.js. The installer puts them in `%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\` and writes the config entries for you; you don't normally run anything here by hand.

| File | What it is |
|---|---|
| `index.js` | **`claudedevstudio`**, the memory server (13 tools, below). A thin wrapper over the `claudedev` CLI, which owns the memory format and does every write. |
| `workbench.js` | **`cds-workbench`**, the developer tools (17 tools, below). |
| `cds-phase.js` | The phase tools (`claudedev_phase_*`, from P7): starts Claude Code headless on a project's `docs\<phase>_prompt.md`, reads its log, continues or stops it; also the runner process (`node cds-phase.js --run …`) that WMI starts, so a phase outlives Claude Desktop. Windows only. |
| `cds-context.js` | What `claudedev_load` shows on walking into a project: the last handoff, the ground truth's Status and Next, the newest `docs\Pn_OUTPUT.md`, then mistakes, decisions, patterns and activity, under a size budget (aims at 8,000 characters, never over 12,000). Shared by `index.js` and `cds-hook.js`. |
| `cds-search.js` | `claudedev_search`: words across one project's memory or all of them (both stores, plus the lessons), ranked, one line per hit, about 3,000 characters; read-only. Also the keyword rule `check_mistake` uses. |
| `cds-paths.js` | Asks Windows where Documents is (it may be moved, e.g. by OneDrive): the memory is in `[Documents]\ClaudeDevStudio\Projects\<project folder name>\`. |
| `cds-hook.js` | The Claude Code hook (optional; see the main README, "Claude Code"). |
| `templates\` | What `claudedev_scaffold` creates in a project: `GROUND_TRUTH.md`, `CONVENTIONS.md`, `HOW_WE_WORK.md`. |
| `qwen_config.template.json` | The empty AI-provider keys file. Your keys go in `qwen_config.json` (created at install, never shipped, never overwritten). |

## `claudedevstudio` (memory)

| Tool | What it does |
|---|---|
| `claudedev_load` | Start of work on a project: the context above. Creates the memory the first time. |
| `claudedev_init` | Creates the memory (optional: load does it). |
| `claudedev_scaffold` | Adds `docs\GROUND_TRUTH.md`, `CONVENTIONS.md` and `HOW_WE_WORK.md` from the templates. Never overwrites; only with the user's OK. |
| `claudedev_handoff` | Where the session stopped and the next step; the next load shows it first. |
| `claudedev_record_decision` | A decision and why. |
| `claudedev_record_activity` | Work done. |
| `claudedev_record_mistake` | A mistake, its impact, the fix and the lesson. |
| `claudedev_check_mistake` | Checks a planned step against the recorded mistakes and the lessons for every project. |
| `claudedev_search` | Finds past mistakes, decisions, patterns, handoffs, lessons and activity by words, in one project or all (`query`, optional `project_path`, `kinds`, `limit`). Reads only. |
| `claudedev_record_lesson` | A lesson for every project (`LESSONS.jsonl` at the memory root): load shows it everywhere, check_mistake checks it. Refuses an empty lesson or a near-duplicate, naming the match. Edit or remove: `claudedev lesson edit <LSN###> <json>`, `claudedev lesson remove <LSN###>`. |
| `claudedev_stats` | Counts what is stored. |
| `claudedev_chat_checkpoint`, `claudedev_chat_resume` | A short checkpoint log that survives a dropped chat. |

(`claudedev_monitor_start`, which needed Sysinternals DebugView, was removed in 1.5.0: use `claudedev_vs_get_output` with `pane: "debug"`.)

Every write goes through `%LOCALAPPDATA%\ClaudeDevStudio\CLI\claudedev.exe`. If the CLI fails, the tool says the entry was **not** recorded.

## `cds-workbench` (tools)

`claudedev_vs_get_state`, `claudedev_vs_get_errors`, `claudedev_vs_get_output`, `claudedev_vs_get_events`, `claudedev_vs_get_debugger`, `claudedev_vs_evaluate`, `claudedev_vs_command` (Visual Studio, through the VS Bridge extension; `claudedev_vs_get_output` reads the Build pane by default, `pane: "debug"` a running program's `Debug.WriteLine`/trace output, any other pane by name, and `pane: "list"` names the panes); `display_review`, `display_image` (the Review Panel at `http://127.0.0.1:63000`); `qwen_generate`, `list_models`, `generate_image` (another AI provider, with your own key); `fetch_url`.

`claudedev_phase_start`, `claudedev_phase_status`, `claudedev_phase_reply`, `claudedev_phase_stop` (from P7; the main README, "Running phases from chat"). How a run works:

- **Start** checks Claude Code (on PATH or `%USERPROFILE%\.local\bin`, version 2.1.0 or later), the folder (the hook's rule, `cds-paths.js`), `docs\<phase>_prompt.md`, and the project's lock; writes `docs\<phase>_run.json` and `docs\cds_phase.lock`; starts the runner through WMI (`Win32_Process.Create`, hidden; its parent is WMI, not the server, and it gets the user's own environment); returns. The runner starts `claude -p "Read docs\<phase>_prompt.md and carry it out. …" [--model] [--effort] --permission-mode acceptEdits --allowedTools <list> --mcp-config <%TEMP%\cds_phase_mcp_….json> --output-format stream-json --verbose` with stdin from NUL and stdout/stderr appended to `docs\<phase>_run.log`/`.err`, records the pids and the exit code, and removes the lock. From 1.6.0 Claude Code shares the runner's hidden console (so Stop can send Ctrl+C into it), the default tools include `Monitor`, and the run's environment gets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` and `BASH_MAX_TIMEOUT_MS` of 3600000 (60 minutes) unless the user set them; the run's `.json` records both.
- **Status** reads the `.json` and the log (shared read, while Claude Code writes it), never this server's memory, so it works from a new server; at most ~2,500 characters. A lock whose process is gone (a crash or a restart; pids are checked with their start time) is cleared and said so.
- **Reply** runs `claude -p --resume <session id from the log> …` with the same flags; the message goes in on stdin, never as an argument.
- **Stop** checks the runner is still ours (start time and command line), then (from 1.6.0) sends Ctrl+C into its console: a PowerShell helper leaves its own console, `AttachConsole`s to the runner's, ignores the event itself and calls `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)`; it sends nothing if the attach fails. The runner ignores it; Claude Code ends its turn, runs its SessionEnd hooks and exits; anything from the run's tree that is still there afterwards is ended. If the runner is still there 10 s after one Ctrl+C and 5 s after a second, or Ctrl+C can't be sent (a run started before 1.6.0, or by `run-phase.ps1`), it falls back to `taskkill /T /F` on the runner (Claude Code and everything it started). It records "stopped by request" and how (`stop_method` `ctrl_c` or `force`), and removes the lock.
- **Modes (from 1.6.0, P9):** `mode` `collaborative` (default) or `delegated` run as above (the start prompt then tells Claude Code that a reply can come and how to ask: a `QUESTION:` block); the start and status results say what chat-side Claude does with a question. `manual` opens a visible window instead: Windows Terminal (`wt.exe -w new --title … -d <project>`, started directly, since WMI can't start its app alias; the window lives in Windows Terminal's own process) or, without it, a console window through WMI; the runner (`--manual`) runs `claude [--model] [--effort] --session-id <uuid> "Read docs\<phase>_prompt.md and carry it out."` interactively on that console (no `-p`, no permission mode, no tool list: the user approves). Status reads that session's transcript (`<config dir>\projects\*\<uuid>.jsonl`); Reply is refused; Stop asks for the window to be closed unless `force: true` (then two Ctrl+C half a second apart, as an interactive session exits, else by force).
- **Questions:** `parseQuestion` finds the last `QUESTION:` block (question, numbered options, `RECOMMENDATION:`); Status returns it word for word and apart from the rest, never trimmed by the budget. The old "ends with a question" rule still applies to text without a block.
- **When a run ends** the runner records its `outcome` (`finished`, `question` with the question, `error`, `no_result`, `closed` for a manual window) and `output_written` in the `.json`; Status ends with "Open it: … claude --resume <session id>". `phaseStart` adds each run to `[Documents]\ClaudeDevStudio\phases.json` (for the tray app's notifications and the Dashboard).
- **From the command line** (the Dashboard's Phases page uses these): `node cds-phase.js --status <project> [phase]`, `--stop <project> <phase> [--force]`, `--conversation <log or transcript> [--json]` (the conversation as entries: Claude's text, one line per tool call, results collapsed, a question block apart).
- `run-phase.ps1` runs (their `.json` has no `runs`) are read too; `CDS_PHASE_CLAUDE` points the tools at a fake Claude Code and `CDS_PHASE_WINDOW=hidden` opens a manual run's window hidden, **for tests only**.

## The Claude Code hook

`node.exe cds-hook.js <event>`, with Claude Code's hook input on stdin. Set up by `claudedev claude-code setup` (opt-in):

| Event | What it does |
|---|---|
| `session-start` | Prints the same context as `claudedev_load` (at most 9,500 characters; Claude Code keeps 10,000). |
| `pre-compact`, `session-end` | An automatic handoff from the transcript: the last request, the project's files edited (files elsewhere only counted), Claude's last reply. It never replaces a handoff Claude wrote with `claudedev_handoff`. Prints nothing. |
| `post-tool-use` | One activity line per edited file per session. |

It always exits 0, never blocks a tool or a compaction, skips folders that don't look like projects (and the home folder, Windows, Program Files, drive roots), and writes errors to `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log`, not to Claude.

## Testing

From the repository root:

```
node mcp-server\test\smoke.mjs                                       # the installed CLI
node mcp-server\test\smoke.mjs --cli bin\Release\net8.0\claudedev.exe   # a freshly built CLI
node mcp-server\test\show.mjs claudedev_load C:\path\to\project       # what load shows, and its length
node mcp-server\test\show.mjs claudedev_search "curly quotes PowerShell"   # a search, its length and time
node mcp-server\test\show.mjs --tools                                 # the size of tools/list
```

The smoke test uses throwaway projects in `%TEMP%` and removes their memory folders afterwards. Its phase checks run a fake Claude Code (`test\fixtures\fake-claude.mjs`, through `CDS_PHASE_CLAUDE`). Its search and lessons checks use a throwaway memory root (`CDS_MEMORY_ROOT`, `CDS_LEGACY_ROOT`: test-only variables, read by the servers, the hook and the CLI; never set them in normal use). See `docs\GROUND_TRUTH.md`, section 10.

## Running by hand

The config entry the installer writes (Claude Desktop needs the full path to `node.exe`):

```json
"claudedevstudio": { "command": "C:\\Program Files\\nodejs\\node.exe", "args": ["C:\\Users\\<you>\\AppData\\Local\\ClaudeDevStudio\\mcp-server\\index.js"] }
```

After changing it, quit Claude Desktop fully (tray icon, Quit) and reopen it.
