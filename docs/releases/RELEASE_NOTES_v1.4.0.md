# ClaudeDevStudio v1.4.0

This release makes the memory find Claude, instead of waiting to be asked: Claude sees the project's own state first, can set up a ground truth for a project that has none, hands off between sessions, and, if you use Claude Code and turn it on, gets all of that without having to remember to call CDS.

## New

- **Load leads with the project's own state.** `claudedev_load` now starts with the last handoff (and how old it is), then the project's `docs\GROUND_TRUTH.md`: its title, "Last updated", the end of its Status section, its **Next:** line and the questions still open; then the newest `docs\Pn_OUTPUT.md`; then the recorded mistakes, decisions, patterns and activity. It is kept short (it aims at 8,000 characters, never more than 12,000), and anything cut names the file that holds the rest.
- **A ground truth for projects without one.** Load says when a project has no ground truth, and Claude offers `claudedev_scaffold`, which creates `docs\GROUND_TRUTH.md`, `docs\CONVENTIONS.md` and `docs\HOW_WE_WORK.md` from short templates. Only with your OK; it never overwrites a file.
- **Handoffs and decisions.** `claudedev_handoff` saves where a session stopped and the next step; the next load shows it first. `claudedev_record_decision` records a decision and why.
- **Claude Code (optional, off until you turn it on).** CDS can register its two servers with Claude Code and add four hooks, so that each Claude Code session in a project folder:
  - starts with the same context as `claudedev_load`;
  - saves an automatic handoff before its context is compacted and when it ends (the last request, the files edited, Claude's last reply; it never replaces a handoff Claude wrote itself);
  - notes each file Claude edits, once per file per session.

  Turn it on from the tray app (**Set up Claude Code…**), with `claudedev claude-code setup`, or with the installer's unticked "Also set up Claude Code" box (silent installs: `/S /CLAUDECODE=1`). Turn it off the same ways (`claudedev claude-code remove`); uninstalling CDS does it too. It changes only CDS's own entries in `%USERPROFILE%\.claude\settings.json` and Claude Code's user-scope servers, backs both files up first, and leaves a file that isn't valid JSON alone. The hook never blocks Claude Code: it always succeeds, does nothing outside project folders (and never in your home folder, Windows, Program Files or a drive root), and writes problems to `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log`. The README's "Claude Code" section has the details.

## Fixed

- The VS Bridge's Visual Studio tools find the bridge's files wherever Windows' Documents folder is (it used to guess between two places).
- The Dashboard's and tray app's GitHub links point at this repository (they named a misspelt one).
- The Dashboard and tray app find the install folder from the value the installer actually writes, so "Open Dashboard", Settings, the DebugView check and the auto-start switch work. The tray app's About box no longer asks GitHub for the version.
- "Start ClaudeDevStudio now" on the installer's last page starts the tray app as you, not as administrator.
- The installer recognises an installed Windows App Runtime 1.8 (it looked for a registry key that no installer writes, so it reinstalled the runtime every time).
- The installer's log describes Visual Studio Build Tools honestly: Build Tools can't host extensions, so the VS Bridge skips it with a line saying so (it used to try, and log "Visual Studio is running").

## Changed

- The bundled Node.js is 26.13.1, the latest release of the current long-term-support line (Node 26 "Lithium"). It is installed only if your PC has no Node.js.
- The memory server's own documentation (`mcp-server\README.md`) describes all of today's tools.

## Known

- On a PC that doesn't have the .NET 8 Desktop Runtime yet, the first install can take several minutes: in our clean-Windows tests (Windows Sandbox) Windows Installer spent about two minutes checking each of the runtime's four packages, and two more for Node.js, with or without an internet connection. That is Windows' own check, not CDS. An upgrade, or a PC that already has .NET 8 and Node.js, installs in about 20 seconds. (The numbers are in the project's `docs\P4_OUTPUT.md`.)

## After installing

1. Quit Claude Desktop fully (right-click its tray icon, **Quit**; closing the window is not enough) and open it again.
2. If you use Visual Studio, close and reopen it so the VS Bridge loads.
3. If you turned on Claude Code, start a new Claude Code session.

## Reporting a problem

Open an issue at [github.com/dectdan/Claude-Developer-Studio/issues](https://github.com/dectdan/Claude-Developer-Studio/issues). Say what you did, what happened, and your Windows version. The installer's log is `%LOCALAPPDATA%\ClaudeDevStudio\install.log`; the Claude Code hook's is `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log`; Claude Desktop's server logs are in `%APPDATA%\Claude\logs\`. Check a log for anything private before attaching it.
