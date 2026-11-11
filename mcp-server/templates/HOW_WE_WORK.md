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

## Where ClaudeDevStudio fits

- **At the start:** `claudedev_load` with the project folder. It shows the last handoff, the Status and Next from the ground truth, the newest output, and the mistakes and decisions recorded so far.
- **Before a risky step:** `claudedev_check_mistake` with the plan.
- **As you go:** `claudedev_record_activity` for work done; `claudedev_record_mistake` with the lesson when something goes wrong; `claudedev_record_decision` with the reason when you choose between options.
- **Before you stop:** `claudedev_handoff`: where you stopped, the next step, and the open questions.

## Why

- **Continuity:** any session, today or next month, picks up where the last one stopped, without the owner explaining it all again.
- **Honesty:** every claim in an output comes with its evidence, and anything not verified says so.
- **Fewer tokens:** one short file to read instead of a long history; the same result costs less.
