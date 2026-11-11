# P1 Output — Correctness and security in the code

*2026-11-11, Claude Code (Opus 5.5). Prompt: `docs\P1_prompt.md`. Nothing was installed or deployed.*

---

## For Dan: two steps

The VS Bridge fix is built but not installed. Installing it is your step because Visual Studio must be closed.

1. **Close every Visual Studio window**, then install the new VSIX (double-click it, or run the line below):
   ```
   D:\Projects\ClaudeDevStudio\VSExtension\CdsVsBridge\bin\Release\CdsVsBridge.vsix
   ```
   ```powershell
   & "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\VSIXInstaller.exe" D:\Projects\ClaudeDevStudio\VSExtension\CdsVsBridge\bin\Release\CdsVsBridge.vsix
   ```
   (Use the `Professional` or `Enterprise` folder if that's your edition. The installer shows version **1.3.0**.)
2. **Open Visual Studio with any solution**, then run:
   ```powershell
   node D:\Projects\ClaudeDevStudio\mcp-server\test\caller-check.mjs http://localhost:62000
   ```
   Expect `5 passed, 0 failed`. The foreign-Host check prints `refused by Windows HTTP.sys before reaching the bridge`; that is correct (see fix 6).

Rollback: uninstall "CDS VS Bridge" in Extensions › Manage Extensions, then install `%LOCALAPPDATA%\ClaudeDevStudio\VSExtension\CdsVsBridge.vsix` (the v1.2.1 one).

Everything else (new CLI, `index.js`, `workbench.js`, Review Panel) reaches the installed copy in P2 through the installer. The installed copy was not touched.

---

## Results at a glance

| Check | Result |
|---|---|
| CLI `dotnet build -c Release` | 0 errors, 42 warnings (42 before) |
| `smoke.mjs --cli bin\Release\net8.0\claudedev.exe` | **24 passed, 0 failed** (16 old + 8 new) |
| `smoke.mjs` (installed CLI) | **16 passed, 0 failed**; P1 checks skipped, as designed |
| `smoke.mjs --cli <installed v1.2.1 CLI>` (control) | 19 passed, 5 failed: the 5 CLI-bug checks fail on the old CLI, so they test what they claim |
| `tools\check-versions.ps1` | All 16 places say 1.3.0 (exit 0); a test copy with one wrong number exits 1 |
| VSIX build | 0 errors, 12 warnings (12 before); `.vsix` manifest says 1.3.0 |
| `caller-check.mjs` vs Review Panel from source on 63099 | **7 passed, 0 failed** (via `127.0.0.1` and via `localhost`) |
| Review Panel's own page in a browser | Item appeared over `/events`; its × button sent `DELETE /review/3` → 200 |
| `node --check` | `index.js`, `workbench.js`, `server.js`, `smoke.mjs`, `caller-check.mjs`: OK |
| TrayApp / Dashboard (share `ClaudeMemory.cs`, `MemorySchemas.cs`) | 0 errors; 23 / 9 warnings (23 / 9 before) |

---

## The fixes, with evidence

### 1. Unique IDs (§7 item 5)
`ClaudeMemory.cs`: `RecordMistake`, `RecordPattern`, `RecordDecision` now get the next number from their own file through a new `NextIdNumber(file, prefix)`: it reads every line's `id`, takes the highest `PREFIX<digits>`, and adds 1. It doesn't use `_index`. A line that isn't valid JSON or has no `id` is skipped. Patterns use `PAT###`, or `ANTI###` when `is_antipattern` is true, each with its own count. `\d+` accepts the merge script's `ERR###` and any 4-digit numbers.
- **Evidence:** smoke "two mistakes recorded get two different IDs" (ERR001, ERR002). With the old CLI the same check fails (ERR001 twice).
- Duplicate `ERR001` entries already in the stores stay as they are (nothing rewrites memory data). New IDs continue after the highest existing number.

### 2. A mistake check that matches (§7 item 6)
`MemorySchemas.cs`: a new `MistakeMatching` class uses the same rule as `index.js` `similarMistakes`: words matching `[a-z0-9_.-]{4,}`, lower-cased, minus the same stop words (copied exactly); the mistake's words are `mistake` + `lesson`; a match needs ≥3 shared words making ≥30% of the smaller set. `Mistake.MatchesAction` uses it, and the new `Mistake.MatchScore` returns the score. `CheckForMistake` returns the best match (highest score; the newest one on a tie). Both files have a "MUST STAY IN STEP" comment.
- **Evidence:** smoke "CLI alone matches the similar plan" (`claudedev check` run directly, exit 1, `Mistake ID: ERR…`) and "CLI alone is quiet on the unrelated plan" (exit 0). The old CLI fails the first.

### 3. Clean UTF-8 output (§7 item 7)
- `Main` sets `Console.OutputEncoding` to UTF-8 (no BOM) first, inside a try in case there is no console.
- I scanned every tracked `.cs` and `.xaml` (except the dead `VoiceServer\` and `MCP\` folders) with a script that finds UTF-8 decoded as Windows-1252. **Only `Program.cs` had garbled text: 104 sequences on 52 lines**, now ✓ (35), ✗ (18), ⚠️ (6), ❓ (1), → (1) and ─ (37). The other files already held correct symbols. `Program.cs` is saved as UTF-8 without BOM, with CRLF line endings as before.
- `index.js` `cleanCliText` is unchanged.
- **Evidence:** smoke "CLI output has a real ✓ and no â". The old CLI fails it.

### 4. `load` keeps the session current (§7 item 13)
`ClaudeMemory.LoadContext` now saves `session_state.json` at the end. If the last activity is more than 8 hours old, or there is no session ID, it starts a new session `yyyy-MM-dd_HH-mm` and resets `started`. The gap is measured in UTC, so a file holding a UTC time (`…Z`) or a local time with an offset gives the same result.
- **Evidence:** smoke "load twice updates session_state.json last activity" (two direct `claudedev load` calls; `last_activity` goes up each time, same session ID) and "load after 8+ hours starts a new session ID" (a throwaway `session_state.json` set to 9 hours ago gets a new ID, and `load` prints it). The old CLI fails both.
- After the new CLI is installed, the first `claudedev_load` on each project replaces the stale February session line with a new session.

### 5. One version number (§7 item 8)
- **`Directory.Build.props`** (new, root): `<Version>1.3.0</Version>` for every C# project. `ClaudeDevStudio.csproj` no longer sets its own (the other projects never did).
- **`Program.cs`:** `ShowVersion` and `ShowHelp` print `typeof(Program).Assembly` version (`claudedev version` → `ClaudeDevStudio v1.3.0`).
- **`mcp-server\package.json`, `manifest.json`:** 1.3.0. **`index.js` and `workbench.js`** read `version` from `package.json` beside them at startup ("unknown" if it can't be read; the installer already ships `package.json`). `workbench.js`'s `fetch_url` User-Agent uses it too.
- **`setup.nsi` `PRODUCT_VERSION`, `install-extension.ps1` `$Version`, VSIX manifest `Identity Version`:** 1.3.0.
- Also set to 1.3.0: `review-server\package.json` (was 1.0.0), and the version the VS Bridge logs on load in `CdsVsBridgePackage.cs` (was 1.0.0). Both are checked.
- **`tools\check-versions.ps1`** (new) prints every place, with OK or DIFF, and exits 1 on any difference. It checks: the props file; that no C# project sets its own version; the 7 files above; that both servers read `package.json` and hold no literal; that `Program.cs` has no literal; and, if built, `bin\Release\net8.0\claudedev.exe version`. ASCII only; the PowerShell parser reports 0 errors.

### 6. The VS Bridge answers only local programs (§7 item 2)
`VsBridgeServer.cs` `HandleRequest`: the `Access-Control-Allow-Origin: *` header is gone. A new `IsAllowedCaller` answers **403** to any request with an `Origin` header, and to any `Host` other than `localhost:62000` / `127.0.0.1:62000`. Nothing else changed. `workbench.js` sends `Host: localhost:62000` and no Origin, so it still passes.
- **About the Host check:** `HttpListener` is registered for `http://localhost:62000/`, so Windows' HTTP.sys answers **400 "Invalid Hostname"** to a foreign Host before the extension sees the request. That already stops DNS rebinding. The 403 check in the code is a second layer. `caller-check.mjs` counts that HTTP.sys 400 (identified by `Server: Microsoft-HTTPAPI`) as refused and says so.
- **Built:** see "Build notes" below. **Not yet run against a live VS:** Dan's step 2.

### 7. The Review Panel answers only itself (§7 item 2)
`review-server\server.js`: the `*` header on `/events` is gone. Middleware placed before the JSON body parser (so a refused caller's body is never read) answers **403** when `Host` isn't `127.0.0.1:<port>` / `localhost:<port>`, and when an `Origin` header is present and isn't `http://127.0.0.1:<port>` / `http://localhost:<port>`. The port is `process.env.CDS_REVIEW_PORT`, default 63000, and both checks use it.
- **One deliberate difference from §7's wording:** the prompt refuses a foreign Origin only for non-GET requests, but the caller check requires a GET with `Origin: https://example.com` to get 403. I refuse a foreign Origin on every method. The panel's own page is unaffected: browsers send no Origin on its same-origin GETs (the page, `/events`), and send its own origin on its DELETEs. Confirmed in a browser (see the table).

### 8. `index.js` (small)
- **`CDS_CLI_PATH`** overrides the CLI path when set, with a comment saying it's for tests (`smoke.mjs --cli`).
- **The "older entries were also read" note** now shows only when at least one listed mistake or activity was read from the old store. A `WeakMap` records which folder each entry came from. Before, the note appeared whenever the old folder existed.
- Other changes: the version is read from `package.json` (fix 5), and the "stay in step" comment (fix 2). Nothing else changed. The 16 original smoke checks pass.
- **Evidence:** smoke "no 'older entries' note when the old store adds nothing" and "note when an old-store entry is shown". The test makes a throwaway folder in the old store and removes it. Run against the pre-P1 `index.js`, the first check fails, as it should.

### 9. Tests
- **`smoke.mjs`**: `--cli <path>` passes `CDS_CLI_PATH` to the server and runs 8 new checks. The 4 asked for (different IDs; the CLI run directly matches the similar plan and not the unrelated one; a real ✓ and no `â`; two loads update `last_activity`), plus the 8-hour new session and the two "older entries" checks. Without `--cli` it runs the original 16 and prints that the P1 checks were skipped. That keeps "16 passed" true for the installed CLI and for the §10 deploy recipe. Cleanup removes the throwaway memory folder, any old-store folder the test made, and the `%TEMP%` project. Afterwards no `_cds_smoketest_*` folder was left in either store.
- **`caller-check.mjs`** (new): `node caller-check.mjs <base URL> [--bridge|--panel]` (port 62000 means the bridge). It checks: GET without Origin → 200; no `Access-Control-Allow-Origin`; GET with `Origin: https://example.com` → 403; GET with `Host: evil.example` → 403 (or HTTP.sys 400 for the bridge). For the panel it also checks POST and DELETE from its own origin → accepted, and POST from a foreign origin → 403. For the bridge it checks POST `/command` from a foreign origin → 403, using an unknown action name, so even an old unprotected bridge would do nothing. Every request is harmless.
- The Review Panel ran from source with `CDS_REVIEW_PORT=63099` and was stopped afterwards (port 63099 free again). The real panel on 63000 was never touched.

---

## Warning counts

| Project | Before | After |
|---|---|---|
| CLI (`ClaudeDevStudio.csproj`, Release, no-incremental) | 42 | 42 |
| TrayApp | 23 | 23 |
| Dashboard (x64) | 9 | 9 |
| VS Bridge (VSIX) | 12 | 12 |

All errors: 0. No new warnings.

## Build notes

- **`dotnet build VSExtension\CdsVsBridge\CdsVsBridge.csproj -c Release` does not build the VSIX, before or after P1.** It's an old-style (.NET Framework 4.8, VSSDK) project, and the .NET SDK can't resolve its references (CS0246 for `EnvDTE`, etc.). Visual Studio's MSBuild builds it:
  ```powershell
  & "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe" VSExtension\CdsVsBridge\CdsVsBridge.csproj -restore -t:Rebuild -p:Configuration=Release -p:DeployExtension=false
  ```
  `-p:DeployExtension=false` skips installing into an experimental VS instance. Without it the build makes the `.vsix` and then fails with VSSDK1077 (no experimental instance on this PC). P2 should use this command.

## The version list

| Place | Version |
|---|---|
| `Directory.Build.props` | 1.3.0 (the one version) |
| `ClaudeDevStudio.csproj`, `ClaudeDevStudio.TrayApp.csproj`, `ClaudeDevStudio.Dashboard.csproj`, `CdsVsBridge.csproj` | inherit 1.3.0 |
| `mcp-server\package.json`, `mcp-server\manifest.json`, `review-server\package.json` | 1.3.0 |
| `index.js`, `workbench.js` | read `package.json` → 1.3.0 |
| `Installer\setup.nsi`, `Installer\install-extension.ps1` | 1.3.0 |
| `source.extension.vsixmanifest`, `CdsVsBridgePackage.cs` (log line) | 1.3.0 |
| `Program.cs` → `claudedev version` / `help` | assembly version → 1.3.0 |

**Places not made to follow the one version, and why:**
- `Package.appxmanifest` (root, 1.0.0.0) and `ClaudeDevStudio.Dashboard\Package.appxmanifest` (1.0.0.0): MSIX packaging, not used. The Dashboard builds with `WindowsPackageType None`; the root one is read only by `Installer\Build-MSIX.ps1`. MSIX needs a 4-part number anyway. P2 clean-up candidates.
- `Installer\Build-MSI.ps1`, `Installer\Build-MSIX.ps1` (`$Version = "1.0.0.0"`): WiX/MSIX-era scripts, replaced by NSIS. P2 clean-up candidates.
- `UpdateChecker.cs` (`?? "1.1.0"`) and `ClaudeDevStudio.UI\Program.cs` (`?? "1.0.0"`): fallbacks used only when both the registry value the installer writes and the assembly version are missing. Left as they are.
- `Installer\build\` holds old copies (1.1.0, 1.2.0): it's the installer's staging folder, gitignored, and rebuilt by `build-setup.ps1`.

---

## Other changes made on the way

- **`Program.cs` `stats` and `handoff` used a hard-coded `C:\Users\Dan\Documents\…` path** (a path from another PC in shipped code). Both now use `SessionStateManager.GetMemoryPath`, the real Documents folder. Before, `claudedev handoff` always ended in "Failed to generate handoff document" because the file was written elsewhere.

## Not done, or left on purpose

- **VS Bridge caller check against a live Visual Studio:** Dan's step 2, after installing the VSIX.
- **Stats note:** `index.js` `claudedev_stats` still prints "(Includes older entries from …)" whenever the old folder exists. The prompt limited `index.js` to the two changes ("Change nothing else"). The same `entrySource` test could fix it later.
- **A tiny difference in matching:** `index.js` builds a mistake's words from `` `${m.mistake} ${m.lesson}` ``, so a mistake with no `lesson` gets the word "undefined". The CLI uses an empty string. That only matters if a plan contains the word "undefined". Left because of "Change nothing else".
- **`VoiceServer\` and `MCP\`** were not scanned for garbled text: they're dead code, not built, and P2 removes them.
- **Backups:** every edited file has a `.bak_20261111_1234` copy beside it (untracked, not committed).
- **Not written to:** Dan's memory stores (only `smoke.mjs`'s throwaway project), the installed copy, `qwen_config.json` (not opened), `deploy.ps1` (not run).
