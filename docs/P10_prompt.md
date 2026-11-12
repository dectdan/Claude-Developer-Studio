# ClaudeDevStudio — P10 (Claude Code Prompt)
# Backups that run, export and import for moving PCs, sync status, two-PC safety, the old sync commands decided (in source; nothing is published here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop and Claude Code, from Gain Publications (Dan). It's **free, MIT, and public**; strangers install it. **v1.6.0 is released** (P7–P9). This session was started from Claude Desktop with `claudedev_phase_start` and already has the project's context.

**You are running unattended (delegated).** Nobody can answer questions while it runs. When something isn't covered here, take the safest reading that keeps the rules below, write it under "Decisions I made" in `docs\P10_OUTPUT.md`, and carry on.

**Long steps run in the foreground** (builds; the sandbox ~23 minutes: a long enough timeout, or poll in the same turn). Never end your turn to wait for a background task. **Only end your turn after the push.**

---

## Why (Dan, 2026-11-12)

"We need to have the ability to back it up, especially in light of possible catastrophic failure." Moving to a new development PC must work, and someone opening a project's memory from a second PC must not lose data.

What's true today (checked by the producer):
- The memory lives in `[Documents]\ClaudeDevStudio` (CDS asks Windows for Documents). On Windows 11 Documents is usually backed up to OneDrive (Dan's is: `C:\Users\<user>\OneDrive\Documents\ClaudeDevStudio`), so it already syncs, and a new PC signed in to OneDrive gets it. Memory is keyed by the project folder's **name**, so the same project at a different path on another PC finds the same memory.
- **Automatic backups never run** (GROUND_TRUTH §7 item 29): `AutoBackupScheduler.cs` is never instantiated; only `claudedev backup` (one project, a zip in `Backups\<project>\`) creates backups. Dan's newest is 2026-04-04. A synced folder is not a backup: corruption syncs too.
- There's no one-step export/import of the whole store.
- Two PCs writing the same `.jsonl` within OneDrive's sync window can produce a conflict copy (OneDrive renames one, e.g. `MISTAKES-<PCNAME>.jsonl`), which CDS then ignores: lost entries.
- The CLI has `git …` and `cloud …` (Cloudflare) commands nobody has tested in months.
- The whole store is small (Dan's: 1,080 files, 4.6 MB); backups are zips (`ZipFile`, `CompressionLevel.Optimal`).

---

## Read first

1. `docs\GROUND_TRUTH.md` in full (§3 where data lives, §6 the CLI owns the format, §7 items 21, 29, §11).
2. `BackupManager.cs`, `AutoBackupScheduler.cs`, `GitSyncManager.cs`, `CloudSyncManager.cs`, `Program.cs` (backup/restore/backups/sync/git/cloud commands), `MemoryPaths` (in `ClaudeMemory.cs`), the tray app, the Dashboard, `Installer\setup.nsi`, `mcp-server\cds-search.js` / `cds-context.js` (how memory files are read).
3. **Current sources** (cite URLs): how OneDrive names a sync-conflict copy on Windows (the exact pattern, including the PC name and any numbering); how a program can tell whether a folder is inside OneDrive and whether OneDrive is running/signed in (the Known Folder Move registry values, `OneDrive` environment variables, `Get-ItemProperty`-style checks), without OneDrive's API or a sign-in.

## Scope

- **Modified:** the CLI (`BackupManager.cs`, `Program.cs`, the sync/cloud files as decided), `mcp-server\cds-context.js`/`cds-search.js` and the CLI's readers for conflict copies, the tray app, the Dashboard, `Installer\setup.nsi` (a backup before upgrading), tests, version files, `README.md`, `mcp-server\README.md`, `docs\GROUND_TRUTH.md`, `D:\Projects\ClaudeDevStudio\docs\releases\` (new notes).
- **New:** whatever the work needs, named in the output; `docs\P10_OUTPUT.md`.
- **Never touched on this PC:** Dan's `~/.claude/settings.json`, `~/.claude.json`, `%APPDATA%\Claude\claude_desktop_config.json`; the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`; **Dan's memory store `[Documents]\ClaudeDevStudio`: read only** (for measuring: size, a timed compression into `%TEMP%`, a read-only conflict-copy scan); all writes go to throwaway roots (`CDS_MEMORY_ROOT`); any `qwen_config.json`; Dan's other projects; `D:\websites`. Nothing is uploaded anywhere (no real git push, no Cloudflare calls with real accounts).

## Conventions

- Back up any tracked file before editing it (`.bak_YYYYMMDD_HHMM`). Never `--dangerously-skip-permissions` or `bypassPermissions`.
- **The CLI owns the memory format and does every memory write** (§6).
- **Backups and imports never destroy data:** a restore or import first backs up what it would change; an import merges (no entry lost, none duplicated); nothing is deleted except old automatic backups beyond the kept count.
- Builds: 0 errors, no new warnings (CLI 33, TrayApp 14, Dashboard 0, VSIX 12). NSIS 0.
- The repo is public: no keys, no personal data, no paths from this PC in shipped files.
- **Don't deploy, tag or release.** Version: **1.7.0**.

---

## The work

### 1. Automatic backups that run

- **What:** one zip of the **whole store** (all projects, `LESSONS.jsonl`, `phases.json`, `cli_session_state.json`; not `Backups\` itself, not `chat_mirror.jsonl` unless you decide otherwise and say why) in `[Documents]\ClaudeDevStudio\Backups\store\ClaudeDevStudio-store-<yyyymmdd-HHmmss>.zip`, with a small manifest inside (CDS version, time, PC name, file count, a hash per file).
- **When:** at most once a day, triggered from something that already runs (the CLI's `load`/`record` checking the newest backup's age, or the tray app's timer; your choice, say why: it must not slow `load` or a hook noticeably, so do it after the response or in the background); **before every upgrade** (the installer runs it if CDS is already installed); and on demand (`claudedev backup --all`).
- **Keep:** the newest 14 daily plus the newest 4 that were made before an upgrade (or a rule you can justify); older automatic ones are deleted; manual ones are never deleted.
- Decide what happens to `AutoBackupScheduler.cs` (wire in, rewrite, or delete in favour of the above) and the per-project backups (keep `claudedev backup <project>` working).
- **Measure** on Dan's store, read only: zip size and time into `%TEMP%` (then delete it).

### 2. Export and import (moving PCs)

- `claudedev export [file]`: the whole store into one zip (same format as the backup, so a backup can be imported). `claudedev import <file>`: **merges** into the current store: missing projects copied in; for existing projects, `.jsonl` entries merged by id/time+content with no duplicates, `session_handoff.md` kept from whichever is newer (the other kept in `HANDOFFS.jsonl` if not already there), lessons merged with the near-duplicate rule. It backs the current store up first and prints a summary (projects added, entries added, skipped as duplicates). `--dry-run` shows the summary without writing.
- **Tray app:** "Export memory…" (save dialog) and "Import memory…" (open dialog, then the dry-run summary, then confirm). The Dashboard shows the backups list and the newest backup's age.
- **Restore:** `claudedev restore` for a store backup restores into the store after backing up the current one; say how it differs from import (replace vs merge) and make both clear in help and README.

### 3. Sync status

- Detect whether `[Documents]` (the memory root's real path) is inside a OneDrive folder and whether OneDrive is running, from the sources you cite. The tray app and `claudedev status` (or `claudedev backup --status`) say one line: "Your memory is in OneDrive (synced) and backed up daily (newest: …)" / "Your memory isn't in a synced folder: export it now and then, or move Documents to OneDrive" / "OneDrive isn't running: your memory isn't syncing right now".
- No OneDrive API, no sign-in.

### 4. Two PCs: conflict copies

- When reading a project's files (the CLI's load/record readers, `cds-context.js`, `cds-search.js`), find OneDrive conflict copies of CDS's `.jsonl` files (the pattern from the sources), merge their entries into the main file **through the CLI** (no duplicates), and move the copy into `Backups\conflicts\` (never delete it). Report in `load`'s output one short line when this happened ("merged 3 entries from a OneDrive conflict copy made on PC-NAME"). `session_handoff.md` conflict copies: keep the newer as the handoff, record the other in `HANDOFFS.jsonl`.
- Test with fixtures named like real conflict copies.

### 5. The old git and cloud commands

Test `claudedev git …` (against a throwaway local bare repo in `%TEMP%`, no network) and `claudedev cloud …` (without credentials: does it fail politely? does anything need a real account to test?). Then decide: keep what works (with tests and a README line), or remove what doesn't (help text, code, README), and say why. Don't leave a command that silently does nothing.

### 6. Version 1.7.0, release notes, build, tests

- Bump to **1.7.0**; `docs\releases\RELEASE_NOTES_v1.7.0.md` (backups, export/import, sync status, two-PC safety, the git/cloud decision; "Known" as needed).
- **Smoke `--cli`:** everything from P9 plus: a daily backup is made once per day and pruned by the rule; a pre-upgrade backup; export → import into an empty throwaway root reproduces the store (file by file); import into a store with overlapping entries adds only the missing ones and duplicates nothing; dry-run writes nothing; a conflict-copy fixture is merged and moved, and load reports it; restore backs up first. All against throwaway roots.
- **Sandbox offline A–F, in the foreground,** with a check added to scenario B (upgrade) that a pre-upgrade store backup exists and opens; SHA-256 matches.
- **Machine-to-machine (in the sandbox if you can):** export from the host's throwaway root, import inside the sandbox, load shows the project. If that's impractical, say why and rely on the throwaway-root test.

---

## Verification

- Builds 0 errors, no new warnings; NSIS 0; `check-versions.ps1` all 1.7.0.
- Smoke `--cli` all pass; the installed copy's run passes what it can, names what it skips.
- Dan's store untouched (size and newest write time before and after, in the output); the measurement numbers.
- Sandbox A–F all PASS; SHA-256 matches.
- No bypass flag; no Dan-specific paths in shipped files.

## On completion

1. **`docs\P10_OUTPUT.md`:** first, what the producer must do (review; publish v1.7.0; deploy/install; anything Dan should do, e.g. run a first export). Then "Decisions I made", docs facts with URLs, each item with evidence, measurements, the git/cloud decision, sandbox table and SHA-256, anything not done and why.
2. **`docs\GROUND_TRUTH.md`:** §2 (a "P10 done" line and **Next**), §3, §4, §7 (item 29 fixed; anything new), §9 (P10 ✓), §10, §11, §12, "Last updated".
3. **Commit** `P10: backups that run, export/import, sync status, two-PC safety, v1.7.0 build`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.** No tag, no release. **Only end your turn after the push.**

=== P10 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
