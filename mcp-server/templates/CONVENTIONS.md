# {{PROJECT}} — Conventions

*How code gets written in this project. Read it, and `docs\HOW_WE_WORK.md`, before changing anything. Created {{DATE}}.*

---

## Before editing

- **Read the current file before editing it.** Files change between sessions and between prompts; don't work from memory or from an older copy.
- **Back up a file before editing it:** a copy beside it named `<file>.bak_YYYYMMDD_HHMM` (the time stamp sorts the copies). This rule was set after weeks of work were lost to edits that couldn't be undone. It has no exceptions. Keep the copies out of git (add `*.bak_*` to `.gitignore`).
- **Confirm the text you are replacing** is really there, once, before you replace it.
- **Change only what was asked.** If you find something else wrong, write it down and say so; don't fix it unasked.
- **Small changes, not rewrites.** Respect working code; rewrite only when asked.

## One task at a time

- **Build or verify after every task.** A compiled project: build it, 0 errors. Otherwise: run the tests or the linter. A task is not done until its check passes.
- **Finish one task before starting the next.** Don't begin the next logical step while the current one is unchecked.

## Before saying it's done

- **Verify:** the build has 0 errors and no new warnings, and the tests pass. Run them; don't assume.
- **Report what wasn't done, and why.** Never report a success you didn't check.
- **Say how you checked:** the command, its result, the counts.

## Safety

- **No secrets in the repository:** keys, tokens and passwords stay out of git, and so do files that hold them.
- **Ask the owner before anything that can't be undone:** deleting data, rewriting history, force-pushing, publishing, deploying, or sending anything off this computer.
- **Back up data before changing it.** Code is in git; data often isn't.

## Project-specific rules

*This project's own rules: the build command and how to run it (for example "kill the app first"), code style, naming, folders never to touch, the test commands, anything that has bitten before.*
