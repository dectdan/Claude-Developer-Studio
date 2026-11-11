# ClaudeDevStudio — P2 (Claude Code Prompt)
# A fresh install that just works: the installer, the repo, the README, and Windows Sandbox tests as a new user (nothing is published here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop, from Gain Publications (Dan). It's **free, MIT, and public**; strangers download the installer from GitHub.
- **Project:** `D:\Projects\ClaudeDevStudio` (git `main`; `github.com/dectdan/Claude-Developer-Studio`, **public**).
- **Installer:** `Installer\build-setup.ps1` (stages and compiles), `Installer\setup.nsi` (NSIS), `Installer\install-extension.ps1` (writes Claude Desktop's config). Output: `Installer\Output\ClaudeDevStudio-Setup.exe`.

Start with ClaudeDevStudio: `claudedev_load` with `D:\Projects\ClaudeDevStudio`.

**You are running unattended.** Claude (the producer) started this session and nobody can answer questions while it runs. When something isn't covered here, take the safest reading that keeps the rules below, write it under "Decisions I made" in `docs\P2_OUTPUT.md`, and carry on. Stop early only if going on would break a rule; then write the output file and say why.

---

## Why

v1.3.0 fixes the memory (P1 and the producer's `index.js`). But the installer that would ship it has three bugs that would hurt anyone who installs it (ground truth §7 items 14–16):
- it deletes every other server in the user's Claude Desktop config;
- an upgrade blanks the user's API keys;
- it installs the VS Bridge for Visual Studio 2022 only.

The repo also still carries files it shouldn't, and paths from Dan's PC. Nobody has tested a fresh install on a clean machine. After P2, Dan publishes v1.3.0.

---

## Read first

1. `docs\GROUND_TRUTH.md`, in full: §3, §4, §5, §7 (items 3, 4, 9, 10, 11, 14, 15, 16), §8 (the settled decisions; follow them), §9 and §10.
2. `docs\P1_OUTPUT.md`, especially "Build notes" (the VSIX builds with Visual Studio's MSBuild, not `dotnet build`) and "Places not made to follow the one version".
3. `Installer\build-setup.ps1`, `Installer\setup.nsi` (install and uninstall sections, every `File`, `SetOverwrite`, `nsExec`, the VSIX and Node steps), `Installer\install-extension.ps1`, `Installer\ConfigureClaudeDesktop.ps1`.
4. `deploy.ps1`, `install.ps1`, `.github\workflows\release.yml`, `.gitignore`, `README.md`.
5. `VSDebugMonitor.cs` (the DebugView lookup) and `mcp-server\index.js` (`handleStats`, `similarMistakes`).

---

## Scope

- **Modified:**
  - `Installer\build-setup.ps1`, `Installer\setup.nsi`, `Installer\install-extension.ps1`;
  - `VSDebugMonitor.cs`, `mcp-server\index.js`;
  - `deploy.ps1`, `.github\workflows\release.yml`, `.gitignore`, `README.md`;
  - `docs\GROUND_TRUTH.md`.
- **New:**
  - the config-merge step, wherever you put it (for example, `Installer\cds-config.js`, run with the installed Node);
  - `tools\sandbox-test\` (the `.wsb` generator, the in-sandbox test script, a runner);
  - `docs\releases\RELEASE_NOTES_v1.3.0.md`;
  - `docs\P2_OUTPUT.md`.
- **Removed from the repo** (`git rm`, history untouched, §8): see work item 4.
- **Never touched:**
  - **Dan's own `%APPDATA%\Claude\claude_desktop_config.json`;**
  - **the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`;**
  - Dan's memory stores;
  - any `qwen_config.json` with keys in it.

---

## Conventions

- Back up any tracked file before editing it (`.bak_YYYYMMDD_HHMM`). Confirm each edit's anchor text before replacing.
- **Never run the installer, the uninstaller or `deploy.ps1` (without `-DryRun`) on this PC.** The installer runs only inside Windows Sandbox.
- **Never open, copy or print a `qwen_config.json` that might hold keys,** or Dan's Claude Desktop config. Test configs are made inside the sandbox.
- Don't stop the running Review Panel or Claude Desktop.
- Builds: 0 errors; report warning counts and add no new warnings.
- **The repo is public:** no keys, no personal data, no paths from Dan's PC in shipped files.
- **Don't create a git tag or a GitHub release.** Dan publishes.

---

## The work

### 1. The installer keeps everything that isn't CDS's (§7 item 14)

**Install** writes the two CDS entries (`claudedevstudio`, `cds-workbench`) into `claude_desktop_config.json`. It must:
- **keep every other `mcpServers` entry and every other top-level key** exactly as they are (on Dan's PC: 7 other servers, `preferences`, `coworkUserFilesPath`);
- replace only CDS's own two entries if they're already there (an upgrade adds nothing twice);
- create the file and folder if Claude Desktop isn't installed yet;
- **back up the existing file first** (`claude_desktop_config.json.bak-cds-YYYYMMDD-HHMMSS` beside it);
- write through a temp file then rename; UTF-8, **no BOM**;
- use the full path to `node.exe`, found the way the installer already finds it;
- **if the existing file isn't valid JSON, leave it untouched**, log why, and tell the user on the finish page what to add by hand.

**Uninstall** removes only those two entries, with the same backup, no BOM and invalid-JSON rules.

Use the Node.js the installer installs to do the merge (`JSON.parse`/`JSON.stringify` keep the content exactly; Windows PowerShell 5.1's `ConvertTo-Json` doesn't reliably). `install-extension.ps1` may stay as the caller, or be replaced; remove whatever becomes dead.

### 2. Upgrades keep the user's API keys (§7 item 15)

- Ship the template as `mcp-server\qwen_config.template.json`.
- Create `qwen_config.json` from it **only if it doesn't exist**.
- **No install, upgrade or uninstall step may ever overwrite an existing `qwen_config.json`.** On uninstall, follow what NSIS does with the install folder, but say in the output what happens to the keys file.
- Check every other file the user can change after install the same way, and list them.

### 3. The VS Bridge for any Visual Studio (§7 item 16)

- Find Visual Studio with `vswhere.exe` (`%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe`), every edition and version that has `VSIXInstaller.exe`.
- Install the VSIX quietly into each one.
- Skip with a log line when there's none or `vswhere` is missing. Never fail the install over it.
- Do the same for uninstall.

### 4. No Dan-specific paths; the repo cleaned up (§7 items 3, 4, 11; §8)

- **Search** every shipped file (`.cs`, `.js`, `.mjs`, `.ps1`, `.nsi`, `.json`, `.xaml`, `.csproj`, `.yml`) for paths from Dan's PC: `D:\`, `C:\Users\`, `Big_D`, `\Dan\`, `D:\Tools`, `OneDrive`, user names. Fix each one in shipped code. Tests may use `%TEMP%`. List them all in the output.
- **`VSDebugMonitor.cs`:** no hardcoded path. When DebugView isn't found, say plainly that it needs Sysinternals DebugView, give Microsoft's page for it, and say where to put `dbgview64.exe` (or that it can be on `PATH`).
- **`git rm`:**
  - `Bundled\Dbgview.exe`, `Dbgview64a.exe`, `dbgview64.exe` (and `Bundled\` if that leaves it empty);
  - `Releases\*.msi`;
  - every tracked file in `Installer\Output\` (`.wixpdb`, `.wxs`, etc.);
  - `mcp-server\claudedev.exe`;
  - the `MCP\` folder;
  - the `VoiceServer\` folder;
  - the WiX/MSIX-era installer files (`Build-MSI.ps1`, `Build-MSIX.ps1`, `Installer*.wxs`, `Dashboard.wxs`, root `Package.appxmanifest` if only `Build-MSIX.ps1` reads it). **First confirm nothing that builds, or that `build-setup.ps1`/`setup.nsi`/`release.yml`/a csproj uses, references them.**
- **`git mv`:**
  - the stale `Installer\*.md` to `docs\history\installer\`;
  - `install.ps1` to `docs\history\attic\` (the NSIS installer is the install path).
- **`.gitignore`:** `*.bak_*`, `*.bak-cds-*`, `Installer\build\`, `Installer\Output\`, `tools\sandbox-test\results\`, and anything else the build produces.

### 5. `release.yml` (§7 item 9)

- Remove the `VoiceServer` step.
- Make it build exactly what `build-setup.ps1` builds, including the VSIX with Visual Studio's MSBuild (P1 build notes).
- If you can't be sure it would pass on GitHub's Windows runner without pushing a tag, make it manual-only (`workflow_dispatch`) and say why.
- Check the YAML parses.

### 6. A safe `deploy.ps1` (§7 item 10)

`deploy.ps1` is a developer tool that copies a fresh build into the installed copy. It must:
- copy the CLI's whole build output, `index.js`, `workbench.js`, `mcp-server\package.json` and the Review Panel;
- **never touch `qwen_config.json` or Claude Desktop's config;**
- back up each replaced file;
- support `-DryRun`;
- print "Quit Claude Desktop fully and reopen it" at the end.

**Run it with `-DryRun` only.**

### 7. `index.js`, two small things (P1 "Not done")

- `claudedev_stats`: show "(Includes older entries ...)" only when an old-store entry was counted. Use the same source tracking `buildContext` uses.
- `similarMistakes`: build a mistake's words from `mistake` and `lesson ?? ''`, so a missing lesson doesn't add the word "undefined". Keep it in step with the CLI.
- Both smoke runs still pass (16 with the installed CLI; 24 with `--cli bin\Release\net8.0\claudedev.exe`).

### 8. A README for strangers

Plain and short. Cover:
- **what CDS is**, and that it's free;
- **what it needs:** Windows 10/11 x64, Claude Desktop; Visual Studio optional (for the VS Bridge);
- **install:** download, run, quit and reopen Claude Desktop;
- **first use:** "Load CDS for C:\path\to\my\project";
- **what each server does;**
- **where the data lives** (Documents\ClaudeDevStudio), and that nothing leaves the PC except calls the user asks for;
- **the optional AI provider keys:** entered in the tray app, never shipped, never uploaded;
- **uninstall**, which keeps the user's memory;
- **the way of working CDS encourages**, in two lines: a `docs\GROUND_TRUTH.md` per project, and phased prompts. Coming in v1.4.

No marketing language.

### 9. Build the installer

- Update `build-setup.ps1` to build everything it ships with the current commands (CLI, TrayApp, Dashboard, the VSIX via MSBuild, both servers and `package.json`, the Review Panel).
- Run it. Record the EXE's size, SHA-256 and build time, and that its contents carry 1.3.0 (`tools\check-versions.ps1` passes).

### 10. Windows Sandbox tests as a new user

Windows Sandbox is installed (`%windir%\System32\WindowsSandbox.exe`). Each launch is a clean Windows 11 with an administrator account, `WDAGUtilityAccount`. It has no D:, no OneDrive, no Visual Studio, no Claude Desktop and no keys. It's launched from a `.wsb` file without elevation. Only one runs at a time.

**Build `tools\sandbox-test\`:**
- a runner, run on the host, that writes a `.wsb` and launches it;
- the `.wsb` maps the installer folder **read-only** and `tools\sandbox-test\results\<run>\` **writable**, with **networking disabled** (this proves the installer is self-contained), and has a `LogonCommand` that runs the test script;
- the test script, run inside the sandbox, does the scenarios below. It writes `results.json` (each check: name, PASS/FAIL, evidence) and a log, then **shuts the sandbox down** (`shutdown /s /t 0`);
- the runner waits for `results.json`, up to a time limit you choose (log it), then reports. If the sandbox is still open after the limit, close it (`WindowsSandboxClient`/`WindowsSandbox` processes) and report a timeout.

**The scenarios, in this order, in one sandbox run:**

**A. Fresh install.**
1. Before installing, seed a `claude_desktop_config.json` that has:
   - a fake server `keep-me` (`command: "cmd"`, `args: ["/c","echo"]`);
   - `"preferences": {"sidebarMode":"chat"}`;
   - an unrelated top-level key `"someOtherSetting": 42`.
2. Install silently (`ClaudeDevStudio-Setup.exe /S`; make `/S` work if it doesn't).
3. Check:
   - **the program:** files are in place; `claudedev version` prints 1.3.0; Node is installed;
   - **the config:** both CDS entries point at existing files with a full `node.exe` path; `keep-me`, `preferences` and `someOtherSetting` are unchanged; there's no BOM; the backup file exists;
   - **the keys file:** `qwen_config.json` exists with all keys empty;
   - **the memory server:** the smoke test, from a copy of `mcp-server\test\` placed inside the installed `mcp-server`, against the installed `index.js` and the installed CLI (`--cli`): all checks pass;
   - **the workbench server:** started over stdio, it lists 13 tools;
   - **the Review Panel:** started from the installed files, `caller-check.mjs` passes;
   - **the memory location:** memory lands in `[Documents]\ClaudeDevStudio\Projects\...`.

**B. Upgrade.**
1. Put `"api_key": "sandbox-test-key"` into `qwen_config.json` for one provider.
2. Run the installer `/S` again.
3. Check:
   - the key is still there;
   - `keep-me`, `preferences` and `someOtherSetting` are unchanged;
   - each CDS entry appears once;
   - the memory from A is untouched.

**C. Uninstall** (silently).
- **The config:** CDS's two entries are gone; `keep-me`, `preferences` and `someOtherSetting` remain; there's no BOM.
- **The memory:** the folder under Documents is untouched.
- **The keys file:** report what happened to it.
- **The program:** no CDS files are left in the install folder, apart from anything the uninstall deliberately keeps (list it).

**D. Redirected Documents.**
1. Point the user's Documents somewhere else, the way OneDrive does: set `Personal` in both `HKCU\...\Explorer\User Shell Folders` and `Shell Folders` to `C:\Users\WDAGUtilityAccount\RedirectedDocs` (create it). Confirm `[Environment]::GetFolderPath('MyDocuments')` returns it, from a new process.
2. Repeat A's install and smoke test.
3. Check:
   - memory is written under `RedirectedDocs\ClaudeDevStudio`;
   - nothing CDS-related is created in `C:\Users\WDAGUtilityAccount\Documents`.

If Windows Sandbox can't start (the feature is off, or virtualization is unavailable), report it and stop this part. Don't install on the host instead.

### 11. Release notes

Write `docs\releases\RELEASE_NOTES_v1.3.0.md` for users, in plain words:
- **what was broken:** the split memory; the installer deleting other servers and keys; the VS Bridge open to web pages; Visual Studio 2022 only;
- **what's fixed;**
- **that memory saved by v1.2.x is still read** (both folders);
- **what users should do after installing:** quit and reopen Claude Desktop; if they use Visual Studio, reopen it;
- **how to report a problem.**

---

## Verification

- **Builds:** the CLI, TrayApp, Dashboard and VSIX build with 0 errors and no new warnings; `tools\check-versions.ps1` passes.
- **Smoke tests on the host:** 16/16 (installed CLI), and every check with `--cli bin\Release\net8.0\claudedev.exe`.
- **The sandbox run:** scenarios A–D all PASS, with `results.json` saved in `tools\sandbox-test\results\<run>\` (gitignored; copy the summary into the output).
- **The path search:** no Dan-specific path left in shipped files (show the search and its result).
- **The repo:** nothing removed is referenced by anything that builds; `release.yml` parses; `deploy.ps1 -DryRun` lists the right files and never mentions `qwen_config.json`.

---

## On completion

1. **Write `docs\P2_OUTPUT.md`.** Put first what Dan must do: review, then publish v1.3.0 (the producer will walk him through it). Then:
   - "Decisions I made";
   - each work item with evidence;
   - the sandbox results table;
   - the installer's size and SHA-256;
   - anything not done, and why.
2. **Update `docs\GROUND_TRUTH.md`:**
   - **§2:** a "P2 done" line;
   - **§3:** the new installer files;
   - **§7:** mark items 3, 4, 9, 10, 11, 14, 15 and 16 as fixed, or say what's left;
   - **§9:** P2 ✓, next: Dan publishes, then P3;
   - **§10:** the real build commands, the sandbox test, the new `deploy.ps1`;
   - **§12:** a P2 row;
   - "Last updated".
3. **Commit** with the message `P2: installer keeps other servers and keys, any Visual Studio, no Dan-specific paths; repo clean-up; README; Windows Sandbox tests`, **then push.** No tag, no release.

=== P2 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
