# ClaudeDevStudio v1.3.0

This release fixes the memory, and makes the installer safe for the rest of your Claude Desktop setup. Please update.

## What was broken

- **The memory was split in two.** Since v1.2.0, the memory server and the `claudedev` tool used different folders whenever Windows' Documents folder had been moved (by OneDrive, for example). The server also called the tool with the wrong arguments, so recording activities and mistakes, and the mistake check, never reached the real memory. It said "recorded" anyway.
- **The installer replaced Claude Desktop's settings file.** Installing CDS removed every other MCP server you had added, and other settings in the file. Uninstalling saved the file in a form some tools can't read.
- **Upgrading wiped your AI provider keys.** Each upgrade replaced your keys file with the empty template.
- **The VS Bridge answered web pages.** Any page open in your browser while Visual Studio ran could read build output and drive the debugger through it. The Review Panel had the same opening (it only displays things).
- **The VS Bridge installed into Visual Studio 2022 only,** and only from three fixed folders.
- Smaller things: the `claudedev` tool gave every mistake the same ID, matched mistakes only on exact sentences, printed garbled symbols, and showed a stale session; the "Link Claude Desktop" menu in the tray app replaced the settings file too; the debug monitor looked for DebugView in a folder that exists only on the author's PC; a long user PATH could be cut short by the installer.

## What's fixed

- The memory server and `claudedev` use the same folder, Windows' real Documents folder, wherever it is. Every write goes through `claudedev`; if it fails, you are told the entry was **not** recorded.
- `claudedev_load` creates a project's memory the first time; no separate `init` step.
- The installer adds or replaces only its own two entries (`claudedevstudio`, `cds-workbench`) in `claude_desktop_config.json`, and keeps everything else exactly as it was. It backs the file up first (`claude_desktop_config.json.bak-cds-<date>`). If the file isn't valid JSON it leaves it alone and tells you what to add by hand. Uninstalling removes only those two entries.
- Your keys file (`qwen_config.json`) is created once and never overwritten by an install or upgrade.
- The VS Bridge and the Review Panel answer only programs on your own PC, never web pages.
- The VS Bridge installs into every Visual Studio 2022 or later on the PC (any edition), found the way Microsoft recommends (`vswhere`). No Visual Studio is fine: the step is skipped.
- Unique mistake IDs, keyword mistake matching, clean output, and a session that updates on load.
- The installer brings the .NET 8 Desktop Runtime with it and works with no internet connection. It adds the `claudedev` folder to your PATH once and changes nothing else in it.
- The debug monitor says plainly when DebugView isn't installed and where to get it.

## Memory saved by v1.2.x is still read

Nothing is lost. CDS v1.3.0 reads both places memory may have been saved by v1.2.x: your Documents folder and `%USERPROFILE%\Documents`. It writes only to the first.

## After installing

1. Quit Claude Desktop fully (right-click its tray icon, **Quit**; closing the window is not enough) and open it again.
2. If you use Visual Studio, close and reopen it so the new VS Bridge loads.

## Reporting a problem

Open an issue at [github.com/dectdan/Claude-Developer-Studio/issues](https://github.com/dectdan/Claude-Developer-Studio/issues). Say what you did, what happened, and your Windows version. The installer's log is `%LOCALAPPDATA%\ClaudeDevStudio\install.log`; Claude Desktop's server logs are in `%APPDATA%\Claude\logs\` (`mcp-server-claudedevstudio.log`, `mcp-server-cds-workbench.log`). Check a log for anything private before attaching it.
