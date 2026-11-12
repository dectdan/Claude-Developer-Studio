# {{PROJECT}} — How We Work

*The loop this project uses with Claude. Created {{DATE}}.*

---

## The loop

1. **Plan.** A planning session (the owner with Claude) reads `docs\GROUND_TRUTH.md` and writes the next prompt, `docs\Pn_prompt.md` (P1, P2, ...), with these sections:
   - **Identity:** the project, where it lives, what to load first.
   - **Why:** the problem this phase solves.
   - **Read first:** the files to read before changing anything.
   - **Scope:** the files that may change, the new files, and the files never touched.
   - **Conventions:** this phase's rules, on top of `docs\CONVENTIONS.md`.
   - **The work:** numbered items, each specific enough to check.
   - **Verification:** the builds, tests and checks that prove it.
   - **Questions:** what the phase decides by itself (the safest reading that keeps the rules, written down in the output) and when it stops to ask instead: only for a real decision, with a `QUESTION:` block (see "Asking a question" below).
   - **On completion:** the output file, the ground truth update, the commit.
2. **Do.** Claude Code carries out the prompt and writes `docs\Pn_OUTPUT.md`:
   - first, anything the owner must do;
   - the results, each with its evidence (command output, counts, file names);
   - the decisions it made where the prompt was silent, and why;
   - what wasn't done, and why.

   Then it updates the ground truth: a Status line, the Plan, the Prompt history.
3. **Check.** The planner verifies the output against the prompt (reads the changed files, reruns a check), then writes the next prompt.

One prompt, one concern. A prompt that grows too big becomes two phases.

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

## Where ClaudeDevStudio fits

- **At the start:** `claudedev_load` with the project folder. It shows the last handoff, the Status and Next from the ground truth, the newest output, and the mistakes and decisions recorded so far.
- **Before a risky step:** `claudedev_check_mistake` with the plan.
- **As you go:** `claudedev_record_activity` for work done; `claudedev_record_mistake` with the lesson when something goes wrong; `claudedev_record_decision` with the reason when you choose between options.
- **Before you stop:** `claudedev_handoff`: where you stopped, the next step, and the open questions.

## Why

- **Continuity:** any session, today or next month, picks up where the last one stopped, without the owner explaining it all again.
- **Honesty:** every claim in an output comes with its evidence, and anything not verified says so.
- **Fewer tokens:** one short file to read instead of a long history; the same result costs less.
