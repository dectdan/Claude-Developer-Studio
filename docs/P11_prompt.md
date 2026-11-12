# ClaudeDevStudio — P11 (Claude Code Prompt)
# Text that shows correctly everywhere (the encoding bug), the installer log's doubled label, build paths out of the binaries; the v1.7.1 build (nothing is published here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, free, MIT and public (`D:\Projects\ClaudeDevStudio`, git `main`). **v1.7.0 is released** and installed on Dan's PC. This session was started from Claude Desktop with `claudedev_phase_start` and already has the project's context.

**Unattended (delegated):** nobody can answer while it runs; take the safest reading, write it under "Decisions I made" in `docs\P11_OUTPUT.md`. **Long steps in the foreground** (build; sandbox ~21 min). **Only end your turn after the push.**

---

## Why

Dan's first **Export memory…** from the tray app (v1.7.0, 2026-11-12) showed:

```
âœ" Exported the memory store:
C:\Users\...\ClaudeDevStudio-export-20261112-155316.zip
  978 files, 4.9 MB â†' 2.1 MB zipped, 0.4 s
```

`✓` and `→` written by the CLI as UTF-8 and read by the tray app as Windows-1252. The same bug shows in the installer's `install.log` ("Memory backup (exit 0): û Backup of …" on machine 3: the CLI's output read in the console's OEM code page). Every user sees this.

## The work

1. **Find every place a CDS program reads another's output** (the tray app and the Dashboard starting `claudedev.exe` or `node cds-phase.js`; the installer capturing the CLI's and Node's output into `install.log`; `index.js`/`workbench.js`/`cds-hook.js` reading the CLI; scripts) and make each one decode what the other writes. Prefer fixing both ends: the readers set UTF-8 explicitly (`StandardOutputEncoding`/`StandardErrorEncoding = UTF8` in .NET; `encoding: 'utf8'` in Node), and **for text that goes where the reader can't be controlled** (NSIS's `nsExec` into `install.log`, a user's console with an old code page), decide whether the CLI should use plain ASCII marks (`OK`, `->`) instead of `✓`/`→`/`⚠️` — say what you chose and why (a user running `claudedev` in a modern terminal is fine with UTF-8; NSIS isn't). Check `install.log` comes out readable.
2. **The installer log's doubled label:** "[setup] Claude Code: Claude Code: not found. …" → one label.
3. **Build paths in the binaries** (§7 item 27): `<ContinuousIntegrationBuild>true</ContinuousIntegrationBuild>` (or `PathMap`) for release builds in `Directory.Build.props`, and don't stage `*.pdb` in the installer unless there's a reason (say it). Check afterwards: no `D:\Projects`, no user-folder path, in any staged file.
4. **Version 1.7.1**, `docs\releases\RELEASE_NOTES_v1.7.1.md` (short: the fixes).
5. **Tests:** smoke `--cli` (isolated, as P10 made it) all pass plus a check that the CLI's export/backup output read the way the tray reads it contains no `â`/`Ã`/`û` mojibake; a check of `install.log` in the sandbox (scenario B: the memory-backup line reads cleanly, no `û`); **sandbox offline A–F + M in the foreground**, all PASS, SHA-256 matches. If you can, show the tray's export message text (from the code path, without clicking) decoded correctly.

## Rules

- Never touched on this PC: Dan's `~/.claude/settings.json`, `~/.claude.json`, `%APPDATA%\Claude\claude_desktop_config.json`, the installed copy, any `qwen_config.json`, Dan's other projects, `D:\websites`. **Dan's memory store is read only** (tests on throwaway roots, as P10 set up). Back up tracked files before editing. Builds 0 errors, no new warnings (CLI 24, TrayApp 14, Dashboard 0, VSIX 12). No bypass flags. No PC-specific paths in shipped files. **Don't deploy, tag or release.**

## On completion

1. **`docs\P11_OUTPUT.md`:** first what the producer must do (publish v1.7.1: SHA-256, notes). Then decisions, each item with evidence (before/after text), the build-path check, sandbox table, anything not done.
2. **`docs\GROUND_TRUTH.md`:** §2 ("P11 done", **Next**), §7 (item 27 and the encoding item), §11 (the rule: programs reading each other's output name the encoding), §12, "Last updated".
3. **Commit** `P11: text shows correctly everywhere, one label in the installer log, no build paths in binaries, v1.7.1 build`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.** No tag, no release.

=== P11 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
