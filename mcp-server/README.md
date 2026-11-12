# ClaudeDevStudio MCP servers

This folder holds the two MCP servers that the installer adds to Claude Desktop (and, if you turn it on, to Claude Code), plus the Claude Code hook. They run with Node.js. The installer puts them in `%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\` and writes the config entries for you; you don't normally run anything here by hand.

| File | What it is |
|---|---|
| `index.js` | **`claudedevstudio`**, the memory server (13 tools, below). A thin wrapper over the `claudedev` CLI, which owns the memory format and does every write. |
| `workbench.js` | **`cds-workbench`**, the developer tools (13 tools, below). |
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

## The Claude Code hook

`node.exe cds-hook.js <event>`, with Claude Code's hook input on stdin. Set up by `claudedev claude-code setup` (opt-in):

| Event | What it does |
|---|---|
| `session-start` | Prints the same context as `claudedev_load` (at most 9,500 characters; Claude Code keeps 10,000). |
| `pre-compact`, `session-end` | An automatic handoff from the transcript: the last request, the files edited, Claude's last reply. It never replaces a handoff Claude wrote with `claudedev_handoff`. Prints nothing. |
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

The smoke test uses throwaway projects in `%TEMP%` and removes their memory folders afterwards. Its search and lessons checks use a throwaway memory root (`CDS_MEMORY_ROOT`, `CDS_LEGACY_ROOT`: test-only variables, read by the servers, the hook and the CLI; never set them in normal use). See `docs\GROUND_TRUTH.md`, section 10.

## Running by hand

The config entry the installer writes (Claude Desktop needs the full path to `node.exe`):

```json
"claudedevstudio": { "command": "C:\\Program Files\\nodejs\\node.exe", "args": ["C:\\Users\\<you>\\AppData\\Local\\ClaudeDevStudio\\mcp-server\\index.js"] }
```

After changing it, quit Claude Desktop fully (tray icon, Quit) and reopen it.
