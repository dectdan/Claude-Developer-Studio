# P3 Output — What Claude sees on walking in

*2026-11-11, Claude Code (Opus 5.5), unattended. Prompt: `docs\P3_prompt.md`. Nothing was deployed, installed, tagged or released. The installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`, Claude Desktop's config and every `qwen_config.json` were not touched or opened.*

---

## For the producer (and Dan)

1. **Deploy P3 to Dan's PC** (the producer). The memory server now imports a new module, so copy with the script, not by hand:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1 -DryRun   # lists 9 files: the CLI's changed files, index.js, workbench.js, cds-paths.js (new), templates\*.md (new)
   powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1
   ```
   **If you copy by hand** (as in D1), copy `mcp-server\cds-paths.js` and `mcp-server\templates\` too: `index.js` and `workbench.js` won't start without `cds-paths.js`, and the scaffold needs the templates. Deploy the CLI as well: handoffs need the new `claudedev.exe` (`record <path> handoff`).
2. **Quit Claude Desktop fully and reopen it.** Then `claudedev_load` on a project: it should lead with the ground truth's Status. Check with `node mcp-server\test\smoke.mjs --cli "%LOCALAPPDATA%\ClaudeDevStudio\CLI\claudedev.exe"` (expect 40 passed).
3. **`Installer\Output\ClaudeDevStudio-Setup.exe` is now a P3 test build** (SHA-256 `0DFA0E1D33BEA6DE659065212EE77934A8AF765F09B2D998222CC289F1F97F33`, still versioned 1.3.0). Don't attach it anywhere. The published v1.3.0 EXE is kept beside it as `ClaudeDevStudio-Setup.exe.bak_20261111_1515` (SHA-256 `CB86B708…3186D`, matches the release); both are gitignored.
4. **P4 releases v1.4.0** (version bump, hooks, installer polish, sandbox run).

## Results at a glance

| Check | Result |
|---|---|
| CLI build (Release, `--no-incremental`) | **0 errors, 42 warnings** (42 before P3; the same set) |
| `node --check` | `index.js`, `workbench.js`, `cds-paths.js`, `smoke.mjs`, `show.mjs`: all 0 |
| `smoke.mjs --cli bin\Release\net8.0\claudedev.exe` | **40 passed, 0 failed** (16 original + 8 P1 + 16 P3) |
| `smoke.mjs` (installed CLI v1.3.0) | **29 passed, 0 failed** (the original 16 + 13 P3); skipped and named: the P1 CLI checks, and the 3 handoff checks ("handoff is saved by the CLI", "the next load shows the handoff first, with its age", "an automatic handoff never replaces the explicit one") |
| `smoke.mjs` against the staged installer copy (`Installer\build\mcp-server\index.js`, `--cli`) | 40 passed |
| `tools/list` JSON, memory server | **before 3,560 bytes (9 tools); after 5,471 bytes (12 tools)**; `instructions` 396 → 660 characters. Workbench 4,129 bytes (13 tools, unchanged count) |
| Budget test (500 activities, 100 mistakes, 40,969-byte ground truth, a handoff) | load **7,878 characters** (≤ 12,000; even under the 8,000 aim), handoff and Status present |
| Real projects (read-only `show.mjs claudedev_load`) | ClaudeDevStudio **7,004**, SongSpark **5,026**, Argus **4,270**, CQAutoparts **3,356** characters |
| Templates searched for `Dan`, `Gain`, `D:\`, `C:\Users`, project names, `OneDrive`, the GitHub user | **0 matches** (word-bounded; without bounds the only hits were "again"/"against") |
| Installer build (`build-setup.ps1`, all the way) | OK in 2.3 min; the staged `mcp-server` and the EXE (listed with 7-Zip) contain `cds-paths.js` and `templates\GROUND_TRUTH.md`, `CONVENTIONS.md`, `HOW_WE_WORK.md` |

## Decisions I made

1. **12 tools, not 11.** The prompt asks for three new tools (scaffold, handoff, record_decision) on top of 9, and its test list says 11. 9 + 3 = 12. Dropping an existing tool would break callers, and `claudedev_init` stays by decision (§6). The smoke test checks 12 and says why.
2. **Handoffs, one file and one format.** Both kinds are a `Handoff` record (`MemorySchemas.cs`) rendered the same way. `HANDOFFS.jsonl` keeps every handoff, explicit and automatic. `session_handoff.md` holds the latest; its first line is `<!-- cds-handoff: explicit -->` or `<!-- cds-handoff: auto -->`. An automatic handoff writes the file only when it doesn't hold an explicit one, so **an explicit handoff is replaced only by a newer explicit one.** The `handoff` command used to trigger the old document by setting the token counter to 200,000, and that value stayed in `session_state.json`. It now calls `WriteAutomaticHandoff` directly. The CLI's context-usage warning uses the same method.
3. **Load shows `session_handoff.md`.** Its age comes from the "Written yyyy-MM-dd HH:mm" line, or the old format's "Generated:" line, or else the file's modified time. Old-format files are shown and labelled "automatic, older format". The handoff is capped at 2,500 characters with a pointer, so the part that is never trimmed has a known size.
4. **The Next line.** The last `**Next:**` line in Status, printed separately only if the Status tail doesn't already show it. **If Status has none, the file's last one**, labelled "from elsewhere in the file". SongSpark keeps its Next under Prompt History, and that is the line Claude most needs.
5. **Where a section ends:** at the next heading of the same or higher level, **or at a `---` rule followed by a heading.** Without the rule check, SongSpark's "### Standing decisions" (under "## 5. Open Questions", after a rule) would count as open questions.
6. **Open questions:** struck-through items (`~~...~~`) and their indented lines count as settled and are dropped. A section whose first remaining line starts with "None" counts as empty. CDS's own section ("None. ... settled:") is skipped this way.
7. **The Status tail starts at an entry**, not on an indented continuation line, so a sub-bullet is never shown without its heading line. It is marked "(the last lines)", with a pointer to the heading's line number.
8. **The session line is gone from load.** The header is the project and the memory folder. Anything else the CLI's load prints (a current task, pending decisions) is still shown under "Session". The session ID costs tokens and helps nobody.
9. **FACTS.md and UNCERTAINTIES.md stay,** but only when they have real content, capped at 600 characters. They are trimmed early. The prompt didn't list them, and dropping them would hide what users wrote.
10. **Trim order:** activity (8 → 4 → a count line), patterns (5 → 2 → a count line), uncertainties, facts, decisions (5 → 3 → 1), the newest output (1,500 → 700 → title and headings), open questions, then mistakes (10 → 5 → 3). If it is still over 12,000, a final hard cut adds a pointer. No test or real project gets near that.
11. **The scaffold won't add a second ground truth.** If one exists under another name (Argus style) or at the root, `GROUND_TRUTH.md` is skipped and the reply names the existing one. Files are created with the exclusive flag (`wx`), with CRLF line endings. Placeholders are filled with function replacements, so a `$` in a summary stays literal. A missing `summary` becomes an italic "not written yet" line. Templates are checked before anything is created.
12. **"Memory was created just now" only for a new memory folder.** Argus's folder (filled by the D2 merge) had no `session_state.json`, so load ran `init` as before and said "created just now" above 26 activities. The message now needs the folder itself to be new.
13. **The version stays 1.3.0.** The bump belongs to P4's release, and `Directory.Build.props` is outside P3's scope.
14. **`setup.nsi` is unchanged.** `File /r "build\mcp-server\*.*"` already installs subfolders (the same way it installs `node_modules`). The 7-Zip listing of the built EXE confirms the new files are inside.
15. **The full installer build, with the release EXE kept.** The build overwrites `Installer\Output\ClaudeDevStudio-Setup.exe`, so I first copied the v1.3.0 EXE to `.bak_20261111_1515` (gitignored).
16. **No memory records for this session.** The conventions allow writes to Dan's store only through the smoke test's throwaway projects and the four Verification loads. So I recorded no activity, mistake or decision for ClaudeDevStudio. The producer may record them. The Identity section's `claudedev_load` at the start updated ClaudeDevStudio's `session_state.json`. The Argus load also created `FACTS.md` and `UNCERTAINTIES.md` from the CLI's templates (they were missing; nothing was overwritten). Any load does this for such a folder.
17. **Validation in the CLI:** `record ... handoff` needs `where_i_stopped` and `next_step`. `record ... decision` needs `decision` (before, an empty one was recorded). Both now print the new ID (`HND###`, `DEC###`), and the tools pass it back. A CLI without the handoff type gets a plain "update ClaudeDevStudio" hint.
18. **The `instructions` text** grew from 396 to 660 characters, still well within a few sentences. It explains the method: load first, offer the scaffold, check risky steps, record as you go, hand off before stopping.

## The work, with evidence

### 1. `load` leads with the project's own state
- **Code:** `mcp-server\index.js`:
  - `findGroundTruth` checks `docs\GROUND_TRUTH.md`, then the newest `docs\*ground*truth*.md`, then the root `GROUND_TRUTH.md`.
  - `mdHeadings` skips code fences. `sectionLines`, `tailLines` and `headLines` cut sections at entry boundaries.
  - `groundTruthSection`, `outputSection`, `handoffSection` and `buildContext` build the output. Each section has variants, largest first, for the budget.
- **Order** (checked by smoke and on the real projects): header → last handoff → ground truth (path, title, Last updated, Status tail, Next, open questions, method note) or the no-ground-truth block → newest output → mistakes → decisions → facts/uncertainties → patterns → activity.
- **Smoke:**
  - "load with a scaffolded ground truth shows its Status before the memory sections";
  - "load with a hand-made "## 2. Status": the last Status lines and the Next line" (80 dated lines with the Next line at the top: step 80 shown, step 1 not, Next printed, pointer with the line number);
  - "load shows only the still-open questions";
  - "load shows the newest Pn_OUTPUT.md: title, first section, the other headings" (P2 newer than P1 by modified time; also checks the CONVENTIONS/HOW_WE_WORK note);
  - "load with no ground truth offers the scaffold (create only if the user agrees)".
- **Budget:** smoke "the budget: ..." gives 7,878 characters. The check also requires the pointers: the mistakes' "(N older in ...MISTAKES.jsonl ...)" and the handoff's "[... the rest: ...]" (its notes are 3,360 characters, over the 2,500 cap). The real projects' sizes are below.

### 2. `claudedev_scaffold`
- **Templates:** `mcp-server\templates\GROUND_TRUTH.md` (2,358 bytes), `CONVENTIONS.md` (1,390), `HOW_WE_WORK.md` (2,365). Each section has an italic one-line hint. The ground truth template has a dated Status line and a `**Next:**` line that load picks up.
- **Smoke:**
  - "scaffold creates the three files";
  - "scaffold touches nothing outside docs\" (the project tree before: empty; added: `docs` and its three files only);
  - "scaffold fills in the project, the date and the summary";
  - "scaffold a second time skips all three and changes nothing" (content and tree compared).

### 3. `claudedev_handoff`
- **CLI:**
  - `Program.cs` `RecordData` gets the `handoff` case;
  - `ClaudeMemory.cs` gets `RecordHandoff`, `WriteAutomaticHandoff`, `BuildAutomaticHandoff`, `RenderHandoff` and `HandoffPath`;
  - `PrepareHandoff` and `GenerateHandoffDocument` are replaced;
  - the `handoff` command, `ShowHelp` and the usage text are updated.
- **Direct CLI probe:** in a throwaway project, the sequence auto `HND001`, explicit `HND002`, auto `HND003` gave this result:
  - `session_handoff.md` kept the explicit `HND002`, and the CLI said "the explicit handoff is kept";
  - `HANDOFFS.jsonl` held all three;
  - `tokens_used` stayed 0;
  - a handoff without `where_i_stopped` gave exit 1 with "A handoff needs "where_i_stopped" and "next_step"."
- **Smoke (`--cli`):**
  - "handoff is saved by the CLI (session_handoff.md and HANDOFFS.jsonl)";
  - "the next load shows the handoff first, with its age" (`--- Last handoff (just now, ..., explicit) ---` before the ground truth, before the mistakes);
  - "an automatic handoff (claudedev handoff) never replaces the explicit one" (history `explicit,auto`).
- **Smoke (both modes):** "handoff without next_step is refused".

### 4. `claudedev_record_decision`
- It calls `record <path> decision` with `decision` and `chose` set to the decision, `reasoning` to why, `alternatives_considered` to the alternatives, and `file`. IDs come from `NextIdNumber`.
- **Smoke (both CLIs):**
  - "record_decision is written by the CLI with DEC### IDs (two decisions, two IDs)" (every field compared);
  - "load shows the decisions with their reasons, newest first".

### 5. The server's instructions
Rewritten (660 characters, `index.js` `INSTRUCTIONS`). Smoke: "server sends instructions".

### 6. The VS Bridge folder asks Windows (§7 item 17)
- `mcp-server\cds-paths.js` exports `documentsDir()`, which asks PowerShell once, caches the answer, and falls back as `index.js` did before. It also exports `memoryRoot()` and `vsBridgeDir()`.
- `index.js` imports `memoryRoot` (its own copy is removed). `workbench.js` replaces `resolveVsBridgeDir` (the OneDrive-then-Documents probe) with `vsBridgeDir()` at each of its 4 uses, so it now asks on the first VS tool call instead of at start-up.
- **Checked:** `vsBridgeDir()` = `C:\Users\…\OneDrive\Documents\ClaudeDevStudio\VSBridge`, the folder `[Environment]::GetFolderPath('MyDocuments')` gives. `claudedev_vs_get_state` and `claudedev_vs_get_errors` read the real bridge files from it.

### 7. Ship the new files
- `Installer\build-setup.ps1` stages `cds-paths.js` and `templates\*.md`. `deploy.ps1` copies the same files (dry run above). Both parse with 0 errors and have no curly quotes.
- Full build: OK. The staged `Installer\build\mcp-server\` holds `cds-paths.js` and `templates\` (3 files). `7z l` on the EXE lists `$LOCALAPPDATA\ClaudeDevStudio\mcp-server\cds-paths.js` and `...\mcp-server\templates\*.md`.

### 8. Docs
- `README.md`: a new section "Working with ground truths" (what load shows, what the scaffold creates, the loop in three steps). It replaces the "CDS v1.4 will help set this up" paragraph. The `claudedevstudio` row lists the new tools.
- `CONTRIBUTING.md`: rewritten in the README's style (folder layout, build, test, the method, what a PR should include). The old file had WiX-era steps and `Cloud-Developer-Studio` links.

### 9. Tests
`smoke.mjs` has the P3 block (16 checks; 13 without the new CLI). It uses throwaway projects `_cds_smoketest_<time>`, `_handmade` and `_budget`, all removed afterwards; no `_cds_*` memory folders were left after the runs. `show.mjs` prints `[ok] N characters`.

## The real projects (read-only, `show.mjs claudedev_load`, final run)

| Project | Characters | Leads with |
|---|---|---|
| `D:\Projects\ClaudeDevStudio` | 7,004 | Ground truth (`docs\GROUND_TRUTH.md`: Status tail from the D1 line to the Next line) > newest output (`P2_OUTPUT.md`: "For Dan") > mistakes (4) > activity (4 of 15, trimmed for the budget) |
| `D:\Projects\SongSpark` | 5,026 | Ground truth (Status tail, Next from Prompt History, 3 open questions, method note) > newest output (`P8_UPDATE_OUTPUT.md`). Its memory has no activities or mistakes (the folder holds only the CLI's template files and the session state) |
| `D:\Projects\Argus` | 4,270 | Ground truth found under its own name (`docs\ARGUS — GROUND TRUTH (READ FIRST) — up.md`, "## Build status (long side)"; no Next line in that file) > note: no HOW_WE_WORK.md > mistakes (2) > activity (8 of 26) |
| `D:\Projects\CQAutoparts` | 3,356 | The no-ground-truth block (offer the scaffold, only with the user's OK) > mistakes (2) > activity (8 of 25) |

These loads ran before this output file existed. From now on, ClaudeDevStudio's newest output is `P3_OUTPUT.md`.

## The SongSpark sample (first 40 lines of load)

```
=== ClaudeDevStudio: SongSpark ===
Memory folder: C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio\Projects\SongSpark

--- Ground truth: docs\GROUND_TRUTH.md ---
# Song Spark — Ground Truth
*Last updated: 2026-11-10 (P8: ready to package; the pre-flight passed; P2 check fixed for working cloud keys)*
## 2. Status (the last lines)
[... earlier lines: docs\GROUND_TRUTH.md, line 21]
- **2026-11-10, P8 done (ready to package):**
  - **The pre-flight has no ✗** (`docs\P8_preflight.md`):
    - the bundle (42 files, 8,753,110,176 bytes, every SHA-256 right);
    - Release 0 errors / 0 warnings, 310 unit tests;
    - the identity as §3, version 1.0.0.0;
    - 90 PNGs, all under 200 KB;
    - the Release-only behaviour checked, with no Debug code reachable;
    - the packaging settings listed, none changed;
    - the Release layout 388 files, 8,872,614,324 bytes.
  - **For Dan:** no `internetClient` capability (not needed: full trust); packaging an 8.3 GB package takes a while.
  - **The P2 check** runs its three hardware cases with "cloud services in this build" at 0: 32/32 again.
  - **Checks:** P1 67/67, `--p7c-check` 18/18, `--p7b-check --offline` 14/14.
  - **Dan's steps** for Visual Studio 2022 17.14.41: `docs\P8_Dan_packaging_steps.md`. Details in
    `docs\P8_OUTPUT.md`.
- **2026-11-10, packaged and submitted to the Store (version 1.0.5.0):**
  - **Packaged through `SongSpark.Package`**, the Windows Application Packaging Project Dan added (§4). Song Spark now
    finds its engine from its own folder, and the 7 runtimes sit in `engine\` and `llama\`. The first package (1.0.2.0)
    was made before those fixes and never used.
  - **Tested:** the P2 check 32/32 on the Debug copy; then 1.0.3.0 and 1.0.5.0 sideloaded and used by Dan (lyrics,
    songs, playback, folders); the Windows App Certification Kit passed.
  - **From Dan's testing:** a Close button in Report AI content, and a second Report AI content button at the top right
    of Help.
  - **The listing:** `docs\STORE_SUBMISSION_SongSpark.md` ($9.99, 7-day trial set in Partner Center).
  - **Lost on the way:** Visual Studio's Deploy step removed the Debug copy and its local data; saved lyrics restored
    from a 15:00 copy, saved styles and settings lost (Dan's test data only).
Next (from elsewhere in the file): Dan runs Visual Studio's Create App Packages (`docs\P8_Dan_packaging_steps.md`), then P8b checks the packages.
## 5. Open Questions (still open)
3. **The sound reference:** one "Sound reference" control (a style and timbre reference), with "Use only audio you own or have the rights to use". Possibly bundled style clips from Dan's own songs (30 seconds each, the length ACE-Step's reference uses).
5. **Price and trial.**
7. **(P1) The lyrics editor's 28 px line height** needs a RichEditBox instead of a TextBox (WinUI's TextBox has no line height). Worth it?
[... more: docs\GROUND_TRUTH.md, line 179]
(No docs\CONVENTIONS.md or docs\HOW_WE_WORK.md: claudedev_scaffold can add them; it never overwrites. Offer it; don't just do it.)
```

## Files

- **Changed** (each backed up as `.bak_20261111_1504`, gitignored):
  - `mcp-server\index.js`, `mcp-server\workbench.js`;
  - `ClaudeMemory.cs`, `MemorySchemas.cs`, `Program.cs`;
  - `mcp-server\test\smoke.mjs`, `mcp-server\test\show.mjs`;
  - `Installer\build-setup.ps1`, `deploy.ps1`;
  - `README.md`, `CONTRIBUTING.md`, `docs\GROUND_TRUTH.md`.
- **New:** `mcp-server\cds-paths.js`, `mcp-server\templates\GROUND_TRUTH.md`, `CONVENTIONS.md`, `HOW_WE_WORK.md`, `docs\P3_OUTPUT.md`.
- **Not changed:** `Installer\setup.nsi` (decision 14).
- **Build output (gitignored):** `Installer\build\`; `Installer\Output\ClaudeDevStudio-Setup.exe` (the P3 test build) and the kept v1.3.0 EXE.

## Not done, and why

- **No sandbox run, deploy, tag or release:** the prompt leaves those to the producer and P4.
- **`mcp-server\README.md` is stale.** It describes 7 tools from before v1.3.0. It was outside P3's scope (not in the Modified list); worth a line in P4.
- **A mistake on the way, not recorded in memory:** the first CLI probe's clean-up built a Windows path in Git Bash and the backslashes got mangled (the lesson already recorded in this project). Nothing went wrong as a result: the probe's memory folder was then removed with PowerShell, checked gone, and no `_cds_*` folders remain. It wasn't recorded because of decision 16.
- **Redirected Documents was not tested on another location** for the workbench. That needs a different Windows setting, which the P2 sandbox kit's scenario D covers. P4's sandbox run will exercise it with the new `cds-paths.js`.

=== P3 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
