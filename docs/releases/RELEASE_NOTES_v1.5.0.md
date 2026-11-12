# ClaudeDevStudio v1.5.0

This release lets Claude find things across all of your projects' memory, keeps lessons that hold for every project, reads Visual Studio's Debug pane, and makes CDS work when Claude Desktop is installed after it.

## New

- **Search across your projects' memory.** `claudedev_search` finds past mistakes, decisions, patterns, handoffs, lessons and activity by words ("curly quotes PowerShell"), in one project or in all of them: one short line per hit with the file it came from, about 3,000 characters, the most useful kinds first. It only reads; it changes nothing.
- **Lessons for every project.** A lesson that holds everywhere ("ask Windows for the Documents folder; it may be on OneDrive") can be recorded once with `claudedev_record_lesson`. Load then shows it in every project (a short section after the project's own mistakes, the most relevant first), `claudedev_check_mistake` checks plans against it, and `claudedev_record_mistake` suggests one when the same mistake has already been recorded in two other projects. Lessons are kept in `Documents\ClaudeDevStudio\LESSONS.jsonl`; `claudedev lesson list`, `lesson edit <id> <json>` and `lesson remove <id>` manage them. A near-duplicate of an existing lesson is refused, naming the one it matches.
- **Visual Studio's Debug pane.** `claudedev_vs_get_output` takes a `pane`: `build` (the default, as before), `debug` (a running program's `Debug.WriteLine` and trace output), any other Output window pane by its name, or `list` to name them. The same size limit as before: the newest lines (100 unless you ask for more). It needs the VS Bridge from this release (an older one says so) and Visual Studio open; `build` still works with Visual Studio closed.

## Fixed

- **Claude Desktop installed after CDS.** Claude Desktop from claude.ai is a packaged (MSIX) app. Installed after CDS, it uses the settings file CDS created, so CDS works after one quit and reopen (tested on a real Windows 10 PC). If Claude Desktop was installed first and keeps its own packaged copy of the settings (`%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\Claude\`), the installer now updates that copy too, with the same rules (your other servers and settings kept, a backup first).
- **`claudedev configure-claude` without Claude Desktop** (the tray app's "Link Claude Desktop") adds CDS to the settings Claude Desktop will read and says what to do next, instead of failing. The installer's last page says the same for a first-time user, and uninstalling removes a `%APPDATA%\Claude` folder that holds only CDS's file.
- The CLI's active-project state (`claudedev switch`, `claudedev active`) moved from `%APPDATA%\ClaudeDevStudio\session_state.json` to `Documents\ClaudeDevStudio\cli_session_state.json`. Under the packaged Claude Desktop, Windows silently redirected that `%APPDATA%` file into Claude's package folder, so the CLI saw a different state from Claude than from a terminal. The old file is read once and left where it is.

## Changed

- **The debug monitor is removed** (`claudedev_monitor_start` and `claudedev monitor`). It needed Sysinternals DebugView, which CDS can't include and which you had to install yourself, and DebugView doesn't see the output of a program running under Visual Studio's debugger. Use `claudedev_vs_get_output` with `pane: "debug"` instead. One tool fewer for Claude to carry in every session. `claudedev monitor` now prints a line saying what to use.
- **Contact:** support@gainpublications.com (in the CLI's help and version, the tray app's About box, the Dashboard's About and Help pages, the README and the uninstall entry in Windows' Apps list).

## Known

- **The first install on a PC without the .NET 8 Desktop Runtime.** In our clean-Windows tests (Windows Sandbox) it takes about 10 minutes, because Windows Installer spends about two minutes checking each of the runtime's packages and Node.js's (Windows' own check, not CDS). On a real Windows 10 PC with neither .NET nor Node.js, the whole first install took about a minute. An upgrade, or a PC that already has .NET 8 and Node.js, installs in about 20 seconds.
- **The VS Bridge after an upgrade:** Visual Studio loads the new VS Bridge after you close and reopen it. If `claudedev_vs_get_output` with `pane: "list"` says the bridge is older than 1.5.0, Visual Studio is still running the old one.

## After installing

1. Quit Claude Desktop fully (right-click its tray icon, **Quit**; closing the window is not enough) and open it again.
2. If you use Visual Studio, close and reopen it so the new VS Bridge loads.
3. If you turned on Claude Code, start a new Claude Code session.

## Reporting a problem

Open an issue at [github.com/dectdan/Claude-Developer-Studio/issues](https://github.com/dectdan/Claude-Developer-Studio/issues), or write to support@gainpublications.com. Say what you did, what happened, and your Windows version. The installer's log is `%LOCALAPPDATA%\ClaudeDevStudio\install.log`; the Claude Code hook's is `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log`; Claude Desktop's server logs are in `%APPDATA%\Claude\logs\`. Check a log for anything private before attaching it.
