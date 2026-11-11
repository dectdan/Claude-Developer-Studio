# ClaudeDevStudio — P1 (Claude Code Prompt)
# Correctness and security in the code (nothing is released or deployed here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop, from Gain Publications (Dan). It's **free, MIT, and public**: other people install it.
- **Project:** `D:\Projects\ClaudeDevStudio` (git `main`; `github.com/dectdan/Claude-Developer-Studio`, **public**).
- **CLI:** root `*.cs`, `ClaudeDevStudio.csproj` (.NET 8). **MCP servers:** `mcp-server\index.js` (memory), `mcp-server\workbench.js`. **VS Bridge:** `VSExtension\CdsVsBridge`. **Review Panel:** `review-server\server.js`. **TrayApp:** `ClaudeDevStudio.UI`. **Installer:** `Installer\` (NSIS).

Start with ClaudeDevStudio: `claudedev_load` with `D:\Projects\ClaudeDevStudio`.

---

## Why

The 2026-11-11 audit (ground truth §2, §7) found the memory had been split in two for months. `index.js` v1.3.0 fixed the MCP side and is deployed on Dan's PC. Four problems remain in the code before a public v1.3.0:
- the CLI's own bugs (repeated IDs, a mistake check that almost never matches, garbled symbols);
- version numbers that disagree across the files;
- the VS Bridge and the Review Panel answer any web page.

P2 then builds the installer and tests a fresh install.

---

## Read first

1. `docs\GROUND_TRUTH.md`, in full. Pay attention to §4 (architecture, memory format), §6 (the decisions behind `index.js` v1.3.0; **don't undo any of them**), §7 (items 2, 5, 6, 7, 8, 13), §10 and §11.
2. `ClaudeMemory.cs` (`RecordMistake`, `RecordPattern`, `RecordDecision`, `LoadContext`, `SaveSessionState`) and `MemorySchemas.cs` (`Mistake.MatchesAction`).
3. `Program.cs`: `Main`, `RecordData`, `CheckAction`, `LoadContext`, `ShowVersion`, `ShowHelp`.
4. `mcp-server\index.js` (`similarMistakes`, `buildContext`, `runCli`) and `mcp-server\test\smoke.mjs`.
5. `VSExtension\CdsVsBridge\VsBridgeServer.cs` (the listener and request routing) and `review-server\server.js` (the headers and every route).
6. Every place a version number lives: `ClaudeDevStudio.csproj`, `ClaudeDevStudio.UI\*.csproj`, `ClaudeDevStudio.Dashboard\*.csproj`, `VSExtension\CdsVsBridge\source.extension.vsixmanifest`, `mcp-server\package.json`, `mcp-server\manifest.json`, both servers' `new Server(...)`, `Installer\setup.nsi`, `Installer\install-extension.ps1`, `Program.cs`.

---

## Scope

- **Modified:** `ClaudeMemory.cs`, `MemorySchemas.cs`, `Program.cs`, any other root `.cs` that holds garbled symbols, the csproj/manifest/package files that carry a version, `mcp-server\index.js`, `mcp-server\workbench.js`, `mcp-server\test\smoke.mjs`, `VsBridgeServer.cs`, `review-server\server.js`, `docs\GROUND_TRUTH.md`.
- **New:** `Directory.Build.props` (the one version), `tools\check-versions.ps1`, `mcp-server\test\caller-check.mjs`, `docs\P1_OUTPUT.md`.
- **Not touched:** the installer scripts' logic, the installed copy under `%LOCALAPPDATA%\ClaudeDevStudio`, Dan's memory stores, `qwen_config.json` anywhere.

---

## Conventions

- Back up any file before editing it (`.bak_YYYYMMDD_HHMM`). Confirm each edit's anchor text before replacing.
- **Never write to Dan's memory stores** (`[Documents]\ClaudeDevStudio\` or `%USERPROFILE%\Documents\ClaudeDevStudio\`) except through `smoke.mjs`, which uses a throwaway project and removes it.
- **Never touch the installed copy** in `%LOCALAPPDATA%\ClaudeDevStudio\`, and never stop the running Review Panel or Claude Desktop.
- **Never open, copy or print `qwen_config.json`.** It holds Dan's API keys.
- Don't run `deploy.ps1` (§7 item 10).
- Builds: 0 errors. Report the warning count before and after; add no new warnings.
- **The repo is public:** nothing personal, no keys, no paths from Dan's PC in shipped code (tests may use `%TEMP%`).

---

## The work

### 1. Unique IDs (§7 item 5)

**The problem:** `RecordMistake`, `RecordPattern` and `RecordDecision` number entries from `_index`, but `record` never loads the index, so every mistake is `ERR001`.

**The fix:** each takes the next number from its own file: read the existing IDs (`ERR###`, `PAT###`/`ANTI###`, `DEC###`), use max + 1, and don't depend on `_index`. Entries the merge script adds use the same `ERR###` form, so continue from them. An unreadable line is skipped, never fatal.

### 2. A mistake check that matches (§7 item 6)

**The problem:** `Mistake.MatchesAction` matches only when the planned action contains the mistake's whole sentence.

**The fix:** use the same rule as `index.js` `similarMistakes`, so the CLI and MCP agree:
- words of 4+ letters (`[a-z0-9_.-]`), lower-cased, minus the same stop-word list;
- the mistake's words are its `mistake` + `lesson`;
- a match needs **at least 3 shared words** making **at least 30% of the smaller word set**;
- `CheckForMistake` returns the best match.

Copy the stop-word list exactly, and put a comment in both files saying they must stay in step.

### 3. Clean UTF-8 output (§7 item 7)

- At the top of `Main`, set `Console.OutputEncoding` to UTF-8.
- Find every garbled symbol in the C# sources (`â`, `Ã`, `ð` followed by more mojibake; e.g. `âœ“` for ✓, `âš ï¸` for ⚠). Replace each with the symbol it was meant to be, and save the files as UTF-8.
- `index.js` `cleanCliText` stays; it's harmless once the output is clean.

### 4. `load` keeps the session current (§7 item 13)

`LoadContext` updates `LastActivity` but never saves it, so `load` reports the session from February.
- Save the session state at the end of `LoadContext`.
- If the last activity is more than 8 hours old, start a new session ID (`yyyy-MM-dd_HH-mm`).

### 5. One version number (§7 item 8)

- **`Directory.Build.props`** at the root sets `<Version>1.3.0</Version>` for every C# project; remove the per-project `<Version>`.
- **`ShowVersion`/`ShowHelp`** print the assembly's version, not a literal.
- **`mcp-server\package.json` and `manifest.json`:** 1.3.0. **Both servers** read their version from `package.json` at startup; no literal.
- **`setup.nsi` `PRODUCT_VERSION` and `install-extension.ps1` `$Version`:** 1.3.0.
- **The VSIX manifest:** 1.3.0.
- **`tools\check-versions.ps1`:** prints every version it finds and exits 1 if any differs. List any place you couldn't make follow the one version, and why.

### 6. The VS Bridge answers only local programs (§7 item 2)

**The problem:** `localhost:62000` sends `Access-Control-Allow-Origin: *` and accepts `debugger.*`, `build.*`, `navigate` and `evaluate` from anyone, including a web page open in the browser.

**The fix, in `VsBridgeServer.cs`:**
- remove the `Access-Control-Allow-Origin` header;
- answer **403** to any request that has an `Origin` header (browsers send one; `workbench.js`, which uses Node's `http`, doesn't);
- answer **403** unless the `Host` header is `localhost:62000` or `127.0.0.1:62000` (this stops DNS rebinding);
- leave everything else alone.

Build it: `dotnet build VSExtension\CdsVsBridge\CdsVsBridge.csproj -c Release`. **Installing the VSIX is Dan's step** (Visual Studio must be closed).

### 7. The Review Panel answers only itself (§7 item 2)

In `review-server\server.js`:
- remove the `*` header;
- for every request, answer **403** unless `Host` is `127.0.0.1:63000` or `localhost:63000`;
- for anything other than GET, answer **403** if an `Origin` header is present and isn't `http://127.0.0.1:63000` or `http://localhost:63000` (the panel's own page still works);
- **make the port configurable** for testing (`process.env.CDS_REVIEW_PORT`, default 63000) and allow that port in the two checks.

### 8. `index.js` (small)

- **`CDS_CLI_PATH`:** if set, it overrides the CLI path. It's for tests; mark it so in a comment.
- **The "older entries were also read" note:** show it only when entries from the old store were actually included.
- **Change nothing else.** The 16 smoke checks must still pass.

### 9. Tests

- **`smoke.mjs`:**
  - `--cli <path>` passes `CDS_CLI_PATH` to the server, so the new CLI is tested before it's installed;
  - add checks:
    - two mistakes recorded get two different IDs;
    - the CLI alone (run it directly, not through MCP) matches the similar plan and not the unrelated one;
    - the CLI's output contains a real ✓ and no `â`;
    - `load` twice updates `session_state.json`'s last activity.
- **New `mcp-server\test\caller-check.mjs`:** for a given base URL, check the following, and print PASS/FAIL for each:
  - GET without `Origin` → 200;
  - GET with `Origin: https://example.com` → 403;
  - GET with `Host: evil.example` → 403;
  - for the Review Panel, a POST from its own origin → accepted.
- **Run it against the Review Panel from source on port 63099** (start it with `CDS_REVIEW_PORT=63099`, stop it afterwards). Leave the VS Bridge run for Dan, after he installs the VSIX.

---

## Verification

- CLI `dotnet build -c Release`: 0 errors; warnings no higher than before.
- `node mcp-server\test\smoke.mjs --cli bin\Release\net8.0\claudedev.exe`: every check passes (16 old + the new ones).
- `node mcp-server\test\smoke.mjs` (the installed CLI): the 16 original checks still pass.
- `tools\check-versions.ps1`: everything says 1.3.0.
- The VSIX builds; `caller-check.mjs` passes against the Review Panel on 63099.
- `node --check` on both servers.

---

## On completion

1. **Write `docs\P1_OUTPUT.md`.** Put first anything Dan must do: install the VSIX, then run `caller-check.mjs` against `http://localhost:62000`. Then:
   - each fix, with the evidence;
   - the warning counts;
   - the version list;
   - anything you couldn't do, and why.
2. **Update `docs\GROUND_TRUTH.md`:**
   - **§2:** a "P1 done" line;
   - **§7:** mark items 2, 5, 6, 7, 8 and 13 fixed (for item 2, VS Bridge pending Dan's VSIX install);
   - **§9:** P1 ✓, next P2;
   - **§12:** a P1 row;
   - "Last updated".
3. **Commit** with the message `P1: CLI IDs, mistake matching, UTF-8, session state; one version 1.3.0; VS Bridge and Review Panel caller checks`, **then push.**

=== P1 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
