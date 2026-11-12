# P8 Output — Phases that wait properly, the method in the templates, a gentler stop, the v1.6.0 build
*2026-11-12, Claude Code 2.1.322 (Opus 5.5, high), unattended; started with `claudedev_phase_start` from the packaged Claude Desktop (section 4). Prompt: `docs\P8_prompt.md`. Nothing was deployed, tagged or released. Dan's `~/.claude/settings.json`, `~/.claude.json`, `claude_desktop_config.json`, the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio` (read only: its smoke run), any `qwen_config.json`, his other projects and `D:\websites` were not touched. Dan's memory store: the smoke test's throwaway roots (removed by the test), the real run's throwaway project `cds_p8_throwaway` (written by Dan's Claude Code hooks; removed afterwards), and what this session's hooks and its one `claudedev_record_decision` (DEC003) record.*

---

## For the producer

1. **Review** this file and the commit (`P8: phases wait properly, the method in the templates, gentler stop, v1.6.0 build`).
2. **Publish v1.6.0** on GitHub: tag `v1.6.0` at the commit, attach `Installer\Output\ClaudeDevStudio-Setup.exe` (**SHA-256 `94591069B3D9A2B0EC86D4874F35480262C44752625F90EAD0EB77EF6F1A8337`**, 209,371,160 bytes, the one the sandbox ran), body from `docs\releases\RELEASE_NOTES_v1.6.0.md`. Check the asset digest GitHub shows equals that SHA-256.
3. **Then Dan installs v1.6.0** (this also brings the 1.5.0+ VS Bridge into his main Visual Studio), or deploy with `deploy.ps1` (its `-DryRun` at 11:18 listed **10 files**: the CLI's 4 (1.6.0), `mcp-server\workbench.js`, `cds-phase.js`, `package.json`, `templates\GROUND_TRUTH.md`, `templates\HOW_WE_WORK.md`, `review-server\package.json`; `npm ci` in both; 15 already the same). Deploying doesn't touch a phase already running, but only runs *started* after it get the new stop. Either way: quit Claude Desktop fully and reopen it.
4. **Don't stop this kind of run with the installed (P7) copy expecting a handoff:** the gentle stop needs a run *started* by the 1.6.0 `cds-phase.js` (Claude Code must share the runner's console). A run started before the update is stopped by force, as before, and Status says so.
5. **Then W**, with the tools.
6. **Note: `docs\P9_prompt.md` appeared while this ran** (10:56 local; not written by this session, left untracked and not committed). It keeps the version at 1.6.0 and has v1.6.0 published after P9, so publishing this EXE now and P9 shipping as 1.6.0 later would clash: either publish this build now and let P9 bump to 1.6.1, or hold the release for P9's build. This output gives this build's numbers either way.

## Results at a glance

| What | Result |
|---|---|
| Monitor | **Added** to the default tools (`cds-phase.js` and `run-phase.ps1`). It does run commands of its own, but with Bash's permission rules (Bash is already allowed); decision 1. |
| The idle ceiling | `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=3600000` (60 min) in the run's environment, plus **`BASH_MAX_TIMEOUT_MS=3600000`**, unless the user set them; recorded per run in the `.json` (`env`). Real run: both reached Claude Code's shell. **An 11-minute foreground command:** with the variable it finished in the foreground (one result, 665 s); without it, Claude Code moved it to the background at 600 s and printed a result early (the P7 failure mode). |
| Templates | `HOW_WE_WORK.md`: a "Writing and running a phase" section (11 lines); `GROUND_TRUTH.md`'s Plan hint names the four parts of a phase prompt. |
| Gentle stop | **Works.** Stop sends Ctrl+C into the runner's hidden console; real Claude Code (Haiku, low) ended its turn mid-command (`error_during_execution`, `terminal_reason: aborted_tools`), ran its SessionEnd hooks (the automatic handoff HND001 was written) and exited 0: **3.0 s** through the tool, nothing left running. A reply then continued the same session. Fallback to `taskkill /T /F` after two presses (10 s + 5 s) or if Ctrl+C can't be sent; Status says which. |
| This run's start | `launched_by: "wmi"`; runner's parent `WmiPrvSE`; the workbench that started it is a child of `C:\Program Files\WindowsApps\Claude_5.1231.2.0_x64__pzs8sxrjxfjjc\app\Claude.exe` (the packaged Claude Desktop); no "detached child" note; `.err` empty. |
| Version | **1.6.0**; `check-versions.ps1`: all 15 places. |
| Builds | 0 errors. Warnings CLI 33, TrayApp 14, Dashboard 0, VSIX 12 (unchanged). NSIS 0 (`/V2` printed nothing). |
| Installer | 199.7 MB (209,371,160 bytes), **SHA-256 `94591069B3D9A2B0EC86D4874F35480262C44752625F90EAD0EB77EF6F1A8337`**, built in 2.4 min. |
| Smoke `--cli bin\Release\net8.0\claudedev.exe` | **156 passed, 0 failed** (P7's 147 + 9). Installed copy (v1.5.0 + the P7 deploy): **110 passed, 0 failed**, skips named (the CLI-only checks; the 8 P8 checks: "this cds-phase.js predates P8"; run-phase.ps1: not in an installed copy). |
| Sandbox offline A–F | **75 passed, 0 failed** (A 16, B 9, C 9, D 10, E 16, F 15), 17.8 min, run `20261112-105710`, on the EXE above (the runner printed SHA-256 `94591069…8337`). The installed copy's smoke inside it, P8 checks included: A 153/153, D 155/155. |
| No bypass | `git grep -n "dangerously\|bypassPermissions"`: only text forbidding it, and the smoke checks (hostile input refused, never passed). |

## Decisions I made

1. **Monitor goes in the default list.** The docs: "For most watches, Claude writes a small script, runs it in the background, and receives each output line as it arrives", and "When Monitor runs a command, it uses the same permission rules as Bash". So it can run commands, but nothing Bash (allowed, unrestricted, in every phase) can't; a user who narrows or denies Bash narrows Monitor too ("a rule on every Bash command also covers these WebSocket watches"). Its one new kind of action is a WebSocket client to public hosts (private, link-local and metadata addresses are denied), which Bash plus Node can already do. What it adds is a way to *wait*: in a `-p` run a watch lasts at most 10 minutes and the run waits for it. On Windows it exists only with Git Bash installed.
2. **60 minutes for both variables.** `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` covers the idle wait for subagents, workflows and Monitor watches after the last turn (a background *command* already holds the run open); 60 minutes covers this project's longest step (the sandbox, ~17 min) three times over, and an hour of idle waiting is the most a forgotten watch should cost. The docs give no maximum; `0` would wait forever, which an unattended run shouldn't. **`BASH_MAX_TIMEOUT_MS` too** (not named in the prompt): it is what makes "run long steps in the foreground" possible at all; without it the longest foreground timeout is 10 minutes and a 17-minute sandbox *must* go to the background (proved above). It raises only the ceiling Claude may ask for; the 2-minute default for a command given no timeout stays, so a hung command still moves to the background after 2 minutes. I left `BASH_DEFAULT_TIMEOUT_MS` alone: it would change every command's default timeout.
3. **The user's own values win** (a variable already in the environment WMI builds from the profile is kept).
4. **Ctrl+C, not Ctrl+Break.** Both reach the processes on the console (tested); the docs name SIGINT as the way to end a `-p` turn, which is what Ctrl+C becomes. Two presses, then force, because an interactive CLI's convention is that a second Ctrl+C insists; the real Claude Code needed one.
5. **Claude Code shares the runner's console.** Node's `windowsHide` gives a child a windowless console of its own, which Ctrl+C sent to the runner's console doesn't reach (tested: the child got nothing). The runner now spawns Claude Code without `windowsHide` when it was started by WMI (`--console` on its command line), so Claude Code is on the runner's console, which WMI already hides (`ShowWindow 0`): no window either way. The detached fallback (no WMI) has no console, keeps `windowsHide` and is stopped by force.
6. **The helper is inline PowerShell** (`Add-Type` with four kernel32 calls, sent as `-EncodedCommand`), not a shipped EXE: nothing new to build, sign or stage. It sends nothing unless `AttachConsole` succeeds, so it can never signal the server's own console or Claude Desktop's.
7. **The runner ignores SIGINT/SIGBREAK** (it gets the Ctrl+C too), so it stays to record Claude Code's exit code and release the lock.
8. **After a gentle stop, the run's tree (snapshot taken before Ctrl+C) is swept**: anything still there with the same pid and start time is ended. In practice nothing is left: Node puts each spawned child in a kill-on-close job object, so when the runner exits, whatever the run started goes with it (seen with the fake's child that ignores Ctrl+C). The sweep is the safety net for a process that left the job.
9. **`run-phase.ps1` runs and runs started before P8 are stopped by force**, as before (their Claude Code has its own console); Status and the stop text say why.
10. **Tool description** (`workbench.js`, not in the prompt's list): `claudedev_phase_stop` now says "Ctrl+C first (Claude Code ends its turn and runs its SessionEnd hooks), else ends its process tree by force". Workbench `tools/list` 6,225 → 6,296 bytes.
11. **Smoke checks for P8 are skipped (named) against a `cds-phase.js` without `PHASE_ENV`**, as P7's checks were against a copy without `cds-phase.js`, so the installed copy's run passes what it can.
12. **The fake's long-running child ignores Ctrl+C**, so the test stands for something that outlives Claude Code.
13. **`claudedev_phase_status`** no longer prints an empty `""` line for a result with no text (the interrupted turn's).
14. **The sandbox kit's `$ExpectVersion`** (`tools\sandbox-test\in-sandbox.ps1`) is 1.6.0; nothing else in the kit changed.

## Facts used from Claude Code's docs

- **Monitor** (https://code.claude.com/docs/en/tools-reference, "Monitor tool"): "lets Claude watch something in the background and react when it changes"; "For most watches, Claude writes a small script, runs it in the background, and receives each output line as it arrives. For a server that already pushes events, Claude can open a WebSocket"; "Every watch Claude starts has a deadline: 5 minutes by default, at most 30 minutes, and at most 10 minutes in a non-interactive run given a single prompt with `-p`"; "When Monitor runs a command, it uses the same permission rules as Bash"; "Windows: the tool is available only when Git Bash is installed"; the permission table lists Monitor as needing permission (hence P7's three denials). WebSocket hosts: private, link-local and cloud-metadata addresses are denied.
- **Waiting at exit** (https://code.claude.com/docs/en/headless, "Background tasks at exit"): "After Claude finishes its turn and stdin has closed, a `claude -p` run can stay open to wait for background work that Claude started"; "Unless a background command that the main conversation started is still running, Claude Code stops whatever is still running after 10 minutes of continuous idle waiting by default ... set `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, or set it to `0` to wait without one"; Monitor watches: "the run waits until the watch times out or the 10-minute cap ends the wait, whichever comes first".
- **The variable** (https://code.claude.com/docs/en/env-vars): `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`: "Ceiling in milliseconds on idle waiting for background work ... Default: `600000`, or 10 minutes ... A running background command that the main conversation started holds the run open past it. Set to `0` to wait indefinitely. Requires Claude Code v2.1.182 or later." No maximum is documented. Set like any environment variable (here: in the run's environment). `BASH_MAX_TIMEOUT_MS`: "Maximum timeout the model can set for a foreground Bash or PowerShell tool command ... (default: 600000, or 10 minutes)". `BASH_DEFAULT_TIMEOUT_MS`: default 120000.
- **Background commands** (https://code.claude.com/docs/en/tools-reference, "Time limit for background commands"): in a `-p` run whose prompt is text, a command started in the background, or moved there at its timeout, gets 10 minutes by default (up to 2 hours with a `timeout`); "When a foreground command reaches its timeout without finishing, Claude Code moves it to the background instead of stopping it, unless the command starts with `sleep`".
- **Stopping** (https://code.claude.com/docs/en/headless, "Stop a run with SIGTERM"): SIGTERM exits 143, "leaves the turn that was in progress unfinished and records no result", runs SessionEnd hooks; "To end the turn instead, send SIGINT, or call the Agent SDK's `interrupt()`". Nothing Windows-specific is documented; Ctrl+C is the console's SIGINT. `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` would make a resume continue an interrupted turn (not used).

## 1. Phases that wait properly

`cds-phase.js`: `DEFAULT_ALLOWED_TOOLS` has `Monitor` after `PowerShell` (26 entries); `PHASE_ENV` = `{ CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '3600000', BASH_MAX_TIMEOUT_MS: '3600000' }`; `phaseEnv()` adds them to the cleaned environment unless set; the runner records `env` and `shares_console` in the run's entry. `run-phase.ps1`: `Monitor` in `$allowed`; both variables set in its own process (inherited by `cmd.exe` and Claude Code) unless already set; parses (0 errors), ASCII only. Status keeps "RUNNING (it has a result and is waiting for background work it started)".

**Evidence:** the real T1's `docs\env.txt`, written by Claude Code's PowerShell tool: `ceiling=3600000 bashmax=3600000`; its `.json`: `"env":{"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS":"3600000","BASH_MAX_TIMEOUT_MS":"3600000"}`. The A/B test (`claude -p`, Haiku, low, one PowerShell call `node -e "setTimeout(..., 660000)"` with `timeout: 900000`, run side by side):
- **A, `BASH_MAX_TIMEOUT_MS=3600000`:** the tool result was `slept 11 min`, one `result` (success, 664,714 ms), exit 0.
- **B, without:** the tool result was "Command did not complete within its 600s timeout and was moved to the background", a first `result` at 606 s, then a task notification and a second turn reading the output file (3 s), exit 0. That first early result is what made P7's session look finished.
- A 30-minute timeout on a 3-second command is accepted with or without the variable (a control run), so only a long command tells them apart.

## 2. The method in the templates

`mcp-server\templates\HOW_WE_WORK.md`, new section after "The loop":

> ## Writing and running a phase
> - **The prompt names four things:** its scope (the files it may change and create), what it must never touch, how to verify the work, and its output file (`docs\Pn_OUTPUT.md`).
> - **Long steps stay in the foreground.** Builds, installers and test suites run as foreground commands with a timeout long enough for them, or are started and then checked in a loop in the same turn. A phase never ends its turn to wait for something running in the background: nobody is there to wake it up, and the work is left half done.
> - **Running it from a chat** (Claude Desktop with ClaudeDevStudio, Windows): 1. `claudedev_phase_start` ... 2. `claudedev_phase_status` every 15 to 20 minutes ... 3. ... `claudedev_phase_reply`. 4. ... `claudedev_phase_stop`. 5. When it has finished, read `docs\P3_OUTPUT.md` and check the work before writing the next prompt.

`GROUND_TRUTH.md`'s Plan hint: "A phase is one prompt (see `docs\HOW_WE_WORK.md`): it names its scope, what it never touches, its verification and its output file, and runs long steps in the foreground." The scaffold never overwrites, so only new scaffolds get them.

## 3. A gentler stop (§7 item 24)

**What I tried, in order:**
1. A WMI-started hidden Node process (like the runner) with a child started with `windowsHide`; a helper (`FreeConsole`, `AttachConsole(runner)`, a handler that returns true, `GenerateConsoleCtrlEvent`): **CTRL_C_EVENT and CTRL_BREAK_EVENT both reached the WMI-started process** (helper exit 0, ~0.9 s including `Add-Type`), but **not its child** (a console of its own).
2. The same with the child sharing the parent's console: **both events reached both**; the child exited, the parent saw it.
3. Real Claude Code 2.1.322 (Haiku, low) on the shared console, mid-way through a foreground `node -e "setTimeout(..., 150000)"`: one Ctrl+C → the tool call became "The user doesn't want to proceed with this tool use", a user message "[Request interrupted by user for tool use]", a `result` with `subtype: error_during_execution`, `terminal_reason: aborted_tools`; **exit code 0 two seconds later**; the whole tree (2 MCP servers, `cmd`/`pwsh`, the `node` command) gone; Dan's CDS SessionEnd hook wrote **HND001** ("The last request: "[Request interrupted by user for tool use]"... Resume that session with: claude --resume ...").

**As built** (`cds-phase.js` `phaseStop`): ours-check as before → if the run shares its console (`shares_console`, not a `run-phase.ps1` run): snapshot the runner's tree, send Ctrl+C, wait up to 10 s for the runner to go; if not, a second Ctrl+C, 5 s; gone → sweep the snapshot, record `stop_method: "ctrl_c"`, `ctrl_c_presses`, `stop_ms`; otherwise (or if the helper couldn't send) the P7 force path, recording `stop_method: "force"` and `stop_note` (why). Status:
- `STOPPED (by request, with Ctrl+C: Claude Code ended its turn and exited, so its SessionEnd hooks ran)`
- `STOPPED (by request, by force: <why>; no SessionEnd hooks, no automatic handoff)`
- `STOPPED (by request)` for a record from before P8.

**The real run through the tools** (2026-11-12 10:47–10:49 local; scratch driver over MCP stdio, a new source `workbench.js` per call; throwaway `%TEMP%\cds_p8_throwaway` with `docs\` and a README; `claude-haiku-5-5`, `low`):

| Time | Call | Result (shortened) |
|---|---|---|
| 10:47:58 | start T1 | 614 ms. "Started T1 ... Claude Code 2.1.322, claude-haiku-5-5, effort low, permission mode acceptEdits (runner pid 6712, claude pid 14696)." |
| 10:48:12 | status | "RUNNING, 14 s ... Tool calls: 4 \| permission denials: 0" (env.txt written; the 240 s foreground command running, `timeout: 300000`) |
| 10:48:18 | stop | 3,942 ms. "Stopped T1 ... with Ctrl+C (3.0 s): Claude Code ended its turn and exited (exit code 0), so its SessionEnd hooks ran ..." `.json`: `stop_method: ctrl_c`, `ctrl_c_presses: 1`, `stop_ms: 2993`, `exit_code: 0`. No process left (none with the project or the command in its command line), no lock. HND001 written at 10:48:18. |
| 10:48:22 | status | "STOPPED (by request, with Ctrl+C: Claude Code ended its turn and exited, so its SessionEnd hooks ran), 20 s ... Result: error_during_execution, 6 turns, 14 s, is_error." |
| 10:48:59 | reply | 620 ms; the same session (`ee86bf7c…`) continued: ran a 5 s command with `timeout: 1800000`, wrote `docs\T1_OUTPUT.md`. |
| 10:49:13 | status | "FINISHED, 14 s (run 2 of 2, a reply) ... Result: success, 3 turns, 10 s." HND002 written. |

**Smoke** (the fake now answers Ctrl+C like the real one, and has a `stubborn` mode that ignores it): L1 stopped with Ctrl+C in ~1.2 s, the fake ended its turn, "ran SessionEnd" (`docs\fake_session_end.txt`), exit 0, its child (which ignores Ctrl+C) gone, a bystander alive; K1 (stubborn) got exactly two Ctrl+C, then force, everything gone, Status says "by force: Ctrl+C (sent 2 times) didn't end it within 15 s".

Cost of the real checks (the results' `total_cost_usd`, Claude Code's estimate): the probe $0.0069, T1 and its reply about $0.02, the two 11-minute runs and the control about $0.01 each.

## 4. This run itself

- **How it was started:** `docs\P8_run.json` has `"tool": "cds-phase"`, `"launched_by": "wmi"`, `model claude-opus-5-5`, `effort high`, `permission_mode acceptEdits`, the 25 default tools of P7 (no Monitor yet: the installed copy is P7's), `claude.file C:\Users\<user>\.local\bin\claude.exe` 2.1.322, the MCP config in `%TEMP%` pointing at the installed `index.js`. The lock was taken by pid **27348**, which is `node.exe ...\ClaudeDevStudio\mcp-server\workbench.js`, a child of **`C:\Program Files\WindowsApps\Claude_5.1231.2.0_x64__pzs8sxrjxfjjc\app\Claude.exe`** (pid 35048): the packaged (MSIX) Claude Desktop. The runner (36096) is a child of **WmiPrvSE** (4476), Claude Code (20092) a child of the runner. So WMI's `Win32_Process.Create` works from a packaged app's server: the remaining P7 check is done.
- **No "detached child" note:** that note is written only when `launched_by` is `spawn`; it is `wmi`. `docs\P8_run.err` is empty.
- **Odd things:** (a) this session sees `cds-workbench` too (Dan's user-scope Claude Code setup adds both CDS servers to every session), so the phase tools exist inside a phase; they aren't in its allowed tools, so a call would be refused under `acceptEdits` in `-p` (none was made); (b) the harness blocks a foreground `sleep` (`sleep 45` was refused, "use Monitor with an until-loop"), so waiting here was done with `until ...; do sleep 5; done` loops and polling, never by ending the turn; (c) this session's own Bash tool still has the 10-minute foreground ceiling (it was started by the P7 copy, without `BASH_MAX_TIMEOUT_MS`), so the 17-minute sandbox was started in the background and polled in the same turn, as the prompt allows; (d) no permission denials in this run (136 tool calls when checked).

## 5. Version 1.6.0 and the build

Bumped in `Directory.Build.props`, `Installer\setup.nsi`, `mcp-server\package.json`, `mcp-server\manifest.json`, `review-server\package.json`, `VSExtension\CdsVsBridge\source.extension.vsixmanifest`, `CdsVsBridgePackage.cs` (and the sandbox kit's `$ExpectVersion`); `tools\check-versions.ps1`: "All 15 places say 1.6.0." (the built CLI included). `docs\releases\RELEASE_NOTES_v1.6.0.md`: P7 (running phases from chat: the four tools, what starting one does, the approval and safety lines from the README; the handoff file list and the Dashboard version, which v1.5.0 didn't have) and P8 (waiting, Monitor, the templates, the stop); Known: a run that doesn't end on Ctrl+C (or started by an older CDS or `run-phase.ps1`) is stopped by force with no handoff; Windows only; Monitor needs Git Bash on Windows; the first-install time. `build-setup.ps1` in the foreground: CLI, TrayApp, Dashboard, VSIX OK, both `npm ci` OK, runtimes cached and signed, versions OK, NSIS OK; **199.7 MB, SHA-256 `94591069B3D9A2B0EC86D4874F35480262C44752625F90EAD0EB77EF6F1A8337`, 2.4 min**. Warning counts from separate builds: CLI 33, TrayApp 14, Dashboard 0, VSIX 12 (CS0169 1, VSSDK006 1, VSTHRD010 8, VSTHRD110 1, VSTHRD200 1).

## 6. Tests

**Smoke `--cli`:** 156/156. The 9 new: Monitor in the default list (no bypass); `PHASE_ENV` (two variables, 60 min); `run-phase.ps1` (Monitor, both variables, no bypass, acceptEdits); the run's environment as the fake saw it, recorded in the `.json`, and `shares_console`; stop with Ctrl+C (the fake's one SIGINT, its SessionEnd marker, exit 0); its Ctrl+C-ignoring child gone, the bystander alive, the interrupted result in the log; Status's Ctrl+C line; the stubborn fake (two presses, force, everything gone); Status's force line. One P7 check's pattern widened from `STOPPED \(by request\)` to `STOPPED \(by request`. **Installed copy:** 110/110 (skips named). **Sandbox:** below.

**Sandbox** (`tools\sandbox-test\run-sandbox-test.ps1`, offline, A–F, the P6 time limits; started at 10:57 in the background and polled in this same turn with foreground `until` loops, since this session's foreground commands are capped at 10 minutes): run `results\20261112-105710`, installer SHA-256 printed by the runner `94591069B3D9A2B0EC86D4874F35480262C44752625F90EAD0EB77EF6F1A8337` (= the build), expects version 1.6.0.

| Scenario | Checks | Result |
|---|---|---|
| A fresh install (seeded config, long PATH) | 16 | PASS |
| B upgrade (keeps a test API key) | 9 | PASS |
| C uninstall | 9 | PASS |
| D again, Documents redirected | 10 | PASS |
| E Claude Code setup/remove, hooks, `/CLAUDECODE=1` | 16 | PASS |
| F no Claude Desktop yet; a packaged config copy | 15 | PASS |
| **Total** | **75** | **75 passed, 0 failed**, 17.8 min |

Inside it, the installed copy's smoke (a new Windows user, the installed `index.js`, `workbench.js`, `cds-phase.js` and CLI): **A 153/153** (the two "older entries" checks and run-phase.ps1's skipped, as on any installed copy), **D 155/155**, so the gentle stop (Ctrl+C into a WMI-started console) and the fallback also passed on a clean Windows. `results.json` is saved there (gitignored). One difference from P7's run: the runner printed "The sandbox did not shut down by itself; closing it." (it closed it; no `vmmemWindowsSandbox` left running afterwards).

## Not done, and why

- **Not stopped from the packaged Claude Desktop itself.** This session was started from it (section 4), but stopping it would end this phase; the Ctrl+C helper ran from the source workbench over MCP stdio (a Node parent, as under Claude Desktop). The first `claudedev_phase_stop` from Claude Desktop after 1.6.0 is installed is the check; if `AttachConsole` were refused there, Stop falls back to force and says why.
- **`run-phase.ps1` runs keep the force stop** (their Claude Code has its own console; the script starts it through `cmd.exe` and `Start-Process -WindowStyle Hidden`). The tools replace that script.
- **The automatic handoff after a Ctrl+C names "[Request interrupted by user for tool use]" as the last request** (the hook takes the last user message). Harmless and true, but a later `cds-hook.js` change could skip that synthetic line; `cds-hook.js` wasn't in this prompt's scope.
- **No deploy, tag or release** (the prompt).
