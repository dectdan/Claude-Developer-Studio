# ClaudeDevStudio — P3 (Claude Code Prompt)
# What Claude sees on walking in: ground truth first, a scaffold when there's none, handoffs and decisions (nothing is released or deployed here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop, from Gain Publications (Dan). It's **free, MIT, and public**; strangers install it.
- **Project:** `D:\Projects\ClaudeDevStudio` (git `main`; `github.com/dectdan/Claude-Developer-Studio`, **public**).
- **Memory server:** `mcp-server\index.js` (the tools Claude calls). **CLI:** root `*.cs` (`claudedev.exe`; it owns the memory files and writes them). **Workbench:** `mcp-server\workbench.js`.

Start with ClaudeDevStudio: `claudedev_load` with `D:\Projects\ClaudeDevStudio`.

**You are running unattended.** Claude (the producer) started this session and nobody can answer questions while it runs. When something isn't covered here, take the safest reading that keeps the rules below, write it under "Decisions I made" in `docs\P3_OUTPUT.md`, and carry on. Stop early only if going on would break a rule; then write the output file and say why.

---

## Why

Ground truth §5 (Dan, 2026-11-11): **CDS teaches the method.** Every project should have a `docs\` folder with a `GROUND_TRUTH.md`, its working conventions, and the `Pn_prompt.md` → `Pn_OUTPUT.md` loop. When Claude walks into a project without them, CDS must say so and offer to create them. CDS is public, so this is how other people's projects get pushed toward ground truths.

Also from §5: **efficiency is the point.** What `load` puts into Claude's context must be short and useful, with state and next steps first.

Today `load` leads with a session line and a flat list of activities and mistakes. It never looks at the project's own `docs\`, which is where the real state lives in projects that use the method. It also offers nothing to projects that don't. Two things Claude most needs when walking back in, where the last session stopped and why things were decided, have no tool.

---

## Read first

1. `docs\GROUND_TRUTH.md`, in full. Pay attention to §4, §5, §6 (don't undo any decision), §7 items 17–18, §9 and §11.
2. `mcp-server\index.js` in full, and `mcp-server\test\smoke.mjs`, `show.mjs`.
3. **The CLI's memory writing:**
   - `ClaudeMemory.cs`: `RecordDecision`, `PrepareHandoff`/`GenerateHandoffDocument`, `NextIdNumber`, `LoadContext`;
   - `MemorySchemas.cs`: `Decision`;
   - `Program.cs`: `RecordData`, the `handoff` command, `ShowHelp`.
4. `mcp-server\workbench.js`: `resolveVsBridgeDir`.
5. **As examples of the method, read-only.** Never edit these projects, and never copy their specifics into CDS:
   - this repo's `docs\GROUND_TRUTH.md`, `docs\P2_prompt.md`, `docs\P2_OUTPUT.md`;
   - `D:\Projects\SongSpark\docs\GROUND_TRUTH.md`, `docs\P8_prompt.md`, `docs\P8_OUTPUT.md`.
6. `Installer\build-setup.ps1` and `Installer\setup.nsi` (which `mcp-server` files are staged and installed), `deploy.ps1`, `README.md`, `CONTRIBUTING.md`.

---

## Scope

- **Modified:**
  - `mcp-server\index.js`, `mcp-server\workbench.js`;
  - `ClaudeMemory.cs`, `MemorySchemas.cs`, `Program.cs`;
  - `mcp-server\test\smoke.mjs`, `mcp-server\test\show.mjs`;
  - `Installer\build-setup.ps1`, `Installer\setup.nsi` and `deploy.ps1`, only so new `mcp-server` files ship;
  - `README.md` (one short section), `CONTRIBUTING.md` (rewrite), `docs\GROUND_TRUTH.md`.
- **New:**
  - `mcp-server\templates\GROUND_TRUTH.md`, `CONVENTIONS.md`, `HOW_WE_WORK.md`;
  - a shared paths module if you make one (for example, `mcp-server\cds-paths.js`);
  - `docs\P3_OUTPUT.md`.
- **Never touched:**
  - the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`;
  - Dan's Claude Desktop config;
  - any `qwen_config.json`;
  - other projects' files.

---

## Conventions

- Back up any tracked file before editing it (`.bak_YYYYMMDD_HHMM`). Confirm each edit's anchor text before replacing.
- **The CLI owns the memory format and does every write** (§6). `index.js` reads files to build context and calls the CLI to write.
- **Dan's memory store:** write only through `smoke.mjs`'s throwaway projects. **One exception:** `show.mjs claudedev_load` on the four real projects in Verification. Every load updates that project's `session_state.json`, and that's allowed. Nothing else.
- **Never open, copy or print a `qwen_config.json`.** Exclude it from every search. P2 printed a line of one by accident.
- **Templates are for strangers:** no Dan, no Gain Publications, no paths from this PC, no project names from Dan's other work.
- **Tool descriptions:** one line each (§11: Claude Desktop rejects oversized tool lists silently). Report the size of the memory server's `tools/list` JSON before and after.
- Builds: 0 errors, no new warnings.
- **Don't deploy, tag or release.**

---

## The work

### 1. `load` leads with the project's own state

**Find the ground truth.** Look for these, in order, and use the first:
- `docs\GROUND_TRUTH.md`;
- any `docs\*GROUND*TRUTH*.md` (some projects use names like `NAME - GROUND TRUTH (READ FIRST).md`);
- `GROUND_TRUTH.md` at the project root.

**The new order of `load`'s output:**
1. The header: project and memory folder.
2. **The last handoff** (item 3), with its age ("2 days ago").
3. **The ground truth.** Show:
   - its path, its title, and its "Last updated" line if there is one;
   - its **Status** section: find the heading whose text contains "Status", at any level, numbered or not. Status logs grow downward, so show its **last** lines, about 2,500 characters at most, plus any `**Next:**` line in it;
   - its **Open Questions** section, if it has real content (not "None"), capped;
   - if no Status heading exists, the first ~1,500 characters.
4. **The newest `docs\P*_OUTPUT.md`** (by modified time): its title, its first section (usually the owner's steps) capped at about 1,500 characters, then a one-line list of its other `##` headings, so Claude knows what to open.
5. **The memory:**
   - mistakes: the newest 10, with the total count;
   - decisions: the newest 5 (item 4);
   - patterns: the top 5;
   - recent activity: the newest 8, with the total.
6. **No ground truth found:** a short, plain block. Say:
   - that the project has no `docs\GROUND_TRUTH.md`;
   - in two lines, why one helps: one place for status, decisions and next steps, so any session can pick up where the last one stopped, with fewer tokens spent re-explaining;
   - that Claude should **offer** `claudedev_scaffold` to the user, and create it only if the user agrees (it's their repo).

   If a ground truth exists but `CONVENTIONS.md` or `HOW_WE_WORK.md` doesn't, a one-line note is enough.

**A size budget:**
- `load`'s whole output aims at 8,000 characters or less, with a hard cap of 12,000. Trim the lowest sections first (activity, then patterns), never the handoff or the Status.
- Each truncation ends with a one-line pointer to the full file.
- Measure and report the size for every project in Verification.

### 2. `claudedev_scaffold`

- **Input:** `project_path`, an optional `title` (default: the folder name), an optional `summary` (one paragraph).
- **What it does:**
  - creates `docs\` if needed;
  - writes `GROUND_TRUTH.md`, `CONVENTIONS.md` and `HOW_WE_WORK.md` from `mcp-server\templates\`, filling in `{{PROJECT}}`, `{{DATE}}` and `{{SUMMARY}}`;
  - **never overwrites** an existing file;
  - returns what it created and what it skipped, and the next step: "fill in sections 1–3 with the user".
- **It's a file write in the user's project, not memory,** so `index.js` may write these files itself. Back nothing up; it never overwrites.
- **The templates** are short, generic and useful on day one. Derive them from the example projects (Read first, item 5), keeping the method and dropping their specifics:
  - **`GROUND_TRUTH.md`:**
    - "read this first" at the top, and "Last updated";
    - What this is; Status (dated lines, newest last, a `**Next:**` line); Locations; Architecture; Decisions (the owner's, dated, with the reason); Open questions; Known problems (worst first); Plan (a phase table); Build, test, release; Rules that bite; Prompt history;
    - each section with one line in italics saying what goes there.
  - **`CONVENTIONS.md`:** how code gets written here:
    - read the current file before editing; back up before editing; change only what's asked;
    - verify (build 0 errors, tests pass) before saying done; report what wasn't done;
    - no secrets in the repo; ask the owner before anything that can't be undone;
    - a blank "Project-specific rules" section.
  - **`HOW_WE_WORK.md`:** the loop.
    - A planning session writes `docs\Pn_prompt.md` with these sections: Identity, Why, Read first, Scope, Conventions, The work, Verification, On completion.
    - Claude Code carries it out, writes `docs\Pn_OUTPUT.md` (the owner's steps first, results with evidence, decisions made, not done) and updates the ground truth.
    - The planner verifies it, then writes the next prompt.
    - Then how the CDS tools fit in: load at the start; record activities, mistakes and decisions; a handoff before stopping.
    - Then why: continuity across sessions, honesty about what was verified, and fewer tokens.

### 3. `claudedev_handoff`

- **Input:** `project_path`, `where_i_stopped`, `next_step`, `open_questions` (optional list), `notes` (optional).
- **Written by the CLI:**
  - a new `record <path> handoff <json>` writes `session_handoff.md` (the latest, rendered as short markdown with the date);
  - it also appends to `HANDOFFS.jsonl` (the history).
- **The CLI already has a `handoff` command** and an automatic `PrepareHandoff` that write `session_handoff.md` from the session state. **Reconcile them:**
  - one file, one format;
  - an explicit handoff from this tool is never overwritten by the automatic one;
  - say what you did.
- **`load` shows the latest handoff first** (item 1).

### 4. `claudedev_record_decision`

- **Input:** `project_path`, `decision`, `why`, `alternatives` (optional list), `file` (optional).
- **It calls the existing `record <path> decision <json>`,** mapping `why` to `reasoning`, `decision` to `decision` and `chose`, and `alternatives` to `alternatives_considered`.
- **IDs** come from `NextIdNumber` (`DEC###`).
- **`load` shows the newest 5** with their reasons.

### 5. The server's instructions

Rewrite the `instructions` text so it explains the method in a few sentences:
- load at the start of work on a project;
- if it has no ground truth, offer the scaffold;
- check a risky step with `claudedev_check_mistake`;
- record activities, mistakes and decisions as you go;
- write a handoff before you stop.

Keep it short; it's sent with every session.

### 6. The VS Bridge folder asks Windows (§7 item 17)

`workbench.js` must find Documents exactly as `index.js` does (`[Environment]::GetFolderPath('MyDocuments')`, asked once). If you move that lookup into a shared module, make sure the installer stages and installs it, and that `deploy.ps1` copies it.

### 7. Ship the new files

- The installer and `deploy.ps1` include `mcp-server\templates\*` and any new module.
- Confirm by running `build-setup.ps1` as far as staging, or all the way. Check that the staged `mcp-server` folder has them. **You don't need a sandbox run;** P4 does the release build.

### 8. Docs

- **`README.md`:** a short "Working with ground truths" section: what `load` shows, what the scaffold creates, and the loop in three lines.
- **`CONTRIBUTING.md`:** rewrite it in the README's plain style. Cover:
  - the current folder layout;
  - how to build (`Installer\build-setup.ps1`);
  - how to test (`smoke.mjs`, the sandbox kit);
  - the method this repo uses (`docs\GROUND_TRUTH.md`, phased prompts);
  - what a pull request should include.

### 9. Tests

**Extend `smoke.mjs`,** in throwaway projects:
- **scaffold:** it creates the three files; a second call skips all three; nothing outside `docs\` is touched;
- **load with a scaffolded ground truth:** it shows the Status section before the memory sections;
- **load with a hand-made ground truth** that uses a numbered heading like `## 2. Status` and a `**Next:**` line: it shows the last Status lines and the Next line;
- **load with no ground truth:** it shows the offer;
- **handoff:** it's written, then shown first by the next load, with its age;
- **decision:** it's recorded with a `DEC###` ID, and shown with its reason;
- **the budget:** a project with 500 activities, 100 mistakes and a 40 KB ground truth gives a load of 12,000 characters or less, with the handoff and the Status still present;
- **the tools list:** it has 11 tools.

**Update `show.mjs`** so it can run `claudedev_load` read-only on a real project (it already can) and print the output's length.

---

## Verification

- CLI build: 0 errors, no new warnings.
- `node --check` on both servers.
- **Smoke tests:**
  - `smoke.mjs --cli bin\Release\net8.0\claudedev.exe`: every check passes (24 old + the new ones);
  - `smoke.mjs` (the installed CLI): the original 16 still pass, and checks that need the new CLI are skipped and named.
- **Real projects** (read-only, `show.mjs claudedev_load`):
  - `D:\Projects\ClaudeDevStudio`, `D:\Projects\SongSpark`, `D:\Projects\Argus` (its ground truth has a different file name), and `D:\Projects\CQAutoparts` (no `docs\`);
  - for each, the output's length, and that it leads with the right things;
  - paste the first ~40 lines of SongSpark's output into the output file.
- **The `tools/list` JSON size,** before and after.
- **Templates:** a search for Dan, Gain, `D:\`, `C:\Users` and project names finds nothing.
- **The staged installer folder** contains the templates and any new module.

---

## On completion

1. **Write `docs\P3_OUTPUT.md`.** Put first anything Dan or the producer must do (the producer deploys the new memory server to Dan's PC; P4 releases). Then:
   - "Decisions I made";
   - each item with evidence;
   - the real-project sizes;
   - the SongSpark sample;
   - anything not done, and why.
2. **Update `docs\GROUND_TRUTH.md`:**
   - **§2:** a "P3 done" line;
   - **§4:** the new tools, the templates, and what `load` shows;
   - **§7:** item 17 fixed;
   - **§9:** P3 ✓, next P4;
   - **§12:** a P3 row;
   - "Last updated".
3. **Commit** with the message `P3: load leads with the project's ground truth, scaffold for projects without one, handoffs and decisions, load size budget; workbench finds Documents like index.js`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.**

=== P3 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
