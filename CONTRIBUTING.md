# Contributing

This is a small demo. Issues and PRs are welcome.

- Run `pnpm test` before you open a PR. Run `pnpm test:db` if you touch `db/`.
- Run `pnpm eval --profile core` if you change the prompt, tools or booking flow.
- Run `pnpm typecheck && pnpm lint`.
- Keep secrets out of commits. Put them in `.env` (gitignored). Use placeholders in templates.
- Follow the rules in [docs/build-process/CLAUDE.md](docs/build-process/CLAUDE.md).
- Do not claim a measurement or an integration you did not run end to end.
