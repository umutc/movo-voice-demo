# Build process

A coding agent built this project from three files in this folder:

- `PRD.md`: the required behavior.
- `CLAUDE.md`: the implementation rules the agent followed.
- `TASKS.md`: the task list, in execution order, with progress marks.

`demo-script.md` is the script for the demo recording.

The root `CLAUDE.md` imports `CLAUDE.md` from this folder, so Claude Code
still loads the rules. Paths inside these files are relative to the repo root.
