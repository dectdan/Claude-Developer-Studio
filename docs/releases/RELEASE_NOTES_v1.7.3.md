# ClaudeDevStudio v1.7.3

Load points Claude at your project's rules, and the rules CDS gives a new project now carry the whole way of working. Your memory and how CDS stores it don't change.

## Changed

- **Load points at the rules.** When a project has `HOW_WE_WORK.md` and/or `CONVENTIONS.md` (in `docs\` or at the root), `claudedev_load` and the Claude Code session-start hook print one line naming them, to read before changing anything. Ordinary chats and Claude Code sessions now find the rules, not only phases.
- **The templates carry the full method.** `claudedev_scaffold`'s `HOW_WE_WORK.md` adds: starting a session (`Load CDS for <project folder>` in Claude Desktop), working in a chat with the owner (proceed when the task is clear, ask one question at a time, one example then ask, no unsolicited features), the prompt's header and stop line, the output checklist, what to do when a session stops early, and where project facts and personal preferences each belong. `CONVENTIONS.md` says why backups have no exceptions, and to build or verify after every task, one task at a time. `GROUND_TRUTH.md` says it is the current state, not a log, and its Status is one paragraph.
- **Using CDS in a Claude Desktop project:** add `Load CDS for <project folder>` to the project's instructions; the rules come from the project's own files (README).

## Upgrading

Run the installer over v1.7.2. It backs up your whole memory store first, as before. Projects that already have these files keep them: the scaffold never overwrites. To use the new templates in such a project, compare its files with the ones in `%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\templates\`.
