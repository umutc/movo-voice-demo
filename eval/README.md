# Scenario eval

`pnpm eval --profile core` (also `sms`, `guardian`, `outbound`, `all`; `--only <id>`; `--no-braintrust`).

- `scenarios.yaml`: the 13 PRD 11.2 scenarios. `script` lines (`start`, `after_readback`, `next`) override the simulated caller for scenarios 5, 8 and 13. `expected` is a hard check: a goal score is capped at 0.4 when the final fake DB state contradicts it.
- `harness.ts`: real prompt, tools, proposal state machine and affirmation judge over fresh fakes; records the `ScenarioRun` from `session.run(...).events`.
- `simulated-caller.ts`: persona LLM (`openai/gpt-6-luna` on LiveKit Inference). `DONE` / `DONE REFUSED` ends a scenario.
- `scorers.ts`: goal judge (`LK_LLM_MODEL`), grounding and style (deterministic), invariants wrapper.
- `run.ts`: runs scenarios one by one, prints the scorecard, writes `out/last-run.json` (gitignored), exits 1 on failure. Braintrust gets a replay of the recorded results after the local scorecard prints, so an upload failure never hides it.

Grounding counts prices, clock times, weekdays and place names against tool outputs and the family memory block. Plain numbers (ages) may also come from caller turns. The `sms` and `guardian` profiles need their tools (not built yet); the harness only flips the feature flags.
