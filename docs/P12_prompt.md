# ClaudeDevStudio — P12 (Claude Code Prompt)
# Close the loop on the method: CDS's templates carry Dan's rules, every load points at them, and CDS's own ground truth goes back to current state; the v1.7.3 build (nothing is published here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, free, MIT and public (`D:\Projects\ClaudeDevStudio`, git `main`). **v1.7.2 is released.** This session was started from Claude Desktop with `claudedev_phase_start` in **collaborative** mode and already has the project's context.

**Headless, collaborative:** nobody watches, but a reply can come. Decide what this prompt's rules decide and write it under "Decisions I made" in `docs\P12_OUTPUT.md`. For a real decision (see "Questions"), end your turn with a `QUESTION:` block (`mcp-server\templates\HOW_WE_WORK.md`, "Asking a question"). **Long steps in the foreground.** **Only end your turn after the push, or with a `QUESTION:`.**

---

## Read first

- `D:\Backups\ClaudeDevStudio\P12_source_Claude_Coding_Partnership_2026-09-29.md`: **Dan's method document** (outside the repository on purpose: it is his; don't copy it into the repo whole, take what item 2 says).
- `mcp-server\templates\HOW_WE_WORK.md`, `CONVENTIONS.md`, `GROUND_TRUTH.md`: what new projects get from `claudedev_scaffold`.
- `mcp-server\cds-context.js`: what `claudedev_load` and the Claude Code SessionStart hook print (the "rest of the method, if missing" note near the end of the ground-truth part; `NO_GROUND_TRUTH`); and how it reads a ground truth (Status, Next, open questions), so item 4 keeps what it parses.
- `mcp-server\test\smoke.mjs` (211 checks with `--cli`).
- `docs\GROUND_TRUTH.md` (147 KB, 365 lines).

## Why

Dan has pasted his method document into each new project's instructions. From now on he won't: new projects get CDS, so **CDS's templates become the one home of the method**. Three gaps stop that from working today:

1. **Nothing points a session at the rules.** When `docs\HOW_WE_WORK.md` and `docs\CONVENTIONS.md` exist, `claudedev_load` (and the SessionStart hook) never says to read them. Phases get them through their prompt; an ordinary chat or Claude Code session may work without ever opening them.
2. **The templates lack parts of Dan's document** that still apply.
3. **CDS's own ground truth breaks the ground-truth rule** ("not a log; old facts get replaced"): §2 Status is 27 dated entries and a "Next" that grew into a chain of "Earlier Next (done)…"; §7 keeps 30-odd fixed items in full. The history belongs in CDS's memory, the output files and git. The template itself asks phases to update a "Prompt history".

## The work

1. **Load points at the rules.** When a project has `HOW_WE_WORK.md` and/or `CONVENTIONS.md` (in `docs\` or the root, as the existing `has()` looks), `claudedev_load` and the SessionStart hook print **one line** naming them, saying to read them before changing anything (the exact paths that exist). Keep the existing note for missing files. One line only: load is kept short on purpose.

2. **The templates carry the rest of Dan's method.** Rewrite in CDS's plain style (short, no shouting, Windows paths) and fold in what applies, from Dan's document:
   - **`HOW_WE_WORK.md`:**
     - *Working in a chat with the owner* (a new short section): proceed when the task is clear, don't ask permission for steps the task defined; stop for problems and ambiguities, not routine steps; ask, don't assume ("I think you want X, but you might mean Y: which?"); **one question at a time**, then wait, no answers for hypothetical answers; for a change across several files, **one complete example, then ask** before doing the rest; no unsolicited features ("Would you like me to also handle X?"); say at once what you don't know. Exception: data loss or a critical bug, act, explain after. Say that a **phase** is different: it does its whole defined scope and asks only with a `QUESTION:` block.
     - *The prompt:* add a **Header** (`# <Project> — Pn (Claude Code Prompt)` and a one-line description) and the **stop line** as the prompt's last line: `=== Pn COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===`; "Read first" says what to find in each file, and the phase stops only if something there is missing or doesn't match.
     - *The output:* the checklist: date and files changed; build result (errors, warnings) or test result; each change against the prompt; deviations (what, why, who agreed); limitations accepted; runtime tests, or "not tested" said plainly; that the ground truth was updated.
     - *When a session stops early* (context limit, crash, a stopped phase): load the project; read the ground truth, the prompt, and every file it touched as it is now; check the build; tell the owner what was done, what wasn't, and the build state; wait for the owner to choose (continue, or a new prompt for the rest). For a phase, `claudedev_phase_status` shows where it stopped.
     - *Two memories:* project facts (decisions and why, mistakes and lessons, where work stopped) go to CDS (`claudedev_record_decision`, `claudedev_record_mistake`, `claudedev_handoff`); the owner's own preferences go to the chat's memory. Keep both sparse: nothing that a file already says.
     - *Starting a session:* in Claude Code, CDS loads by itself; in Claude Desktop, say `Load CDS for <project folder>` first (or put that line in the Desktop project's instructions; that line replaces any pasted copy of these rules).
   - **`CONVENTIONS.md`:** the backup rule says why ("established after losing weeks of work") and that it has no exceptions; "build or verify after every task: not done until it passes"; one task at a time. Don't add project-specific rules (Dan's "Build Debug, kill the app first" belongs in a project's own section).
   - **`GROUND_TRUTH.md` (template):** state the rule at the top: *current state, not a log; replace old facts, don't append; the history lives in CDS's memory, the `Pn_OUTPUT.md` files and git*. The phases table stays (one short row per phase is an index, not a log); its intro says so.
   - Keep `{{PROJECT}}`/`{{DATE}}` placeholders and everything `claudedev_scaffold` relies on. Don't copy Dan's origin story or his "paste these into project instructions" section (that is what this phase replaces).

3. **README:** a short "Using CDS in a Claude Desktop project" note: add `Load CDS for <folder>` to the project's instructions; the rules come from the project's `docs\HOW_WE_WORK.md` and `docs\CONVENTIONS.md` (`claudedev_scaffold` adds them).

4. **CDS's own `docs\GROUND_TRUTH.md` back to current state.**
   - Move, **verbatim**, everything that only records how we got here into `docs\history\GROUND_TRUTH_history.md` (new file: a short header saying what it is and the date; the moved text under the headings it had). Nothing is deleted from the project: it is moved.
   - **§2 Status:** one current paragraph (what is released, what is installed where, what's in progress) and one **Next** (no "Earlier Next (done)" chain). The dated entries move.
   - **§7:** items that are FIXED/DONE/REMOVED/HANDLED move (keep their numbers in the history file); §7 keeps the open, deferred and "seen, watch for it" items **with their numbers** (other files cite "§7 item 27" and such), plus one line listing the moved numbers and where they are.
   - **§4 Architecture, §6, §10, §11, §12:** replace facts that are no longer true; move superseded detail. §11 (rules that bite) stays as rules; §12 one short row per phase.
   - Whatever `cds-context.js` parses (Status, Next, open questions) still parses: compare `claudedev_load`'s output for this project before and after and show both in the output.
   - Aim for well under a third of today's size; give the final size. Back the file up first.

5. **Version 1.7.3**, `docs\releases\RELEASE_NOTES_v1.7.3.md` (short: load points at the rules; the templates carry the full method). `tools\check-versions.ps1` all OK (the built CLI too).

## Verification

- `smoke.mjs --cli` all pass, plus new `P12:` checks: load on a throwaway project **with** both files prints the one rules line (with the right paths), **with one** prints the line for it and the note for the other, **with none** prints only the existing note; the scaffold still creates all three files from the new templates, with placeholders filled.
- The SessionStart hook's output for a throwaway project with both files shows the rules line.
- `claudedev_load` on this project before/after item 4 (both in the output; Status and Next read correctly).
- `Installer\build-setup.ps1` builds (it stages the templates and runs the version and build-path checks): 0 errors, no new warnings (CLI 24, TrayApp 14, Dashboard 0, VSIX 12); give the SHA-256. **No sandbox run** (Dan's call for small releases: the producer tests on machine 3).
- Read-only, for the output: which folders under `D:\Projects` have a `docs\HOW_WE_WORK.md` (scaffold never overwrites, so those keep their older copy). List them; change nothing there.

## Questions

Decide by yourself (and write it down): wording, placement and section order in the templates; which ground-truth text is history and which is current state, when the rule above settles it; the history file's layout. **Ask with a `QUESTION:`** only if: a part of Dan's document seems to conflict with how CDS works and the conflict changes behaviour (not wording); or keeping something in the ground truth vs. moving it is genuinely unclear **and** matters to the next session.

## Rules

- Never touched on this PC: Dan's `~/.claude/settings.json`, `~/.claude.json`, `%APPDATA%\Claude\claude_desktop_config.json`, the installed copy, any `qwen_config.json`, Dan's other projects (read-only listing above only), `D:\websites`, `D:\Backups\ClaudeDevStudio\P12_source_*.md` (read only). **Dan's memory store is read only** (tests on throwaway roots). Back up tracked files before editing (`.bak_YYYYMMDD_HHMM`, ignored by git). No bypass flags. No PC-specific paths in shipped files. **Don't deploy, tag or release.**

## On completion

1. **`docs\P12_OUTPUT.md`**, per the checklist this phase adds: first what the producer must do (test v1.7.3 on machine 3, publish: SHA-256, notes). Then each item with evidence (the new load line as printed; template sections added; before/after sizes and load output for the ground truth), decisions, the list of projects with older template copies, anything not done.
2. **`docs\GROUND_TRUTH.md`:** §2 ("P12 done", **Next**), §11 if a new rule bites, §12 one row.
3. **Commit** `P12: load points at the rules, templates carry the full method, ground truth back to current state, v1.7.3 build`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.** No tag, no release.

=== P12 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
