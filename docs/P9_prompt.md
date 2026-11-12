# ClaudeDevStudio — P9 (Claude Code Prompt)
# Three phase modes (manual, collaborative, delegated), questions that come back cleanly, a Phases page and a notification, Claude Code setup that just works; the v1.6.0 build (nothing is published here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop and Claude Code, from Gain Publications (Dan). It's **free, MIT, and public**; strangers install it. v1.5.0 is released; P7 (phase tools) is deployed on Dan's PC; P8 (waiting, templates, stop, the first v1.6.0 build) is done in source.

This session was started with `claudedev_phase_start` from Claude Desktop and already has the project's context.

**You are running unattended.** Nobody can answer questions while it runs. When something isn't covered here, take the safest reading that keeps the rules below, write it under "Decisions I made" in `docs\P9_OUTPUT.md`, and carry on.

**Long steps run in the foreground** (builds, the sandbox: ~17 minutes; give the command a long enough timeout, or poll in the same turn). **Never end your turn to wait for a background task. Only end your turn after the push.**

---

## Why: Dan's decision (2026-11-12, recorded as DEC002)

A phase can be run three ways, and the user chooses:

1. **Manual:** the user hands the prompt to Claude Code themselves and watches it. CDS opens a normal, visible Claude Code window in the project with the prompt ready; the user sees everything and approves things as Claude Code asks. Afterwards chat-side Claude reads the output as usual.
2. **Delegated:** chat-side Claude starts it headless and answers every question itself (how CDS itself has been built: Dan handed the decisions to Claude). The user gets the results.
3. **Collaborative — the default, and the best:** headless. When the phase asks something, chat-side Claude answers it itself if the answer is clear from the bigger picture, and tells the user what it answered and why; a real decision is brought to the user, discussed, and the user's answer is sent back with `claudedev_phase_reply`.

Dan's reason, in his words: "the chat side that's actually doing what we're doing right now has the bigger picture. It has a lot of conversation. It has the ground truth… It has other references, and it can talk to me about it. Claude Code just doesn't. And quite frankly, it… compacts fairly regularly because it's doing a lot of work." A phase's questions often come from not knowing the plan.

**The rule for "obvious" (write it where chat-side Claude reads it: the tools' descriptions or results, the server instructions, the templates):** Claude answers itself when the answer follows from the ground truth or decisions already made, is easily undone, and is technical. It goes to the user when it changes scope, cost or the product's direction, can't be undone, or is a matter of taste. Either way, chat-side Claude tells the user what was asked and what was answered.

Also from Dan: **the Claude Code integration is a core feature**, so setting it up should be the default when Claude Code is present, and a new user should not have to jump through the hoops we did (install Claude Code, sign in once, restart Claude Desktop, tick a box).

---

## Read first

1. `docs\GROUND_TRUTH.md` in full; `docs\P7_OUTPUT.md` and `docs\P8_OUTPUT.md`.
2. `mcp-server\cds-phase.js`, `workbench.js`, `index.js` (the instructions text), `mcp-server\templates\*`, `Installer\setup.nsi`, `Installer\cds-claude-code.js`, the tray app (`ClaudeDevStudio.UI`), the Dashboard project (its pages and navigation).
3. Claude Code's current docs (cite URLs) for anything you rely on: starting an interactive session with an initial prompt in a new window, `--resume` in an interactive window, how a session's transcript is stored (for Manual mode's status), how to check whether Claude Code is signed in without starting a session, the official install command for Windows.

## Scope

- **Modified:** `mcp-server\cds-phase.js`, `workbench.js`, `index.js` (instructions text only), `mcp-server\templates\*`, the tray app, the Dashboard, `Installer\setup.nsi`, `Installer\cds-claude-code.js`, the CLI if needed (`claude-code status`), tests, version files if needed, `README.md`, `mcp-server\README.md`, `docs\releases\RELEASE_NOTES_v1.6.0.md` (extend P8's), `docs\GROUND_TRUTH.md`.
- **New:** whatever the work needs, named in the output; `docs\P9_OUTPUT.md`.
- **Never touched on this PC:** Dan's `~/.claude/settings.json`, `~/.claude.json`, `%APPDATA%\Claude\claude_desktop_config.json`; the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`; Dan's memory store (apart from the smoke test's throwaway roots and what the hooks record); any `qwen_config.json`; Dan's other projects; `D:\websites`. Real Claude Code runs only in throwaway projects in `%TEMP%` with `claude-haiku-5-5` / `low`, removed afterwards with their memory folders.

## Conventions

- Back up any tracked file before editing it (`.bak_YYYYMMDD_HHMM`). Never `--dangerously-skip-permissions` or `bypassPermissions`.
- Builds: 0 errors, no new warnings (as P8 left them). NSIS 0.
- The repo is public: no keys, no personal data, no paths from this PC in shipped files.
- **Don't deploy, tag or release.** The version stays 1.6.0 (P8's), unless you find a reason; say so.

---

## The work

### 1. The three modes

- `claudedev_phase_start` gets `mode`: `collaborative` (default), `delegated`, `manual`. It is recorded in `docs\<phase>_run.json` and shown by Status.
- **Collaborative and delegated** run headless as today. The difference is what chat-side Claude does with a question, so each start/status result says it plainly in one or two lines: collaborative → "answer it yourself only if it follows from the ground truth or what's already decided, is easily undone and technical; otherwise put it to the user with the options and your recommendation; either way tell the user what was asked and answered"; delegated → "answer it yourself and tell the user afterwards".
- **Manual** opens a **visible** Claude Code window in the project (Windows Terminal if present, else a console), interactive, with the prompt as its first message, in Claude Code's normal permission mode for the user (no `acceptEdits` forced: the user approves). The lock still holds the project; Status reports what it can (that the window is open, the session's transcript if you can find it from the docs, `Pn_OUTPUT.md` when written); Stop asks the user to close the window or ends it. If an interactive start with a first message isn't possible from the docs, say so and open the window in the project with the exact line to paste.
- Every finished phase gets a one-line "open it" hint in Status: `claude --resume <session id>` in the project (read the whole conversation, or take over).

### 2. Questions that come back cleanly

- The templates (`HOW_WE_WORK.md`, and the phase-writing section P8 added) tell a phase how to ask when it truly needs a decision: end the turn with a block that starts `QUESTION:` then the question in one or two sentences, then numbered options (`1.`, `2.`, …) each with a one-line consequence, and the option it would pick and why. Not a question when the prompt's rules already decide it.
- Status recognises that block (and still the old heuristic) and returns the question and options **verbatim and separately** from the rest, so chat-side Claude can relay them faithfully.
- Phase prompts the producer writes from now on carry the same rule (put it in the template's prompt skeleton if P8 added one).

### 3. A Phases page and a notification

- **Dashboard:** a "Phases" page. Pick a project (recent ones from memory, or browse); it lists its phases (`docs\*_run.json`), and for one phase shows Status's summary and the **conversation as readable text** from `docs\<phase>_run.log` (Claude's messages in full; tool calls condensed to one line each with the tool and target; results collapsed; a `QUESTION:` block highlighted), refreshing while it runs (a timer or file watch; read the log with shared access). Buttons: **Stop**, **Open in Claude Code** (`claude --resume <id>` in a visible window in the project), **Open folder**. It never answers a question itself: answers go through chat-side Claude (or the user's own Claude Code window).
- **Tray notification:** when a phase in any project the tray knows of finishes, ends on a question, stops or fails, a Windows notification says which project and phase and what happened ("P9 asks a question", "P9 finished: OUTPUT written"), clicking it opens the Phases page on it. The tray finds runs by watching recent projects' `docs\*_run.json` (or a small index the runner writes at start under `%LOCALAPPDATA%\ClaudeDevStudio\phases.json`; your choice; say why). Off switch in the tray menu.
- Look at both on screen if you can (a screenshot of the Dashboard page against a real finished phase log, e.g. this repo's `docs\P7_run.log` read-only) and describe what you saw.

### 4. Claude Code setup that just works

- **Installer:** detect Claude Code (`where claude`, `%USERPROFILE%\.local\bin\claude.exe`, version). If found and ≥ 2.1: the "Also set up Claude Code" box is **ticked by default** (still visible, the user can untick); silent installs set it up when Claude Code is found unless `/CLAUDECODE=0`. If not found: the box is replaced by one line saying Claude Code isn't installed and how to get it (the official install command or page from the docs), and that the tray app can set it up later.
- **`claudedev claude-code status` and the tray app** say plainly which of these holds: not installed, too old (version), installed but not signed in (if detectable without starting a session; else say "sign in once by running `claude`"), CDS not set up in it, ready. The tray's menu item offers the next step for each (open the install page, open a terminal running `claude` to sign in, set up).
- **The phase tools' refusals** (no Claude Code, too old, not signed in if detectable) point at the same next steps, including "restart Claude Desktop" when Claude Code was installed after it.
- Sandbox scenario E covers the new default (setup when Claude Code is present is simulated as P4 did; with no Claude Code the finish text says how to get it).

### 5. Tests and build

- **Smoke `--cli`:** everything from P8 plus: mode recorded and reported; the collaborative/delegated guidance text; `QUESTION:` parsing (question, options, recommendation; and a non-question); manual mode's command (with the fake: a visible-window launcher is replaced by a test hook) and its lock; the "open it" hint; `claude-code status` states (with fakes).
- **One real run** (throwaway project, Haiku, low): collaborative, a prompt that ends with a `QUESTION:` block; Status shows it verbatim; reply; finished. Manual mode: open the window once, check it appears with the prompt (describe; close it), then remove the throwaway project and its memory.
- **The tray and Dashboard:** build 0 errors, no new warnings; a smoke or unit check for the log-to-conversation formatter against a fixture.
- Build the installer **in the foreground**; **sandbox offline A–F in the foreground**; all PASS; the SHA-256 matches.

---

## Verification

- Builds 0 errors, no new warnings; NSIS 0; `check-versions.ps1` all 1.6.0.
- Smoke `--cli` all pass; installed-copy run passes what it can, names what it skips.
- The real runs, the screenshots' description, the sandbox table and SHA-256.
- No bypass flag anywhere; no Dan-specific paths in shipped files.

## On completion

1. **`docs\P9_OUTPUT.md`:** first, what the producer must do (review; deploy or install; publish v1.6.0 with the SHA-256 and the notes; test on machine 3). Then "Decisions I made", docs facts with URLs, each item with evidence, the real runs, what was seen on screen, the sandbox table, anything not done and why.
2. **`docs\GROUND_TRUTH.md`:** §2 (a "P9 done" line and **Next**: the producer tests on machine 3 and publishes v1.6.0, then W), §4, §5 (Dan's DEC002), §7, §9 (P9 ✓), §10, §11, §12, "Last updated".
3. **Commit** `P9: phase modes (collaborative default), questions that come back cleanly, Phases page and notifications, Claude Code setup by default`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.** No tag, no release. **Only end your turn after the push.**

=== P9 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
