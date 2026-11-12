# P5 — Candidate lessons for every project

*2026-11-11, Claude Code (P5). Read-only scan of the real memory store (both stores, 210 unique mistakes in 21 projects). Nothing here has been written to the store: the producer reviews this list and seeds `LESSONS.jsonl` (command at the end).*

## How they were found

1. **The matching rule** (the one `check_mistake` and the CLI use: at least 3 shared keywords of 4+ letters, stop words out, making at least 30% of the smaller word set of mistake + lesson), every mistake against every mistake of **another** project. Clusters: greedy, seed with the most other projects first. Result: **7 clusters spanning 2 projects, none spanning 3 or more.** Four are real lessons (1–4 below); three are coincidences of common words (listed at the end, not proposed).
2. **The rule misses long entries:** most recorded mistakes are 100+ words, so 30% of the smaller set needs 30+ shared words. So the themes were also searched with the new `claudedev_search` (kinds: mistakes), which found the same mistake recorded in 2–4 projects for six more lessons (5–10). They are marked "found by search".

"Times" counts recorded mistakes, after removing the copies the store merge made (an entry in both stores counts once).

## Candidates

| # | Lesson (one line) | Projects and dates | Times | Found by |
|---|---|---|---|---|
| 1 | In WinUI 3 / XAML, events such as ValueChanged, SelectionChanged, Toggled and Checked fire during InitializeComponent, before named controls exist: null-check other controls in those handlers, or set initial values in code after InitializeComponent. | ArchiVault 2026-04-14; SynapseBridge 2026-04-28, 2026-05-02; BarcodeStockCounter 2026-04-03; AIAudiobookStudio 2026-03-25 | 5 (4 projects) | rule (3 in 2 projects) + search |
| 2 | Never pass backslashes (Windows paths, \n, escapes) through a Bash heredoc, sed or a python one-liner: use the Edit tool, or a script file written with the Write tool, and check the result for control characters. | ClaudeDevStudio 2026-11-11; Takehouse 2026-11-05, 2026-11-06 | 3 (2 projects) | rule + search |
| 3 | Keep app.manifest referenced in the .csproj (ApplicationManifest) and keep its DPI settings even when a build warning says they are ignored: Windows reads the manifest when the EXE loads. | IconForge 2026-04-11; Chess3d 2026-05-12 | 2 (2 projects) | rule |
| 4 | In a packaged app (.wapproj / MSIX) the packaging project decides what ships: declare every asset in both the app project and the .wapproj, and check which copy is packaged before editing a file that exists twice. | ArchiVault 2026-04-15, 2026-04-17, 2026-04-18, 2026-04-19; VoiceCloner 2026-08-28 (twice) | 6 (2 projects) | rule (2) + search |
| 5 | Don't write code files through PowerShell here-strings or tools that re-encode text (curly quotes, escaped quotes, em-dashes, LF line endings): write them with the Edit/Write tools or from Python/Node, then parse or build them. | ClaudeDevStudio 2026-04-04; SynapseBridge 2026-04-29; NZBHub 2026-04-25; SmartScribe 2026-06-17 | 4 (4 projects) | search |
| 6 | After a search-and-replace edit of code (edit_block, old_string, a scripted replace), reread the lines around it and build: an edit that starts or ends at a brace or a signature can drop or duplicate it, and a replace can report success without changing anything. | SmartScribe 2026-03-14; Bolt 2026-03-19, 2026-03-20; AIAudiobookStudio 2026-03-25; SynapseBridge 2026-04-10, 2026-05-06 | 6 (4 projects) | search |
| 7 | Before saying a fix is live, confirm that the running program is the one just built (process path, file time, version): Visual Studio, a process still running, or a stale copy may still be the old one. | ArchiVault 2026-04-16; SynapseBridge 2026-05-20, 2026-05-21; AIAudiobookStudio 2026-03-31; SmartScribe_Qt 2026-05-28 | 5 (4 projects) | search |
| 8 | Name the encoding (UTF-8) whenever a program reads or writes text on Windows: the default code page breaks anything non-ASCII, and a BOM has to be handled on purpose. | AITradingExperiment 2026-04-07; AIAudiobookStudio 2026-03-24; SmartScribe 2026-06-17 | 3 (3 projects) | search |
| 9 | Don't hand-write .wapproj, .sln or Package.appxmanifest files: create them from Visual Studio's templates and edit those. | StoryVox 2026-03-15; Chess3d 2026-05-11 | 2 (2 projects) | search |
| 10 | When the same file is in two places (source and output folders, a test file and its synced duplicate), find out which one the program really uses before changing or testing it. | VoiceCloner 2026-08-28; SmartScribe_Qt 2026-05-28; SmartScribe 2026-06-18; AIAudiobookStudio 2026-03-31 | 4 (4 projects) | search |

**Not recurring in the memory, but already rules that bite** (ClaudeDevStudio's ground truth, §11; one project each in the store, so they don't meet the "two or more projects" bar; the producer may still want them, since they are the examples the P5 prompt gives):

| # | Lesson | Where |
|---|---|---|
| 11 | Never build a path from %USERPROFILE%\Documents: ask Windows for the Documents folder (MyDocuments), which may be redirected to OneDrive. | ClaudeDevStudio 2026-04-10 (v1.2.1) and 2026-11-11 (the split memory) |
| 12 | Back up data before any change that could touch it, and say where the backup is. | ClaudeDevStudio 2026-11-11 (GROUND_TRUTH §5, §11) |

**Coincidences of the rule, not proposed:** ArchiVault 2026-04-16 + SynapseBridge 2026-05-08 (a stale build vs. a misread instruction: they share "build", "always", "said"); Chess3d 2026-05-12 + IconForge 2026-04-10 (a nested .csproj vs. a missing .sln: different lessons about project files); SmartScribe 2026-06-05 + SmartScribe_NEW 2026-02-14 (one product under two folder names; different lessons).

Lessons 2 and 5 are close (both about tools mangling text) but not near-duplicates under the rule; 4, 9 and 10 overlap in subject (packaging) and differ in what to do. All twelve pass the CLI's near-duplicate check against each other (checked on a throwaway root, see `docs\P5_OUTPUT.md`).

## Seeding (the producer, after review and after deploying P5)

Delete the lines you don't want from the block below, then run the PowerShell lines under it. Each line goes through the same rules as `claudedev_record_lesson` (an empty or near-duplicate lesson is refused and named; the rest are added).

```jsonl
{"lesson":"In WinUI 3 / XAML, events such as ValueChanged, SelectionChanged, Toggled and Checked fire during InitializeComponent, before named controls exist: null-check other controls in those handlers, or set initial values in code after InitializeComponent.","why":"Recorded 5 times in 4 projects: ArchiVault 2026-04-14, SynapseBridge 2026-04-28 and 2026-05-02, BarcodeStockCounter 2026-04-03, AIAudiobookStudio 2026-03-25.","source_project":"SynapseBridge"}
{"lesson":"Never pass backslashes (Windows paths, \\n, escapes) through a Bash heredoc, sed or a python one-liner: use the Edit tool, or a script file written with the Write tool, and check the result for control characters.","why":"Recorded 3 times: ClaudeDevStudio 2026-11-11, Takehouse 2026-11-05 and 2026-11-06.","source_project":"Takehouse"}
{"lesson":"Keep app.manifest referenced in the .csproj (ApplicationManifest) and keep its DPI settings even when a build warning says they are ignored: Windows reads the manifest when the EXE loads.","why":"Recorded in IconForge 2026-04-11 and Chess3d 2026-05-12.","source_project":"Chess3d"}
{"lesson":"In a packaged app (.wapproj / MSIX) the packaging project decides what ships: declare every asset in both the app project and the .wapproj, and check which copy is packaged before editing a file that exists twice.","why":"Recorded 6 times: ArchiVault 2026-04-15 to 2026-04-19, VoiceCloner 2026-08-28.","source_project":"ArchiVault"}
{"lesson":"Don't write code files through PowerShell here-strings or tools that re-encode text (curly quotes, escaped quotes, em-dashes, LF line endings): write them with the Edit/Write tools or from Python/Node, then parse or build them.","why":"Recorded in ClaudeDevStudio 2026-04-04, SynapseBridge 2026-04-29, NZBHub 2026-04-25, SmartScribe 2026-06-17.","source_project":"ClaudeDevStudio"}
{"lesson":"After a search-and-replace edit of code (edit_block, old_string, a scripted replace), reread the lines around it and build: an edit that starts or ends at a brace or a signature can drop or duplicate it, and a replace can report success without changing anything.","why":"Recorded 6 times in 4 projects: SmartScribe 2026-03-14, Bolt 2026-03-19 and 2026-03-20, AIAudiobookStudio 2026-03-25, SynapseBridge 2026-04-10 and 2026-05-06.","source_project":"SynapseBridge"}
{"lesson":"Before saying a fix is live, confirm that the running program is the one just built (process path, file time, version): Visual Studio, a process still running, or a stale copy may still be the old one.","why":"Recorded 5 times in 4 projects: ArchiVault 2026-04-16, SynapseBridge 2026-05-20 and 2026-05-21, AIAudiobookStudio 2026-03-31, SmartScribe_Qt 2026-05-28.","source_project":"SynapseBridge"}
{"lesson":"Name the encoding (UTF-8) whenever a program reads or writes text on Windows: the default code page breaks anything non-ASCII, and a BOM has to be handled on purpose.","why":"Recorded in AITradingExperiment 2026-04-07, AIAudiobookStudio 2026-03-24, SmartScribe 2026-06-17.","source_project":"AITradingExperiment"}
{"lesson":"Don't hand-write .wapproj, .sln or Package.appxmanifest files: create them from Visual Studio's templates and edit those.","why":"Recorded in StoryVox 2026-03-15 and Chess3d 2026-05-11.","source_project":"Chess3d"}
{"lesson":"When the same file is in two places (source and output folders, a test file and its synced duplicate), find out which one the program really uses before changing or testing it.","why":"Recorded in VoiceCloner 2026-08-28, SmartScribe_Qt 2026-05-28, SmartScribe 2026-06-18, AIAudiobookStudio 2026-03-31.","source_project":"VoiceCloner"}
{"lesson":"Never build a path from %USERPROFILE%\\Documents: ask Windows for the Documents folder (MyDocuments), which may be redirected to OneDrive.","why":"ClaudeDevStudio: the VS Bridge in v1.2.1 (2026-04-10) and the split memory found on 2026-11-11.","source_project":"ClaudeDevStudio"}
{"lesson":"Back up data before any change that could touch it, and say where the backup is.","why":"ClaudeDevStudio 2026-11-11: the method's rule for memory and project data (ground truth, sections 5 and 11).","source_project":"ClaudeDevStudio"}
```

```powershell
# From D:\Projects\ClaudeDevStudio, with P5's CLI deployed (deploy.ps1). Works in Windows PowerShell 5.1 and PowerShell 7.
$md = Get-Content docs\P5_lesson_candidates.md -Raw
$block = [regex]::Match($md, '(?s)```jsonl\r?\n(.*?)```').Groups[1].Value
$seed = Join-Path $env:TEMP 'cds-lessons-seed.jsonl'
[System.IO.File]::WriteAllText($seed, $block, (New-Object System.Text.UTF8Encoding $false))
& "$env:LOCALAPPDATA\ClaudeDevStudio\CLI\claudedev.exe" lesson add --file $seed
& "$env:LOCALAPPDATA\ClaudeDevStudio\CLI\claudedev.exe" lesson list
```

To take one out again: `claudedev lesson remove LSN###`; to change one: `claudedev lesson edit LSN### "{\"lesson\":\"...\"}"` (PowerShell 7) or put the JSON in a file and edit it there (the file is `[Documents]\ClaudeDevStudio\LESSONS.jsonl`, one JSON object per line; `lesson edit`/`remove` keep the previous file as `LESSONS.jsonl.bak`).
