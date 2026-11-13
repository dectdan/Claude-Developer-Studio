# P12 Output: load points at the rules, the templates carry the full method, the ground truth back to current state; the v1.7.3 build

*2026-11-12. Nothing deployed, tagged or published.*

## What the producer must do

1. **Test v1.7.3 on machine 3** (no sandbox run, as the prompt says: Dan's call for small releases). The EXE: `Installer\Output\ClaudeDevStudio-Setup.exe`, 209,711,769 bytes, SHA-256 **`F6ECD3F495BC02C436416C421C05186FF6200897C56081D3E1E6124C99CE08C0`**. Worth looking at there: `claudedev version` says 1.7.3; `install.log` reads cleanly; in a project with `docs\CONVENTIONS.md` and/or `docs\HOW_WE_WORK.md`, `claudedev_load` (or a new Claude Code session) shows the `Rules:` line; `claudedev_scaffold` on a throwaway folder creates the new templates.
2. **Publish v1.7.3** with that EXE and `docs\releases\RELEASE_NOTES_v1.7.3.md`.
3. Dan installs it; the website still needs uploading (unchanged from before; it doesn't need a change for this release, though it could mention `Load CDS for <folder>`).

## Results at a glance

| | |
|---|---|
| Files changed | `mcp-server\cds-context.js`, `mcp-server\templates\HOW_WE_WORK.md`, `CONVENTIONS.md`, `GROUND_TRUTH.md`, `mcp-server\test\smoke.mjs`, `README.md`, `docs\GROUND_TRUTH.md`; version 1.7.3 in `Directory.Build.props`, `mcp-server\package.json`, `mcp-server\manifest.json`, `review-server\package.json`, `Installer\setup.nsi`, `VSExtension\CdsVsBridge\source.extension.vsixmanifest`, `CdsVsBridgePackage.cs`. New: `docs\history\GROUND_TRUTH_history.md`, `docs\releases\RELEASE_NOTES_v1.7.3.md`, this file. Backups `*.bak_20261112_1904` beside each edited file (gitignored). |
| Builds | 0 errors. Warnings: CLI **24**, TrayApp **14**, Dashboard **0** (`dotnet build -c Release -r win-x64 --no-incremental`), VSIX **12** (VS MSBuild, Rebuild). Unchanged. NSIS OK. |
| `build-setup.ps1` | Exit 0 in 2.4 min: templates staged (`Installer\build\mcp-server\templates\` = the source files), `check-build-paths.mjs` 4,101 files, 0 hits, 0 `.pdb`; `check-versions.ps1` "All 15 places say 1.7.3" (the built CLI too). |
| Smoke | `node mcp-server\test\smoke.mjs --cli Installer\build\CLI\claudedev.exe`: **218 passed, 0 failed, 0 skipped** (211 before + 7 `P12:` checks). |
| Ground truth | 147,818 → **40,956 bytes** (27.7%), 366 → 220 lines. The moved text: `docs\history\GROUND_TRUTH_history.md` (140,268 bytes), verbatim. |
| Runtime | The SessionStart hook run for real on a throwaway project (below). Not tested: a real Claude Desktop chat loading a project with the rules files (the installed copy is 1.7.2 and stays untouched); machine 3 is the producer's. |
| Ground truth updated | Yes: §2 (P12 done, Next), §11 (one new rule), §12 (P12 row). |

## Decisions I made

- **The rules line's wording and place:** `Rules: read docs\CONVENTIONS.md and docs\HOW_WE_WORK.md before changing anything (how this project works).` It names the exact paths that exist (`docs\` first, else the root, as `has()` looked), in the same order as the existing note (CONVENTIONS, then HOW_WE_WORK). It comes right after the ground truth's Status/Next, before the open questions, so it is near the top and is never trimmed (like the handoff and Status). With one file, the line names that one and the existing note names the other. With no ground truth but rule files present, the line is printed after the "No ground truth" block (the note isn't: that block already offers the scaffold).
- **Template layout:** `HOW_WE_WORK.md` order: Starting a session, Working in a chat with the owner, The loop (with the Header and the stop line among the prompt's sections), The output, Writing and running a phase, When a session stops early, Two memories, Where ClaudeDevStudio fits, Why. Rule 5 of Dan's document ("surgical, not wholesale") went to `CONVENTIONS.md` as "Small changes, not rewrites", next to "Change only what was asked".
- **The template ground truth's "Prompt History" section is removed.** It duplicated "Plan" (one row per phase), and it was the template asking phases to keep a log. The Plan table stays, with the intro the prompt asked for ("an index of what each did and where its output is, not a log"). "Known problems" now keeps only open ones (a fixed one is removed; its number isn't reused); "Open questions": a settled one goes to Decisions and is removed. `HOW_WE_WORK.md`'s "Do" step no longer says to update a Prompt history. Nothing in `index.js` or the tests used that section.
- **CDS's own ground truth keeps its "§12 Prompt History"** (the prompt names it: one short row per phase) rather than being renumbered to the new template's layout, so "§7 item 27"-style references elsewhere stay right.
- **What moved, and what stayed (item 4):** moved verbatim: the old "Last updated" chain; all of §2's dated entries and the "Earlier Next (done)" chain; the whole old §4 (its detail, e.g. the 6 KB phase-runner cell, is still accurate as of v1.7.2, and the new §4 points at it); §6's two replaced lines; §7's FIXED/DONE/REMOVED/HANDLED items **1–18, 20, 21, 23, 24, 26, 27, 29, 31, 32, 34**, plus **30** (the v1.6.0 website update: a finished record, none of open/deferred/watch); §8's settled questions; the whole old §9 (the P1–P10 table rows and the pre-P7 way of running phases) and §10 (per-phase test methods); the old §11 as a whole (some rules were shortened); the old §12 rows. Each section of the ground truth that I shortened or reworded has its previous text in the history file. **Kept in §7, with their numbers:** 19, 22, 25, 28, 33, 35 (19, 22 and 35 shortened; their full text is in the history file). §7 opens with one line listing the moved numbers and where they are. A check script compared every non-blank line of the old file with the new file plus the history file: all 366 lines are present except three section headings, which the history file carries in a reworded form ("… as it was through v1.7.2").
- **New current text** (not copied): §2 (one paragraph and one Next), §4's table (v1.7.3) and its three paragraphs, §9 (nothing open; how the producer runs a phase now), §10 (build, tests, the never-do list, deploy, release). Facts in them come from the old text or were checked: Dan's PC has v1.7.2 through the installer (`%LOCALAPPDATA%\ClaudeDevStudio\install.log`, 18:31, read only; the CLI's file version 1.7.2); the 13 memory tools and 17 workbench tools match this session's tool list.
- **Nothing was a real question** under the prompt's rules; no `QUESTION:` was needed.

## 1. Load points at the rules

`cds-context.js`: `methodFiles(projectPath)` finds each of `CONVENTIONS.md`, `HOW_WE_WORK.md` in `docs\` or the root and returns the rules line (or none) and the missing names; `groundTruthSection` returns `rules` beside `note`; `buildContext` adds it as a one-line section `method_rules` right after the ground truth (and after the no-ground-truth block when there is none). Not in the trim list, so never cut. The existing note for missing files is unchanged.

**The line as printed** (smoke, a throwaway project with both files in `docs\`):
```
Rules: read docs\CONVENTIONS.md and docs\HOW_WE_WORK.md before changing anything (how this project works).
```
With only `CONVENTIONS.md` at the root:
```
Rules: read CONVENTIONS.md before changing anything (how this project works).
(No docs\HOW_WE_WORK.md: claudedev_scaffold can add it; it never overwrites. Offer it; don't just do it.)
```

**The SessionStart hook** (`node mcp-server\cds-hook.js session-start`, run by hand on a throwaway project in `%TEMP%` with both files, a throwaway `CDS_MEMORY_ROOT`, the new CLI; both folders removed afterwards):
```
=== ClaudeDevStudio: cds_p12_hookproj ===
Memory folder: C:\Users\...\AppData\Local\Temp\cds_p12_hookroot\Projects\cds_p12_hookproj
New project: memory was created just now. Record activities and mistakes as you work.

--- Ground truth: docs\GROUND_TRUTH.md ---
# Hook demo — Ground Truth
*Last updated: 2026-11-12*
## 2. Status
Demo.

**Next:** nothing.
Rules: read docs\CONVENTIONS.md and docs\HOW_WE_WORK.md before changing anything (how this project works).

(No recorded activity yet.)
(Loaded at session start by the ClaudeDevStudio hook; claudedev_load would show the same.)
```

## 2. The templates

**`HOW_WE_WORK.md`**, sections added or changed (from Dan's document, rewritten in CDS's style):
- *Starting a session* (new): Claude Code loads by itself; Claude Desktop: say `Load CDS for <project folder>` first, or put that one line in the Desktop project's instructions (it replaces a pasted copy of the rules); then read the ground truth.
- *Working in a chat with the owner* (new): proceed when the task is clear; stop for problems, not routine steps; ask, don't assume ("I think you want X, but you might mean Y: which?"); one question at a time, then wait, no answers for hypothetical answers; one example, then ask; no unsolicited features ("Would you like me to also handle X?"); say at once what you don't know; exception: data loss or a critical bug. Then: a phase is different (whole scope, asks only with a `QUESTION:` block).
- *The loop:* the prompt's sections now start with the **Header** (`# <Project> — Pn (Claude Code Prompt)` and a one-line description) and end with the **stop line** `=== Pn COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===`; "Read first" says what to find in each file, and the phase stops only if something is missing or doesn't match. "Do" updates the ground truth to the new current state (no Prompt history). "Check" reads the output, not what it expected.
- *The output* (new): owner's steps first; date and files changed; build or test result; each change against the prompt with evidence; deviations (what, why, who agreed); decisions; limitations accepted; runtime tests or "not tested" plainly; what wasn't done; that the ground truth was updated.
- *When a session stops early* (new): load; `claudedev_phase_status` for a phase; read the ground truth, the prompt and every touched file as it is now; check the build; tell the owner what was and wasn't done and the build state; wait for the owner's choice.
- *Two memories* (new): project facts to CDS (`claudedev_record_decision`, `claudedev_record_mistake`, `claudedev_handoff`); the owner's preferences to the chat's memory; both sparse, nothing a file already says.
- Kept as they were: writing and running a phase (foreground, `QUESTION:` block, the three modes and the five steps), where CDS fits (it now says load points at the rules), why.

**`CONVENTIONS.md`:** the backup rule says why ("set after weeks of work were lost to edits that couldn't be undone") and that it has no exceptions; files change between sessions, so read the current one; "Small changes, not rewrites"; a new section *One task at a time*: build or verify after every task (a task is not done until its check passes), finish one before the next. The project-specific section's hint now mentions "the build command and how to run it (for example "kill the app first")"; no project's own rule was added.

**`GROUND_TRUTH.md`:** the rule at the top (current state, not a log; replace, don't append; the history lives in CDS's memory, the `Pn_OUTPUT.md` files and git). Status: one paragraph rewritten each time, ending with **Next:** (the scaffold's first Next line is unchanged, so its message and the tests still match). Architecture "as it is now"; Decisions keep only the one in force; Open questions and Known problems keep only open ones; Plan: "an index, not a log". Prompt History removed (see Decisions).

All three keep `{{PROJECT}}`, `{{DATE}}` and (ground truth) `{{SUMMARY}}`; nothing of Dan's origin story or his "paste these into project instructions" section was copied. Dan's document stayed where it is, read only.

**README:** a "Using CDS in a Claude Desktop project" paragraph (add `Load CDS for <project folder>`; the rules come from `docs\HOW_WE_WORK.md` and `docs\CONVENTIONS.md`, which `claudedev_scaffold` adds; no need to paste them). Also updated where it was no longer true: "status (dated lines, newest last …)" → one current paragraph, not a log; "What load shows" mentions the rules line; the scaffold's description lists what the templates now cover.

## 3. CDS's own ground truth

Backed up first: `docs\GROUND_TRUTH.md.bak_20261112_1904`. Built by a script from the backup: the sections kept verbatim were copied by line number, the new text written beside them, then a few rows and rules shortened by hand with each previous line copied into the history file. The history file (`docs\history\GROUND_TRUTH_history.md`): a header (what it is, 2026-11-12, verbatim, nothing deleted, the old whole file in git at `9570223`), then the moved text under its old headings in the old order, §7 items with their numbers.

| Section | Before | After |
|---|---|---|
| Last updated | a 2,127-character chain of "Earlier: (…)" | one line |
| §2 Status | 27 dated entries + a 2,250-character Next with five "Earlier Next (done)" | one paragraph + one Next |
| §3 Locations | 20 rows | 20 rows; "from v1.x" notes dropped, eight rows shortened or brought up to date |
| §4 Architecture | 24 KB (as of 2026-11-11, grown per phase) | 8.4 KB, v1.7.3; the "load shows" paragraph includes the rules line |
| §5 Decisions (Dan) | — | unchanged |
| §6 Decisions (Claude) | 10 | 10: the struck-through monitor line moved; the `check_mistake` line said the CLI's check was whole-sentence (fixed in P1): replaced; one P12 decision added |
| §7 Known problems | 35 items, mostly FIXED | 6 (19, 22, 25, 28, 33, 35) + the line naming the 29 moved |
| §8 Open questions | None + 6 struck-through | None |
| §9 Plan | D1/D2/P1–P10/W rows, two run recipes | nothing open; how the producer runs a phase now |
| §10 Build | 15 paragraphs, one per phase | build, tests, never-do, deploy, release |
| §11 Rules | 34 | 35 (one new, P12); 7 shortened, 2 pointing at the history file for items 20 and 26 |
| §12 Prompt history | 12 long rows | 14 one-line rows (the producer's v1.3.0 work and v1.7.2 as "—" rows) |
| **Size** | **147,818 bytes, 366 lines** | **40,956 bytes, 220 lines (27.7%)** |

**`claudedev_load` for this project, before and after** (the ground-truth part; built read-only with `buildContext` and an empty CLI result, so nothing was written to Dan's store; the rest of load is unchanged). The whole load: 7,883 → 7,360 characters.

Before:
```
--- Ground truth: docs\GROUND_TRUTH.md ---
# ClaudeDevStudio — Ground Truth
*Last updated: 2026-11-12 (P11 done: text reads right wherever it goes (the CLI writes UTF-8 to pipes, UTF-16 to consoles, ASCII marks; every reader names UTF-8; `install.log` UTF-8 throughout, each program writing its own lines), one "Claude Code" label in the installer log, no build paths in the b...
## 2. Status (the last lines)
[... earlier lines: docs\GROUND_TRUTH.md, line 19]
**Next:** Dan installs v1.7.2 and uploads the website. Earlier Next (done): Dan installs v1.7.1 (then Export memory… should read "OK: Exported …"), keeps an export off the PC, and uploads the website. Nothing else open in the plan; … [2,250 characters of earlier Next lines] … **publishes v1.6.0** (the EXE `A05B76B4…7AF2`, `docs\releases\RELEASE_NOTES_v1.6.0.md`); then **W** (section 9).
(No docs\CONVENTIONS.md or docs\HOW_WE_WORK.md: claudedev_scaffold can add them; it never overwrites. Offer it; don't just do it.)
```
(Before, Status was cut: the last 2,500 characters held only the Next chain, so not one status entry was visible.)

After:
```
--- Ground truth: docs\GROUND_TRUTH.md ---
# ClaudeDevStudio — Ground Truth
*Last updated: 2026-11-12 (P12: back to current state; v1.7.3 built, not published)*
## 2. Status
**Released:** v1.7.2 (2026-11-12, GitHub release `v1.7.2`, commit `a28dc21`): project memory (…), the workbench (…), Claude Code hooks set up by default …, whole-store backups … the tray app and the Dashboard (Phases and Backups pages). **Installed:** Dan's PC v1.7.2 through the installer (`install.log` 2026-11-12 18:31); machine 3 v1.7.2. **Website:** … Dan uploads it. **P12 done** (`docs\P12_OUTPUT.md`): … **v1.7.3** built (installer SHA-256 `F6ECD3F4…08C0`), not published. **Open:** only §7 item 35 …

**Next:** the producer reviews `docs\P12_OUTPUT.md`, tests v1.7.3 on machine 3 and publishes it (the EXE `F6ECD3F4…08C0`, `docs\releases\RELEASE_NOTES_v1.7.3.md`); Dan installs it and uploads the website.
(No docs\CONVENTIONS.md or docs\HOW_WE_WORK.md: claudedev_scaffold can add them; it never overwrites. Offer it; don't just do it.)
```
(Abridged here with "…"; load prints the paragraph whole.) Status is now shown whole (no "(the last lines)"), the Next line is found, Open Questions "None." is still skipped. CDS's own repo has no `CONVENTIONS.md`/`HOW_WE_WORK.md`, so it shows the note, not the rules line (adding them was not in scope).

## 4. Version, notes

1.7.3 in the seven files above; `check-versions.ps1` all 15 OK including `bin\Release\net8.0\claudedev.exe version` (it first said 1.7.2: see §6). `docs\releases\RELEASE_NOTES_v1.7.3.md`: load points at the rules; the templates carry the full method; the Claude Desktop instructions line; upgrading (projects keep their older files).

## 5. Tests

`smoke.mjs --cli Installer\build\CLI\claudedev.exe`: 218/218. The 7 `P12:` checks:
1. both files in `docs\`: exactly one rules line naming both paths, after the Next line, no note;
2. only `CONVENTIONS.md` at the root: the line names `CONVENTIONS.md`, and the note names `docs\HOW_WE_WORK.md`;
3. neither: no rules line, the existing note word for word;
4. the scaffold creates all three files, every placeholder filled (project, date, summary);
5. the new templates carry each part (21 phrases in HOW_WE_WORK, 5 in CONVENTIONS, 5 in GROUND_TRUTH; no "Prompt History", no "Dated lines");
6. load of the scaffolded project shows its Status, its Next and the rules line;
7. the SessionStart hook's output for the both-files project starts with the header and has the same rules line (needs `--cli`, for the throwaway root).

The existing P3 check "load with a scaffolded ground truth …" still passes with the new template.

## 6. Mistakes in this phase

- `build-setup.ps1` stopped at the version check: `bin\Release\net8.0\claudedev.exe` was the 1.7.2 build (`build-setup.ps1` publishes elsewhere and doesn't rebuild that one). Fixed with `dotnet build ClaudeDevStudio.csproj -c Release`, then the build passed. Added to §11.
- My first `P12:` template check read the three files in the wrong order (`THREE` is GROUND_TRUTH, CONVENTIONS, HOW_WE_WORK) and failed; fixed in the test, not the templates.
- A `sed` edit with backslashes in Git Bash silently didn't apply (the known §11 rule); caught on re-reading and done with the Edit tool.

Not recorded in CDS's memory: the prompt keeps Dan's store read only.

## 7. Projects with older template copies (read only)

No folder under `D:\Projects` has a `HOW_WE_WORK.md` (in `docs\` or the root, three levels searched). Four have a `docs\CONVENTIONS.md` of their own, not the scaffold's (their first lines: "Abacus — Coding Conventions", "Argus — Coding Conventions", "Lazarus IT Toolkit — Binding Conventions", "SynapseBridge — Binding Conventions"): `D:\Projects\Abacus Data Management`, `D:\Projects\Argus`, `D:\Projects\Lazarus`, `D:\Projects\SynapseBridge`. From v1.7.3 their load shows `Rules: read docs\CONVENTIONS.md …` and the note offering `docs\HOW_WE_WORK.md`. Nothing there was changed.

## 8. Dan's store and machine

Dan's store, settings, Claude Desktop config, installed copy, keys and other projects: read only (the installed copy's version and `install.log` read; the projects listed). Every test used throwaway roots and folders in `%TEMP%`, removed afterwards; the store has no `_cds_smoketest_*` or `*p12*` project folder. This session's own Claude Code hooks write to the store as in every session.

## 9. Not done, and why

- No sandbox run (the prompt: the producer tests on machine 3).
- Not deployed, tagged or published (the prompt).
- CDS's own repo has no `docs\HOW_WE_WORK.md`/`CONVENTIONS.md`; not added (not in scope; the scaffold never overwrites, and this repo's method lives in its ground truth and phase prompts).
- The website doesn't mention `Load CDS for <folder>` yet (outside this phase: `D:\websites` is never touched).
