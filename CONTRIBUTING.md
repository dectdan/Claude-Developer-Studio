# Contributing to ClaudeDevStudio

Thank you for helping. CDS is free and open source (MIT); people install it on their own PCs, so every change has to work on a stranger's Windows, not just yours.

By contributing you agree that your contribution is licensed under the project's licence (`LICENSE`: MIT, with its additional terms, including attribution to the original author and the grant to Anthropic).

## Before you start

- **Bugs and ideas:** open an issue at [github.com/dectdan/Claude-Developer-Studio/issues](https://github.com/dectdan/Claude-Developer-Studio/issues). Say what you did, what happened, what you expected, your Windows version and the CDS version (`claudedev version`).
- **Read `docs\GROUND_TRUTH.md` first.** It is the project's current state: the architecture, the decisions, the known problems, the plan, and the rules that have bitten before. Older documents in `docs\history\` describe states that no longer exist.

## The folder layout

| Folder or file | What it is |
|---|---|
| root `*.cs`, `ClaudeDevStudio.csproj` | The CLI, `claudedev.exe` (.NET 8). It owns the memory format and does every write (`ClaudeMemory.cs`, `MemorySchemas.cs`, `Program.cs`). |
| `mcp-server\` | The two MCP servers for Claude Desktop: `index.js` (`claudedevstudio`, the memory) and `workbench.js` (`cds-workbench`: VS Bridge, Review Panel, AI delegation). `cds-paths.js` finds the Documents folder for both. `templates\` holds the files `claudedev_scaffold` creates. `test\` holds the tests. |
| `review-server\` | The Review Panel (`server.js`, Express on `127.0.0.1:63000`). |
| `VSExtension\CdsVsBridge\` | The VS Bridge, a Visual Studio extension (VSIX). |
| `ClaudeDevStudio.UI\` | The tray app (WinForms). |
| `ClaudeDevStudio.Dashboard\` | The memory browser (Blazor WebView). |
| `Installer\` | The NSIS installer: `setup.nsi`, `build-setup.ps1` (builds everything), and the helper scripts `cds-config.js`, `cds-path.ps1`, `cds-vsix.ps1`. |
| `tools\` | `check-versions.ps1` (one version everywhere), `merge-memory-stores.mjs`, `sandbox-test\` (installer tests in Windows Sandbox), `phase\` (scripts that run a phase prompt headless). |
| `docs\` | `GROUND_TRUTH.md`, the phase prompts and outputs, `releases\` (release notes), `history\`. |
| `Directory.Build.props` | The version number, set once. |

## Build

Needs: Windows 10/11 x64, the .NET 8 SDK, Node.js with npm, NSIS (`choco install nsis -y`), and Visual Studio or Build Tools 2022+ with the extension SDK (for the VSIX).

- **The CLI only:** `dotnet build ClaudeDevStudio.csproj -c Release` (output `bin\Release\net8.0\claudedev.exe`).
- **Everything and the installer:** `powershell -NoProfile -ExecutionPolicy Bypass -File Installer\build-setup.ps1`. It builds the CLI, tray app, Dashboard and VSIX from source, stages both servers and the Review Panel, checks the versions, and compiles `Installer\Output\ClaudeDevStudio-Setup.exe`. It stops at the first failure.
- **The version** is set in `Directory.Build.props` and `mcp-server\package.json`; `tools\check-versions.ps1` checks that every place agrees.

A build must have 0 errors and no new warnings.

## Test

- **The memory server:** `node mcp-server\test\smoke.mjs` runs every tool over stdio the way Claude Desktop does, against the installed CLI, in throwaway projects in `%TEMP%` (it removes them afterwards). With a newly built CLI: `node mcp-server\test\smoke.mjs --cli bin\Release\net8.0\claudedev.exe` (adds the checks that need the new CLI). Every check must pass.
- **What Claude would see:** `node mcp-server\test\show.mjs claudedev_load <project folder>` prints load's output and its length.
- **The installer, as a new user:** `powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox-test\run-sandbox-test.ps1` runs install, upgrade, uninstall and a redirected Documents folder in Windows Sandbox (Windows Pro or Enterprise, with the Windows Sandbox feature on). `node tools\sandbox-test\config-merge-test.js` tests the Claude Desktop config merge on throwaway files. Don't test the installer on your own PC; the sandbox is the test machine.
- **The VS Bridge and Review Panel caller checks:** `node mcp-server\test\caller-check.mjs http://127.0.0.1:63000` (or `http://localhost:62000` with Visual Studio open).

## How this repository works

This project uses the method CDS teaches:

- **`docs\GROUND_TRUTH.md`** is the single source of truth. Its Status section ends with a **Next:** line; decisions are dated with their reasons; known problems are listed worst first.
- **Work comes in phases.** A phase is a prompt, `docs\Pn_prompt.md` (Identity, Why, Read first, Scope, Conventions, The work, Verification, On completion). Claude Code carries it out and writes `docs\Pn_OUTPUT.md`: the owner's steps first, then results with evidence, the decisions it made, and what wasn't done. Then the ground truth is updated.
- **Conventions:** read a file before editing it; back up a tracked file before editing it (`<file>.bak_YYYYMMDD_HHMM`, ignored by git); change only what the work needs; never report a success you didn't check.

You don't have to write a phase prompt for a pull request, but a change that alters behaviour should update the ground truth.

## What a pull request should include

- **What changed and why,** and the issue it fixes, if any.
- **How you checked it:** the build (0 errors, no new warnings) and `smoke.mjs` (and `--cli` if you changed the CLI), with the counts. For installer changes, the sandbox run's result.
- **Docs:** `docs\GROUND_TRUTH.md` updated if behaviour, architecture or a known problem changed; `README.md` if users see the change.
- **Nothing private:** no API keys, tokens or personal paths. `mcp-server\qwen_config.json` holds a user's keys and is never committed; the repository has `qwen_config.template.json` with empty keys.
- **Paths that work everywhere:** never build a path from `%USERPROFILE%\Documents` (Documents may be redirected); ask Windows, as `cds-paths.js` and the CLI do.
- **Small tool descriptions:** each MCP tool's description is one line. Claude Desktop silently drops a server whose tool list is too large.
- **The memory format stays the CLI's:** the servers read the memory files and call `claudedev.exe` to write them.
