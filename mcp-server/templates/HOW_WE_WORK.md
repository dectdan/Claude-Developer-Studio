# {{PROJECT}} — How We Work

*The loop this project uses with Claude. Read it, and `docs\CONVENTIONS.md`, before changing anything. Created {{DATE}}.*

---

## Starting a session

- **In Claude Code,** ClaudeDevStudio loads by itself when the session starts.
- **In Claude Desktop,** say `Load CDS for <project folder>` first. Or put that one line in the Desktop project's instructions: it replaces any pasted copy of these rules, which live here and in `docs\CONVENTIONS.md`.
- Then read `docs\GROUND_TRUTH.md` before asking anything about where the project stands.

## Working in a chat with the owner

- **Proceed when the task is clear.** Don't ask permission for steps the task already defined (running the build, reading a file).
- **Stop for problems, not routine steps.** When something comes up that the task didn't cover, a problem or an ambiguity, stop and say so.
- **Ask, don't assume.** "I think you want X, but you might mean Y: which?" is better than a guess. When there are several ways to do it, present them.
- **One question at a time, then wait.** Ask the one question needed to go on, and wait for the answer. No answers prepared for hypothetical answers.
- **One example, then ask.** For a change across several files, make one complete example, explain the pattern, and ask before doing the rest.
- **No unsolicited features.** Don't add, remove or change architecture unasked. When you see an opportunity, ask: "Would you like me to also handle X?"
- **Say at once what you don't know,** and when you may be working from an older copy of a file, read the current one.
- **Exception:** a risk of data loss or a critical bug: act at once, explain after.

**A phase is different.** A phase (below) does its whole defined scope without stopping to check in, and asks only with a `QUESTION:` block, when it truly needs a decision.

## The loop

1. **Plan.** A planning session (the owner with Claude) reads `docs\GROUND_TRUTH.md` and writes the next prompt, `docs\Pn_prompt.md` (P1, P2, ...), with these sections:
   - **Header:** `# <Project> — Pn (Claude Code Prompt)`, then a one-line description of the task.
   - **Identity:** the project, where it lives, what to load first.
   - **Why:** the problem this phase solves.
   - **Read first:** the files to read before changing anything, and what to find in each. The phase checks that what it should find is there, and stops only if something is missing or doesn't match.
   - **Scope:** the files that may change, the new files, and the files never touched.
   - **Conventions:** this phase's rules, on top of `docs\CONVENTIONS.md`.
   - **The work:** numbered items, each specific enough to check.
   - **Verification:** the builds, tests and checks that prove it.
   - **Questions:** what the phase decides by itself (the safest reading that keeps the rules, written down in the output) and when it stops to ask instead: only for a real decision, with a `QUESTION:` block (see "Asking a question" below).
   - **On completion:** the output file, the ground truth update, the commit.
   - **The stop line,** the prompt's last line, with nothing after it: `=== Pn COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===`. It keeps the phase from going on to the next logical step before this one is reviewed.
2. **Do.** Claude Code carries out the prompt and writes `docs\Pn_OUTPUT.md` (see "The output" below). Then it updates the ground truth to the new current state: Status and Next, and the phase's row in the Plan.
3. **Check.** The planner reads the output, not what it expected to happen: it verifies the output against the prompt (reads the changed files, reruns a check), then writes the next prompt.

One prompt, one concern. A prompt that grows too big becomes two phases.

## The output

`docs\Pn_OUTPUT.md`, beside the prompt:

- first, anything the owner must do;
- the date and the files changed;
- the build result (errors, warnings) or the test result;
- each change, checked against the prompt, with its evidence (command output, counts, file names);
- deviations from the prompt: what, why, and who agreed;
- the decisions it made where the prompt was silent, and why;
- limitations accepted for now;
- runtime tests, or "not tested" said plainly;
- what wasn't done, and why;
- that the ground truth was updated.

## Writing and running a phase

- **The prompt names four things:** its scope (the files it may change and create), what it must never touch, how to verify the work, and its output file (`docs\Pn_OUTPUT.md`).
- **Long steps stay in the foreground.** Builds, installers and test suites run as foreground commands with a timeout long enough for them, or are started and then checked in a loop in the same turn. A phase never ends its turn to wait for something running in the background: nobody is there to wake it up, and the work is left half done.
- **Asking a question.** When the phase truly needs a decision, it ends its turn with a block like this, and stops there:

  ```
  QUESTION: Should the export keep the old file names, or switch to the new scheme?
  1. Keep the old names: nothing else changes; the inconsistency stays.
  2. Switch to the new scheme: consistent, but two scripts that read the old names must change too.
  RECOMMENDATION: 2, because the two scripts are in this phase's scope anyway.
  ```

  The question in one or two sentences; numbered options, each with its consequence in one line; the option it would pick and why. It is not a question when the prompt's rules already decide it: then the phase decides, and says so in its output.
- **Running it from a chat** (Claude Desktop with ClaudeDevStudio, Windows), in one of three modes:
  - **Collaborative** (the default): Claude Code runs headless. When it asks something, Claude in the chat answers by itself only when the answer follows from the ground truth or decisions already made, is easily undone, and is technical; anything that changes the scope, the cost or the product's direction, can't be undone, or is a matter of taste goes to the owner, with the options and a recommendation. Either way, the chat says what was asked and what was answered.
  - **Delegated:** headless; Claude in the chat answers every question itself and tells the owner afterwards.
  - **Manual:** a Claude Code window opens in the project with the prompt as its first message; the owner watches it and approves what it asks.

  1. `claudedev_phase_start` with the project folder, the phase (for example `P3`) and the mode. It starts Claude Code on `docs\P3_prompt.md`.
  2. `claudedev_phase_status` every 15 to 20 minutes: running or finished, what it is doing, any refused tools, and a `QUESTION:` block word for word.
  3. If it finished with a question, answer it as the mode says, with `claudedev_phase_reply`.
  4. If it goes wrong, `claudedev_phase_stop`.
  5. When it has finished, read `docs\P3_OUTPUT.md` and check the work before writing the next prompt. Status's "Open it" line (`claude --resume <session>`) opens the whole conversation in Claude Code.

## When a session stops early

A context limit, a crash, a lost connection or a stopped phase can end a session before its work is done. Don't assume it left things clean:

1. Load the project (`claudedev_load`). For a phase, `claudedev_phase_status` shows where it stopped.
2. Read the ground truth, the prompt, and every file the prompt touched, as it is now on disk.
3. Check the build: does it build and run right now, or is it broken?
4. Tell the owner what was done, what wasn't, and the state of the build.
5. Wait for the owner to choose: continue the same prompt, or a new prompt for the rest.

## Two memories

- **Project facts go to ClaudeDevStudio:** decisions and why (`claudedev_record_decision`), mistakes and their lessons (`claudedev_record_mistake`), where work stopped (`claudedev_handoff`).
- **The owner's own preferences** (how they like to work, across projects) go to the chat's memory.
- **Keep both sparse:** nothing that a file already says. A memory that only grows costs every session more; when it feels long, trim what no longer matters.

## Where ClaudeDevStudio fits

- **At the start:** `claudedev_load` with the project folder (Claude Code does it by itself). It shows the last handoff, the Status and Next from the ground truth, the newest output, the mistakes and decisions recorded so far, and points at these rules.
- **Before a risky step:** `claudedev_check_mistake` with the plan.
- **As you go:** `claudedev_record_activity` for work done; `claudedev_record_mistake` with the lesson when something goes wrong; `claudedev_record_decision` with the reason when you choose between options.
- **Before you stop:** `claudedev_handoff`: where you stopped, the next step, and the open questions.

## Why

- **Continuity:** any session, today or next month, picks up where the last one stopped, without the owner explaining it all again.
- **Honesty:** every claim in an output comes with its evidence, and anything not verified says so.
- **Fewer tokens:** one short file to read instead of a long history; the same result costs less.
