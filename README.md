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

The installer adds two servers to Claude Desktop's settings file (`%APPDATA%\Claude\claude_desktop_config.json`). Your other servers and settings are kept, and the file is backed up first (`claude_desktop_config.json.bak-cds-<date>`). If the file isn't valid JSON, the installer leaves it alone and tells you what to add by hand.

## First use

In a Claude Desktop chat, say:

> Load CDS for C:\path\to\my\project

The first time, CDS creates the project's memory. After that, Claude sees the recent work and the mistakes to avoid at the start of each session, records what it does, and checks a plan against past mistakes before a risky step.

## What each part does

| Part | What it does |
|---|---|
| `claudedevstudio` server | The memory: load (with the project's ground truth), record activity, record and check mistakes, record decisions, handoffs between sessions, the ground-truth scaffold, stats, chat checkpoints. |
| `cds-workbench` server | Visual Studio state, errors, output, debugger and commands (needs the VS Bridge); showing code and images in the Review Panel; sending a task to another AI provider; fetching a web page. |
| VS Bridge | A Visual Studio extension that shares build errors, output and debugger state with Claude. It answers only programs on your own PC, not web pages. |
| Review Panel | A local page (`http://127.0.0.1:63000`) where code and images from Claude appear. |
| Tray app | Starts with Windows; opens the Dashboard; **Configure AI Keys**. |
| Dashboard | Browse the memory. |
| `claudedev` | The command-line tool that reads and writes the memory. |

## Where your data lives

Memory is stored in your Documents folder, in `Documents\ClaudeDevStudio\Projects\<project folder name>\` (plain text and JSON files). If your Documents folder is moved, for example by OneDrive, CDS uses the moved folder.

Nothing leaves your PC except calls you ask for: an AI provider when you ask Claude to delegate to one, a web page you ask Claude to fetch, and a key check when you save a key. The tray app also asks GitHub whether a newer release exists when it starts; it sends nothing about you or your projects.

## AI provider keys (optional)

The workbench can send tasks to Together, Groq, DeepInfra, Fireworks or OpenRouter, with your own key. Enter keys in the tray app (**Configure AI Keys**); each key is checked with its provider as you enter it. Keys are stored only on your PC, in `%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\qwen_config.json`. No keys ship with CDS, upgrades keep yours, and CDS never uploads them anywhere except to the provider they belong to.

## Uninstall

Settings › Apps › ClaudeDevStudio › Uninstall (or the Uninstall shortcut in the Start menu). It removes the program and its two entries in Claude Desktop's settings (your other servers stay), and removes the VS Bridge from Visual Studio. **Your memory in `Documents\ClaudeDevStudio` is kept.** The AI keys file is removed with the program. Node.js and .NET stay installed.

## Working with ground truths

CDS works best when each project keeps its state in one file, `docs\GROUND_TRUTH.md`: what the project is, its status (dated lines, newest last, ending with a **Next:** line), decisions, open questions, known problems and the plan.

**What load shows**, in this order and kept short (it aims at 8,000 characters and never passes 12,000): the last handoff and how old it is; the ground truth's title, "Last updated" line, the end of its Status section and its Next line, and the questions still open; the newest `docs\P*_OUTPUT.md` (its first section and a list of the rest); then the recorded mistakes, decisions, patterns and recent activity. Anything cut says which file holds the rest.

**No ground truth yet?** Load says so, and Claude offers `claudedev_scaffold`. With your OK it creates `docs\GROUND_TRUTH.md`, `docs\CONVENTIONS.md` (how code gets written: read before editing, back up, verify, no secrets) and `docs\HOW_WE_WORK.md` (the loop below) from short templates. It never overwrites a file, and it never runs without your OK: it's your repository.

**The loop:**
1. A planning session writes the next prompt, `docs\Pn_prompt.md`.
2. Claude Code carries it out and writes `docs\Pn_OUTPUT.md` (your steps first, results with evidence, what wasn't done), then updates the ground truth.
3. The planner checks the output and writes the next prompt. Before stopping, Claude writes a handoff (`claudedev_handoff`), so the next session starts where this one stopped.

## Problems and questions

Open an issue: [github.com/dectdan/Claude-Developer-Studio/issues](https://github.com/dectdan/Claude-Developer-Studio/issues). Say what you did, what happened, and your Windows version.

## Building from source

`Installer\build-setup.ps1` builds everything and the installer (needs the .NET 8 SDK, Node.js, NSIS, and Visual Studio or Build Tools 2022+ with the extension SDK). See `docs\GROUND_TRUTH.md`, section 10.

## Licence

MIT. Copyright © 2026 Daniel E Gain. Developed with Claude (Anthropic).
