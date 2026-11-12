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
- **Running it from a chat** (Claude Desktop with ClaudeDevStudio, Windows):
  1. `claudedev_phase_start` with the project folder and the phase (for example `P3`). It starts Claude Code on `docs\P3_prompt.md`.
  2. `claudedev_phase_status` every 15 to 20 minutes: running or finished, what it is doing, any refused tools.
  3. If it finished with a question, answer with `claudedev_phase_reply`.
  4. If it goes wrong, `claudedev_phase_stop`.
  5. When it has finished, read `docs\P3_OUTPUT.md` and check the work before writing the next prompt.

## Where ClaudeDevStudio fits

- **At the start:** `claudedev_load` with the project folder. It shows the last handoff, the Status and Next from the ground truth, the newest output, and the mistakes and decisions recorded so far.
- **Before a risky step:** `claudedev_check_mistake` with the plan.
- **As you go:** `claudedev_record_activity` for work done; `claudedev_record_mistake` with the lesson when something goes wrong; `claudedev_record_decision` with the reason when you choose between options.
- **Before you stop:** `claudedev_handoff`: where you stopped, the next step, and the open questions.

## Why

- **Continuity:** any session, today or next month, picks up where the last one stopped, without the owner explaining it all again.
- **Honesty:** every claim in an output comes with its evidence, and anything not verified says so.
- **Fewer tokens:** one short file to read instead of a long history; the same result costs less.
