# ClaudeDevStudio v1.7.1

A fix release: text reads right wherever it goes, the installer's log is clean, and the shipped programs carry no path of the PC that built them. Nothing about your memory changes.

## Fixed

- **Garbled symbols in the tray app's messages.** In v1.7.0 **Export memory…** (and Back up now, Import, the Claude Code items) showed `âœ"` for a check mark and `â†'` for an arrow. The tray app and the Dashboard now read the CLI's output as UTF-8, which is what it writes.
- **The CLI writes the same text everywhere.** To a program (Claude, the tray app, the installer, a script) it always writes UTF-8, also when it runs without a console window (before, the check mark could come out as `?` or `û` there). In a console window it writes through Windows' Unicode console API, so any character shows correctly and the console's code page is no longer changed. Its own marks are now plain words and ASCII (`OK:`, `WARNING:`, `ERROR:`, `->`), which read the same in an old console, in Windows PowerShell's captured output and in the installer's log; your own text (project names, paths, mistakes) keeps its characters.
- **`install.log` reads cleanly.** It is UTF-8 throughout: the installer's own lines are written as UTF-8, and the memory backup before an upgrade and the Claude Code check write their own lines (instead of the installer reading their output in the ANSI code page). The memory-backup line no longer shows `û`, and the Claude Code line no longer reads "Claude Code: Claude Code: not found".
- **Folders with non-ASCII letters** (a Windows user named José, a OneDrive folder in another language): finding the Documents folder and finding Claude Code on PATH no longer garble the path (Windows PowerShell and `where.exe` answer in the console's code page; CDS now asks PowerShell for UTF-8 and searches PATH itself).
- **No build paths in the programs.** The CLI, tray app, Dashboard and VS Bridge DLLs no longer contain the folder they were built in (release builds map it to `/_/`), and the installer no longer ships `.pdb` debug-symbol files (one held the build machine's user folder). Stack traces still name the methods.

## Upgrading

Run the installer over v1.7.0. It backs up your whole memory store first, as v1.7.0 does. Then quit Claude Desktop fully and reopen it.
