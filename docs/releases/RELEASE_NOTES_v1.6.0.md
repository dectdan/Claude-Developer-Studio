# ClaudeDevStudio v1.6.0

This release lets Claude run a phase of your project's work in Claude Code from a Claude Desktop chat: start it, check on it, answer it and stop it, with tools that keep it to one phase per project and never bypass Claude Code's permissions. You choose who answers a phase's questions (Claude, you, or both together), watch it on the Dashboard's new Phases page, and get a notification when it needs you; the installer sets up Claude Code by default when it finds it.

## New

- **Running phases from chat** (Windows; needs [Claude Code](https://code.claude.com) 2.1.0 or later, installed and signed in). The method CDS teaches is a loop: a prompt file `docs\P8_prompt.md`, the work, and an output file `docs\P8_OUTPUT.md`. Four new tools in `cds-workbench` run that loop from a chat:
  - **`claudedev_phase_start`** (`project_path`, `phase`; optional `model`, `effort`, `allowed_tools`) starts Claude Code headless on the prompt file in the project and returns at once. It starts only from a prompt file you can read first, never from free text. One phase per project at a time (a lock in `docs\`).
  - **`claudedev_phase_status`** says whether it is running, finished or stopped, for how long, how many tool calls, which tools Claude Code refused, Claude's latest words, the result, whether it ends with a question, and whether the output file exists. It works from a new chat and after Claude Desktop restarts.
  - **`claudedev_phase_reply`** answers a finished run (a question, or "go on"): the same Claude Code session continues with the same model, effort and tools.
  - **`claudedev_phase_stop`** stops it: first with Ctrl+C, so Claude Code ends its turn and runs its SessionEnd hooks (with CDS's Claude Code hooks on, that writes the automatic handoff); only if that doesn't end it within 15 seconds, by force. Status says which.
- **What starting a phase does.** It starts an agent that reads and edits files and runs commands in that project **without asking you**, with the tools listed: by default Read, Edit, Write, Glob, Grep, Bash, PowerShell, Monitor, WebFetch, WebSearch and CDS's memory tools. The permission mode is `acceptEdits`; CDS never uses `--dangerously-skip-permissions` or `bypassPermissions`, so anything outside the listed tools is still refused by Claude Code (Status lists the refusals). It refuses folders that aren't projects, the home folder, Windows, Program Files and drive roots. It uses **your own Claude Code sign-in and plan**, and your own Claude Code settings and hooks apply, as in any Claude Code session. It keeps running if you close Claude Desktop.
- **Claude Desktop asks you before each tool call** of a local server, so you see `claudedev_phase_start` and its prompt file before anything runs. If you chose "always allow" for it, it won't ask again; leave it on asking if you want to approve each phase.
- **Phases wait properly for long work.** A phase gets up to 60 minutes where Claude Code's defaults are 10: the idle wait for background work it started (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) and the longest timeout a foreground command may have (`BASH_MAX_TIMEOUT_MS`), so a build or a test suite can run in the foreground. A value you set yourself is kept. `Monitor` (it watches a long command's output; its commands follow the same permission rules as Bash) is among the default tools.
- **The method in the templates.** `claudedev_scaffold`'s `HOW_WE_WORK.md` has a short section on writing and running a phase: a prompt names its scope, what it must never touch, its verification and its output file; long steps run in the foreground, never left to a background wait; and how to start, check, answer and stop a phase from a chat.
- **Three ways to run a phase** (`mode`): **collaborative**, the default: headless; when the phase asks something, Claude in the chat answers by itself only if the answer follows from the ground truth or what's already decided, is easily undone, and is technical, and brings anything that changes scope, cost or direction, can't be undone, or is a matter of taste to you, with the options and its recommendation; either way it tells you what was asked and answered. **Delegated:** headless, Claude answers everything and tells you afterwards. **Manual:** a Claude Code window opens in the project (Windows Terminal if you have it) with the prompt as its first message, in your own permission mode, and you approve what it asks.
- **Questions that come back cleanly.** A phase that needs a decision ends with a `QUESTION:` block (the question, numbered options with their consequences, `RECOMMENDATION:`), as the templates now describe; Status returns it word for word, apart from the rest, so the chat can put it to you exactly as asked. Every finished run's Status also says how to open the whole conversation in Claude Code (`claude --resume <session>`).
- **A Phases page and notifications.** The Dashboard's new **Phases** page shows a project's phases and one phase as a readable conversation (Claude's messages, one line per tool call, results folded away, a question highlighted), refreshing while it runs, with Stop, Open in Claude Code and Open folder. The tray app shows a Windows notification when a phase finishes, asks a question, is stopped or fails (click it to open the Phases page; **Phase notifications** in the tray menu turns them off).
- **Claude Code setup that just works.** The installer looks for Claude Code: when it finds 2.1 or later, "Also set up Claude Code" is ticked (untick it to leave Claude Code alone), and a silent install sets it up (`/CLAUDECODE=0` doesn't); when Claude Code isn't installed, the last page says how to install it. If you removed the setup yourself, later installs leave it off. `claudedev claude-code status` and the tray app's Claude Code item say which holds (not installed, too old, not signed in, not set up, ready) and offer the next step; the phase tools refuse a Claude Code that isn't signed in, saying to run `claude` once.

## Fixed

- The automatic handoff (Claude Code hooks) lists only the files edited in the project, and says in one line how many files outside it were left out (scratch scripts in `%TEMP%` used to fill the list).
- The Dashboard's About page shows the installed version (it said v1.0.0).

## Known

- **A run that doesn't end on Ctrl+C is stopped by force**, and then no SessionEnd hook runs and no automatic handoff is written for it; `claudedev_phase_reply` can still continue the session. The same goes for a run started by an older CDS or by the `run-phase.ps1` script.
- **Manual mode, the first time in a folder:** Claude Code asks whether you trust the folder before it reads the prompt; answer it in the window. A manual run can't be answered from the chat (you answer in the window).
- **Windows only.** Phases need Claude Code on the same PC, on PATH (or in `%USERPROFILE%\.local\bin`); after installing Claude Code, restart Claude Desktop so its servers see the new PATH. On Windows, Claude Code's `Monitor` tool is available only when Git Bash is installed.
- **The first install on a PC without the .NET 8 Desktop Runtime** can take about 10 minutes in a clean Windows (Windows Installer's own checks); about a minute on a real PC; an upgrade about 20 seconds.

## After installing

1. Quit Claude Desktop fully (right-click its tray icon, **Quit**; closing the window is not enough) and open it again. The four phase tools appear in `cds-workbench`.
2. If you use Visual Studio, close and reopen it so the new VS Bridge loads.
3. If you turned on Claude Code, start a new Claude Code session.

## Reporting a problem

Open an issue at [github.com/dectdan/Claude-Developer-Studio/issues](https://github.com/dectdan/Claude-Developer-Studio/issues), or write to support@gainpublications.com. Say what you did, what happened, and your Windows version. The installer's log is `%LOCALAPPDATA%\ClaudeDevStudio\install.log`; the Claude Code hook's is `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log`; Claude Desktop's server logs are in `%APPDATA%\Claude\logs\`; a phase's log is `docs\<phase>_run.log` in the project. Check a log for anything private before attaching it.
