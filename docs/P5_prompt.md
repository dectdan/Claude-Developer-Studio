# ClaudeDevStudio — P5 (Claude Code Prompt)
# Search across all projects' memory, and lessons that apply to every project (in source; nothing is deployed or released here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop and Claude Code, from Gain Publications (Dan). It's **free, MIT, and public**; strangers install it.
- **Project:** `D:\Projects\ClaudeDevStudio` (git `main`; `github.com/dectdan/Claude-Developer-Studio`, **public**). v1.4.0 is released and installed on Dan's PC.
- **Memory server:** `mcp-server\index.js` (+ `cds-context.js`, `cds-paths.js`, `cds-hook.js`, `templates\`). **CLI:** root `*.cs` (`claudedev.exe`, owns the memory files and does every memory write).

**This session already has the project's context:** CDS's Claude Code hook is on for Dan, so the SessionStart hook loaded it. You don't need to call `claudedev_load` (calling it again is harmless). The hooks will also note the files you edit and write an automatic handoff when you finish, in ClaudeDevStudio's memory. That is expected and is the only memory write outside the smoke test's throwaway projects that this phase makes.

**You are running unattended.** Claude (the producer) started this session and nobody can answer questions while it runs. When something isn't covered here, take the safest reading that keeps the rules below, write it under "Decisions I made" in `docs\P5_OUTPUT.md`, and carry on. Stop early only if going on would break a rule; then write the output file and say why.

---

## Why

Each project's memory is an island. A lesson learned in one project (say, "Documents may be redirected to OneDrive", or "PowerShell files written by tools get curly quotes") has to be learned again in the next one. And when Claude half-remembers something ("we fixed a path bug like this somewhere"), it has no way to find it: `load` shows only the newest few entries of one project.

P5 adds two things:
1. **`claudedev_search`:** find past mistakes, decisions, patterns, handoffs and activity by words, in one project or all of them.
2. **Lessons for every project:** a small machine-wide list of lessons that `load` (and so the session-start hook) shows in every project, and that `check_mistake` checks.

Efficiency is the point (ground truth §5). Search output and the lessons section must be short, with pointers to the full files instead of dumps.

---

## Read first

1. `docs\GROUND_TRUTH.md`, in full. Pay attention to §4 (what `load` shows, the budget), §5, §6 (the CLI owns the format and the writes), §9, §10, §11.
2. `docs\P3_OUTPUT.md` and `docs\P4_OUTPUT.md` (how `load` and the hook are built; their decisions).
3. `mcp-server\index.js`, `mcp-server\cds-context.js` (`buildContext`, the readers, the budget, the legacy store), `mcp-server\cds-hook.js`, the CLI's record/load code and `MemorySchemas.cs` (`MistakeMatching`), `mcp-server\test\smoke.mjs`, `mcp-server\test\show.mjs`.
4. **The real memory store, read-only:** `[Environment]::GetFolderPath('MyDocuments')\ClaudeDevStudio` (on this PC it's under OneDrive): 58 project folders, ~970 files, ~4.5 MB; also the old v1.2.x store that `load` reads (§3). Look at what's actually in the files (field names, how many entries, how long they are, what's noise) before designing ranking. There is a `chat_mirror.jsonl` at the store's root: find out what writes it and say what it is; **don't include it in search** unless it is clearly project memory (it may hold chat text).

---

## Scope

- **Modified:** `mcp-server\index.js` (two tools, the instructions text), `mcp-server\cds-context.js` (the lessons section in `load`), the CLI (writing lessons; `check` reading them), `mcp-server\test\smoke.mjs`, `deploy.ps1` and `Installer\setup.nsi`/`build-setup.ps1` if you add a shipped file or for item 5, `Installer\cds-config.js` and `tools\sandbox-test\*` for item 5, `README.md`, `mcp-server\README.md`, `docs\GROUND_TRUTH.md`.
- **New:** a search module (e.g. `mcp-server\cds-search.js`, your choice), `docs\P5_OUTPUT.md`, `docs\P5_lesson_candidates.md` (below).
- **Never touched on this PC:** Dan's `~/.claude/settings.json`, `~/.claude.json`, `%APPDATA%\Claude\claude_desktop_config.json`; the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`; Dan's memory store, apart from the smoke test's throwaway projects and what the hooks record for this session (above). **No lessons are written to Dan's real store in this phase**; the producer seeds them after review. Any `qwen_config.json`: exclude it from every search, never print it.

---

## Conventions

- Back up any tracked file before editing it (`.bak_YYYYMMDD_HHMM`). Confirm each edit's anchor text before replacing.
- **The CLI owns the memory format and does every memory write** (§6). Reading in Node is fine (`buildContext` does).
- **Read-only means read-only:** search never creates, touches or "repairs" a memory folder or file.
- Builds: 0 errors, no new warnings.
- **The repo is public:** no keys, no personal data, no paths from this PC in shipped files. `docs\P5_lesson_candidates.md` quotes Dan's own memory, so keep it to lesson text and project names, nothing private; if an entry holds anything personal, leave it out.
- **Don't deploy, tag or release. No version bump** (P5 ships in a later release).

---

## The work

### 1. `claudedev_search`

An MCP tool in the memory server (`index.js`), read-only.
- **Input:** `query` (words; required), `project_path` (optional: search only that project; without it, all projects), `kinds` (optional: any of mistakes, decisions, patterns, handoffs, activity; default all), `limit` (optional, default about 15).
- **What it reads:** each project's `MISTAKES.jsonl`, `DECISIONS.jsonl`, `PATTERNS.jsonl`, `HANDOFFS.jsonl`, `Activity\*.jsonl`, and, if present, the lessons file (§2). Also the old store, as `load` does, without showing an entry twice.
- **Matching and ranking:** words, not exact phrases; case-insensitive; the same idea of "words" as the mistake matching (`MistakeMatching` / `keywords()`: stop words out, short words out) so behaviour is consistent; more shared words rank higher, mistakes, decisions and lessons above activity, newer above older on ties. Quoted phrases may be supported if cheap. Say what you chose and why, with an example from the real store.
- **Output:** one compact line per hit: project, date, kind, the text cut to a sensible length (a mistake shows its lesson; a decision its reason), and the file it came from. A first line says how many hits there were in how many projects, and how many are shown. **Budget: about 3,000 characters by default, never over 6,000.** No hits: say so in one line and suggest fewer or other words.
- **Speed:** a scan of the whole store must be fast; measure it on the real store (read-only) and say the number. If it's over ~1 s, find out why before adding any index; an index is a decision to justify in the output, not a default.
- **Activity is the noisy kind** (thousands of `file_edit` lines from the hook from now on). Make sure it can't crowd out mistakes and decisions in the results.

### 2. Lessons for every project

A machine-wide file in the memory store's root (e.g. `[Documents]\ClaudeDevStudio\LESSONS.jsonl`; your choice of name and fields, written by the CLI): a short lesson, why (where it was learned: project and date), and an id.
- **Writing:** a new MCP tool `claudedev_record_lesson` (lesson, why, optional source project) and a CLI command behind it (`record-lesson` or `record <path> lesson`, your choice). The CLI refuses an empty lesson and a near-duplicate of an existing one (same matching rule; say the threshold), telling Claude which existing lesson it matches.
- **Removing or editing** a wrong lesson: a CLI command is enough (no MCP tool needed); say what it is.
- **`load` (and so the session-start hook)** shows a short "Lessons for every project" section in every project: newest or most relevant first, **at most about 1,200 characters**; it fits inside load's existing budget (aim 8,000, cap 12,000) and the hook's 9,500. Put it where §4's order makes sense and add it to the trim order; say where and why.
- **`claudedev_check_mistake` (and the CLI's `check`)** also checks the lessons, with the same rule as for the project's own mistakes, and says when a match is a machine-wide lesson.
- **`claudedev_record_mistake`:** when a new mistake matches mistakes in two or more **other** projects, its reply suggests recording it as a lesson for every project. A suggestion only: nothing is written without Claude calling `claudedev_record_lesson`.
- **The instructions text** (what the server tells Claude at connect) mentions both tools in one or two sentences. Keep `tools/list` small and report its size before and after.

### 3. Candidates from the real store (read-only)

Scan Dan's real store for mistakes that recur across projects (the same matching rule; two or more projects) and write `docs\P5_lesson_candidates.md`: up to 20 candidate lessons, each with a one-line lesson in plain words, the projects and dates it came from, and how many times. Don't write any of them to the store. The producer reviews this list and seeds the real lessons file after the phase.

### 4. Tests

**`smoke.mjs`:** everything from P4 still passes. Add checks against throwaway projects (the same safety as P4: `CLAUDE_PROJECT_DIR` set or removed explicitly; nothing left behind):
- search finds a seeded mistake by two of its words in one project, and across projects; ranks a mistake above an activity line with the same words; respects `kinds`, `limit` and the budget; returns one line for no hits; creates or changes nothing (compare the folders before and after);
- an entry that exists in both the old and the new store is shown once;
- `record_lesson` writes a lesson; a near-duplicate is refused naming the match; an empty one is refused;
- `load` shows the lessons section and stays within budget; the hook's session-start stays ≤ 9,500;
- `check_mistake` finds a matching lesson and says it's machine-wide;
- `record_mistake` suggests a lesson when the same mistake is in two other throwaway projects, and not otherwise.

Lessons tests must not write to the real lessons file: point the CLI and the server at a throwaway memory root for those checks (add a test-only override like `CDS_CLI_PATH`/`CDS_HOOK_LOG` if needed, documented as test-only), or say why that's not possible and what you did instead.

**The real store (read-only):** run search through `show.mjs` (or a read-only equivalent) for three real queries and put the outputs (shortened) and timings in the output: "OneDrive Documents path", "curly quotes PowerShell", "installer config".

**The hooks in this real session:** this is the first phase run with Dan's hooks on. At the end, look at `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log` and ClaudeDevStudio's activity file for today, and report what the post-tool-use hook recorded for your edits (count, a few examples, anything wrong). Report; don't change the installed copy.

### 5. A PC that has never had Claude Desktop (Dan's question, 2026-11-11)

Dan asked: when someone who has never used Claude Desktop installs CDS, does it just configure itself? What's known: `cds-config.js` creates `%APPDATA%\Claude\claude_desktop_config.json` with only CDS's two entries when the folder doesn't exist (`config-merge-test.js` "no folder" checks), but every sandbox run so far seeded a config first, and nobody has checked that a Claude Desktop installed *afterwards* reads that file.
- **Find out from current sources where Claude Desktop for Windows reads its config**, for each way it's installed (the installer from claude.ai/download, and any Microsoft Store / MSIX package). A packaged (MSIX) app may see `%APPDATA%` redirected to `%LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming\`. Cite what you find (URLs, dates); say plainly what you could not confirm. If there is a second location, make `cds-config.js` (install and uninstall, and `configure-claude`) handle it with the same rules, and say how it decides.
- **Sandbox scenario F:** after A–D's runtimes are in place (so it's quick), remove `%APPDATA%\Claude` entirely and install: the folder and file are created with just the two entries, the finish text/log say so sensibly, and the uninstaller then removes them cleanly. Also the order "CDS first, Claude Desktop never installed": the tray app and CLI don't error. Claude Desktop itself can't be installed in the sandbox offline; if you can install it with networking on, do (scenario F networked) and check it starts with CDS's servers listed in its config and doesn't replace the file; if you can't, say why.
- **The finish page and README** tell a first-time user, in one or two lines, what to do if Claude Desktop isn't installed yet (install it, sign in, then quit and reopen it once).
- Run F (and anything you changed in the installer) through the sandbox kit; if the installer changed, also rerun A–E offline. Put the results and the installer's SHA-256 in the output. Bump no version.

---

## Verification

- **Builds:** the CLI: 0 errors, no new warnings (42 before). If you touch the tray app or Dashboard, the same for them.
- **Smoke tests:** `smoke.mjs --cli bin\Release\net8.0\claudedev.exe` passes everything; `smoke.mjs` with the installed CLI passes what it can and names what it skips (the installed CLI is v1.4.0 and has no lessons command).
- **`load` on `D:\Projects\ClaudeDevStudio` and `D:\Projects\SongSpark`** (read-only, `show.mjs`): unchanged in shape apart from the lessons section (with no lessons file yet, say whether the section is absent or one line, and that it's your choice), within budget; say the sizes.
- **Search on the real store:** the three queries, with timings.
- **If you added a shipped file:** `deploy.ps1 -DryRun` lists it and `build-setup.ps1`'s staging includes it (you can run the build to check; a new file alone needs no sandbox run; no release).
- **Item 5:** the sources for where Claude Desktop reads its config; sandbox F (and A–E again if the installer changed) all PASS with `results.json` saved; the installer's SHA-256 is the one the sandbox recorded.
- **No Dan-specific paths** in shipped files (the same search as P2/P4, excluding `qwen_config.json`).

---

## On completion

1. **Write `docs\P5_OUTPUT.md`.** Put first what the producer must do:
   - review; deploy with `deploy.ps1` (what it will copy);
   - seed the lessons file from `docs\P5_lesson_candidates.md` (how: the exact CLI command).

   Then:
   - "Decisions I made";
   - what `chat_mirror.jsonl` is;
   - each item with evidence (search design and the real-store measurements; the lessons file's format; where lessons appear in `load`; `tools/list` size before and after);
   - the smoke results;
   - what the hooks recorded in this session;
   - anything not done, and why.
2. **Update `docs\GROUND_TRUTH.md`:**
   - **§2:** a "P5 done" line, and **Next**;
   - **§3 and §4:** the lessons file, the search module, the two tools, the CLI commands, where lessons appear in `load`;
   - **§9:** P5 ✓, next: the producer deploys and seeds lessons, then P6;
   - **§10:** how to test search and lessons;
   - **§11:** any new rule that bites;
   - **§12:** a P5 row;
   - "Last updated".
3. **Commit** with the message `P5: search across projects' memory, lessons for every project`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.** No tag, no release.

=== P5 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
