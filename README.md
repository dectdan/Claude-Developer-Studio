# ClaudeDevStudio

ClaudeDevStudio (CDS) gives Claude a memory of your software projects that lasts between chats: what was done, what went wrong and the lesson learned, decisions, and where the last session stopped. It also adds developer tools: a bridge to Visual Studio, a panel that shows code Claude sends you, and optional delegation to other AI providers.

It is free and open source (MIT licence).

## What it needs

- Windows 10 or 11, 64-bit
- [Claude Desktop](https://claude.ai/download)
- Visual Studio 2022 or later: optional, only for the VS Bridge

The installer brings everything else it needs (Node.js, the .NET 8 Desktop Runtime, the Windows App Runtime) and installs them only if they are missing. It works without an internet connection.

## Install

1. Download `ClaudeDevStudio-Setup.exe` from [Releases](https://github.com/dectdan/Claude-Developer-Studio/releases).
2. Run it. Windows asks for administrator permission (to install Node.js and .NET if needed).
3. Quit Claude Desktop fully (right-click its tray icon, Quit; closing the window is not enough) and open it again.

The installer adds two servers to Claude Desktop's settings file (`%APPDATA%\Claude\claude_desktop_config.json`). Your other servers and settings are kept, and the file is backed up first (`claude_desktop_config.json.bak-cds-<date>`). If the file isn't valid JSON, the installer leaves it alone and tells you what to add by hand. If Claude Desktop keeps its own packaged copy of that file (`%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\Claude\`), the installer updates that copy too, with the same rules.

**Claude Desktop not installed yet?** Install CDS anyway: it adds itself to Claude Desktop's settings ahead of time. Then install [Claude Desktop](https://claude.ai/download), sign in, and quit it fully and reopen it once.

## First use

In a Claude Desktop chat, say:

> Load CDS for C:\path\to\my\project

The first time, CDS creates the project's memory. After that, Claude sees the recent work and the mistakes to avoid at the start of each session, records what it does, and checks a plan against past mistakes before a risky step.

## What each part does

| Part | What it does |
|---|---|
| `claudedevstudio` server | The memory: load (with the project's ground truth), record activity, record and check mistakes, record decisions, handoffs between sessions, search across all projects' memory, lessons for every project, the ground-truth scaffold, stats, chat checkpoints. |
| `cds-workbench` server | Visual Studio state, errors, output, debugger and commands (needs the VS Bridge); showing code and images in the Review Panel; sending a task to another AI provider; fetching a web page. |
| VS Bridge | A Visual Studio extension that shares build errors, the Output window's panes (Build, and from 1.5.0 the Debug pane, where a running program's `Debug.WriteLine` and trace output appear, or any other pane) and debugger state with Claude. It answers only programs on your own PC, not web pages. |
| Review Panel | A local page (`http://127.0.0.1:63000`) where code and images from Claude appear. |
| Tray app | Starts with Windows; opens the Dashboard; **Configure AI Keys**; **Set up Claude Code** (optional, below). |
| Dashboard | Browse the memory. |
| `claudedev` | The command-line tool that reads and writes the memory. |

## Claude Code (optional)

If you also use [Claude Code](https://code.claude.com), CDS can work there by itself, without Claude having to remember to call it. **It is off until you turn it on.**

**What it does,** in each Claude Code session started in a project folder (one with `.git`, `docs\`, a solution or project file, or `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`):
- when the session starts, Claude gets the same context as `claudedev_load` (the last handoff, the ground truth's status, recent mistakes);
- before the context is compacted and when the session ends, an automatic handoff is saved (the last request, the files edited, Claude's last reply). It never replaces a handoff Claude wrote itself;
- each file Claude edits gets one line in the project's activity (once per file per session);
- Claude Code gets the CDS tools (both servers).

It never blocks Claude Code: the hook always succeeds, does nothing outside project folders, and writes any error to `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log`.

**Turn it on:** the tray app's **Set up Claude Code…**, or `claudedev claude-code setup`, or tick "Also set up Claude Code" on the installer's last page (silent installs: `ClaudeDevStudio-Setup.exe /S /CLAUDECODE=1`). Start a new Claude Code session afterwards. **Check it:** `claudedev claude-code status`. **Turn it off:** the tray app's **Remove from Claude Code…**, or `claudedev claude-code remove`; uninstalling CDS does it too.

**What it changes** (each file is backed up first as `<file>.bak-cds-<date>`; everything else in it is kept; a file that isn't valid JSON is left alone):
- `%USERPROFILE%\.claude\settings.json`: four entries under `"hooks"` (`SessionStart`, `PreCompact`, `SessionEnd`, `PostToolUse`), each running `node.exe …\ClaudeDevStudio\mcp-server\cds-hook.js`. Remove takes out only entries that run `cds-hook.js`.
- Claude Code's user-scope MCP servers: `claudedevstudio` and `cds-workbench`, added with `claude mcp add --scope user` when `claude.exe` is on your PATH, otherwise written to the `"mcpServers"` of `%USERPROFILE%\.claude.json`.

(`CLAUDE_CONFIG_DIR`, if you set it, moves both files, as it does for Claude Code.)

## Where your data lives

Memory is stored in your Documents folder, in `Documents\ClaudeDevStudio\Projects\<project folder name>\` (plain text and JSON files). If your Documents folder is moved, for example by OneDrive, CDS uses the moved folder.

Nothing leaves your PC except calls you ask for: an AI provider when you ask Claude to delegate to one, a web page you ask Claude to fetch, and a key check when you save a key. The tray app also asks GitHub whether a newer release exists when it starts; it sends nothing about you or your projects.

## AI provider keys (optional)

The workbench can send tasks to Together, Groq, DeepInfra, Fireworks or OpenRouter, with your own key. Enter keys in the tray app (**Configure AI Keys**); each key is checked with its provider as you enter it. Keys are stored only on your PC, in `%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\qwen_config.json`. No keys ship with CDS, upgrades keep yours, and CDS never uploads them anywhere except to the provider they belong to.

## Uninstall

Settings › Apps › ClaudeDevStudio › Uninstall (or the Uninstall shortcut in the Start menu). It removes the program and its two entries in Claude Desktop's settings (your other servers stay), CDS's hooks and servers from Claude Code if you set that up (the rest of your Claude Code settings stay), and the VS Bridge from Visual Studio. **Your memory in `Documents\ClaudeDevStudio` is kept.** The AI keys file is removed with the program. Node.js and .NET stay installed.

## Working with ground truths

CDS works best when each project keeps its state in one file, `docs\GROUND_TRUTH.md`: what the project is, its status (dated lines, newest last, ending with a **Next:** line), decisions, open questions, known problems and the plan.

**What load shows**, in this order and kept short (it aims at 8,000 characters and never passes 12,000): the last handoff and how old it is; the ground truth's title, "Last updated" line, the end of its Status section and its Next line, and the questions still open; the newest `docs\P*_OUTPUT.md` (its first section and a list of the rest); then the recorded mistakes, decisions, patterns and recent activity. Anything cut says which file holds the rest.

**Search and lessons for every project.** `claudedev_search` finds past mistakes, decisions, handoffs and activity by words, in one project or all of them ("curly quotes PowerShell"), one short line per hit with the file it came from; it only reads. A lesson that holds everywhere ("ask Windows for the Documents folder; it may be on OneDrive") can be recorded once with `claudedev_record_lesson`: load then shows it in every project (a short section after the project's own mistakes, the most relevant first), and `claudedev_check_mistake` checks plans against it. Lessons live in `Documents\ClaudeDevStudio\LESSONS.jsonl`; `claudedev lesson list`, `lesson edit <id> <json>` and `lesson remove <id>` manage them.

**No ground truth yet?** Load says so, and Claude offers `claudedev_scaffold`. With your OK it creates `docs\GROUND_TRUTH.md`, `docs\CONVENTIONS.md` (how code gets written: read before editing, back up, verify, no secrets) and `docs\HOW_WE_WORK.md` (the loop below) from short templates. It never overwrites a file, and it never runs without your OK: it's your repository.

**The loop:**
1. A planning session writes the next prompt, `docs\Pn_prompt.md`.
2. Claude Code carries it out and writes `docs\Pn_OUTPUT.md` (your steps first, results with evidence, what wasn't done), then updates the ground truth.
3. The planner checks the output and writes the next prompt. Before stopping, Claude writes a handoff (`claudedev_handoff`), so the next session starts where this one stopped.

## Problems and questions

Open an issue: [github.com/dectdan/Claude-Developer-Studio/issues](https://github.com/dectdan/Claude-Developer-Studio/issues). Say what you did, what happened, and your Windows version. Or write to support@gainpublications.com.

## Building from source

`Installer\build-setup.ps1` builds everything and the installer (needs the .NET 8 SDK, Node.js, NSIS, and Visual Studio or Build Tools 2022+ with the extension SDK). See `docs\GROUND_TRUTH.md`, section 10.

## Licence

MIT. Copyright © 2026 Daniel E Gain. Developed with Claude (Anthropic).
