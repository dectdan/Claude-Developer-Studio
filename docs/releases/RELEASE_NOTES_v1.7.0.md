# ClaudeDevStudio v1.7.0

This release makes sure your memory survives a broken PC and a move to a new one: CDS now backs up your whole memory store every day and before every upgrade, exports it to one file and imports it on another PC without losing or doubling anything, tells you in one line whether it is synced and backed up, and keeps entries that two PCs wrote at the same time.

## New

- **Automatic backups that really run.** Once a day CDS zips your whole memory store (every project, the lessons for every project, the phase list, the chat checkpoints) into `Documents\ClaudeDevStudio\Backups\store\`. It happens the first time Claude loads a project that day (in the background: loading doesn't wait for it) and from the tray app, which checks every hour. The installer makes one **before every upgrade**. Each zip holds a manifest with the CDS version, the time, the PC's name, the file count and a SHA-256 hash for every file. CDS keeps the newest 14 daily backups and the newest 4 made before an upgrade; backups you make yourself, and the ones made before a restore or an import, are never deleted.
  - `claudedev backup --all` makes one now; `claudedev backups` lists them; `claudedev backup --verify <zip>` checks one opens and every hash matches.
  - The Dashboard's new **Backups** page shows the list and the newest backup's age; the tray icon has a **Memory backups** menu.
- **Export and import, for moving to a new PC.** `claudedev export [file]` (tray: **Export memory…**) puts the whole store in one zip, the same format as the backups, so a backup can be imported too. On the other PC, `claudedev import <file>` (tray: **Import memory…**, which shows what it would add and asks first) **merges** it into the memory there:
  - projects that are missing are copied in;
  - in projects that exist on both, the entries (mistakes, decisions, patterns, handoffs, activity, performance) that are missing are added and none is added twice; an entry whose ID is already taken by a different one gets the next free ID and keeps its old one as `original_id`;
  - lessons are merged with the same near-duplicate rule as `claudedev lesson add`;
  - of two different `session_handoff.md` files the newer one is kept as the handoff and the other is added to `HANDOFFS.jsonl` if it isn't already there;
  - any other file that differs (e.g. `FACTS.md`): the newer one stays and the other is kept in `Backups\import-kept\<time>\`; this PC's own state files (`session_state.json` and the like) are kept.

  It backs up the current store first and ends with a summary (projects added, entries added, skipped as duplicates). `--dry-run` shows the summary without writing anything.
- **Restore is a replace, import is a merge.** `claudedev restore <backup .zip>` puts every file of the backup back as it was when the backup was made, overwriting the current copies (it asks first, or `--yes`; it backs up the current store first; files that aren't in the backup are left alone). Use it to go back to a backup; use import to bring another PC's memory in. `claudedev restore <file.backup> [project]` still restores one project from the older per-project backups (`claudedev backup <project>`).
- **Is it synced?** `claudedev backup --status`, the last line of `claudedev status`, the tray menu and the Dashboard say one of: *Your memory is in OneDrive (synced) and backed up daily (newest: …)*, *Your memory isn't in a synced folder: export it now and then, or move Documents to OneDrive*, or *OneDrive isn't running: your memory isn't syncing right now*. CDS works this out from what OneDrive records for your account in Windows (no OneDrive API, no sign-in).
- **Two PCs at once.** When two PCs write the same memory file before OneDrive has synced it, OneDrive keeps both and names one after the PC (for example `MISTAKES-DESKTOP-ABC123.jsonl`); CDS used to read only the main file, so that PC's entries were missed. Now, when Claude loads or records in the project, CDS merges the copy's entries into the main file (no duplicates), moves the copy to `Backups\conflicts\<project>\` (never deletes it) and says so in one line, e.g. "OneDrive: Merged 3 entries from a OneDrive conflict copy made on DESKTOP-ABC123". Search reads a copy that isn't merged yet, so nothing is missing from it either.

## Removed

- **`claudedev git …`, `claudedev cloud …` and `claudedev sync`.** Tested for this release, they could lose memory or did nothing: `git pull` replaced the memory files with the repository's copies (entries written on this PC since the last commit were lost), `git push` used a branch name the repository might not have, and both ignored where the memory lives and named the project after the current folder; `cloud` never authenticated to Cloudflare R2, its `list` always said 0 and `download` always failed, and `configure` stored the API token in plain text in the (synced) memory folder; `sync` backed up the project folder instead of its memory and said "Sync complete". They now print one line saying so and what to use instead (export and import), and exit 1. Nothing they made is deleted.

## Fixed

- `claudedev backup` and `backups` for one project no longer create an empty project folder in your memory store (it was named after the current directory when no project was given); per-project backups now include the handoffs (`HANDOFFS.jsonl`, `session_handoff.md`), and are no longer deleted after the tenth.

## Known

- **A synced folder is not a backup:** a damaged or emptied file syncs too. The daily zips are the backup; they are in the same Documents folder, so if Documents itself is lost (and not synced), so are they. For a copy elsewhere, export now and then to another disk.
- **The daily backup needs CDS to be used that day** (a load, or the tray app running). On a PC where neither happens, no backup is made, and none is needed.
- **The first backup on a OneDrive folder can take several seconds** (Windows checks each file on its first read; measured 8.9 s for ~1,000 files, then 0.4 s). It runs in the background.
- Restore never deletes: a project or a day that was added after the backup stays after a restore.

## After installing

1. Quit Claude Desktop fully (right-click its tray icon, **Quit**) and open it again.
2. Your first backup is made by the installer (if CDS was already installed) or on the first load. Moving to a new PC soon? Run **Export memory…** from the tray icon now, keep the file somewhere safe, and import it on the new PC after installing CDS there.

## Reporting a problem

Open an issue at [github.com/dectdan/Claude-Developer-Studio/issues](https://github.com/dectdan/Claude-Developer-Studio/issues), or write to support@gainpublications.com. Say what you did, what happened, and your Windows version. The installer's log is `%LOCALAPPDATA%\ClaudeDevStudio\install.log`; the Claude Code hook's is `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log`; Claude Desktop's server logs are in `%APPDATA%\Claude\logs\`. Check a log for anything private before attaching it; an export or a backup holds your whole memory, so don't attach one.
