# movo-voice-demo

A weekend prototype of a conversational voice agent for youth sports academy enrollment. A parent
talks to "Maya" (an AI enrollment assistant for the fictional Brooklyn Youth Soccer Academy) by
browser or phone, finds a program for a child aged four to fourteen, and books a free trial class.

This is a prototype built as a credibility demo. It has production shape (ports, transactional
writes, identity rules, tests, evals, tracing) and prototype scope (one academy, synthetic data, free
tiers). It is not production software.

## Status

| Phase | State | Commit |
|---|---|---|
| 0 Accounts and local setup | done, OpenAI billing pending | `3d3df1f` |
| 1 Scaffold and hello-world agent | done | see git log |
| 2 Database | done | see git log |
| 3 Context, tools, prompt, memory | todo | |
| 4 Browser demo | todo | |
| 5 Interruption, metrics, tracing | todo | |
| 6 Scenario eval | todo | |
| 7 Inbound phone | todo | |
| 8 Hardening, deploy, docs | todo | |

Verified end to end so far: LiveKit worker registration, text and audio conversations through
`lk agent debugger`, migrations, seed and booking semantics on real Postgres (`pnpm test:db`), one
Braintrust span.

## Architecture

See `PRD.md` section 4 for the diagram. In short: LiveKit Cloud room, Node.js agent worker
(`@livekit/agents` 1.9.5), LiveKit Inference for STT, LLM and TTS, Supabase Postgres through
Drizzle, Braintrust for traces and evals.

## Setup

1. Install mise, then `mise install` in the repo (Node 24, pnpm 12).
2. `brew install livekit-cli`, then `lk cloud auth`.
3. `cp .env.example .env` and fill the lines marked FILL. Never commit `.env`.
4. `pnpm install`.
5. `pnpm db:generate && pnpm db:migrate && pnpm db:seed` (Phase 2).
6. `pnpm -F agent dev` to run the worker locally.
7. `pnpm -F web dev` for the browser demo (Phase 4).

## Commands

```
pnpm -F agent dev          # worker against LiveKit Cloud (the SDK prefers `lk agent dev`)
pnpm -F agent console      # talk to the agent from the terminal (mic or text)
pnpm typecheck && pnpm lint
pnpm test                  # behavior tests, fakes only
pnpm test:db               # real adapter against TEST_DATABASE_URL
pnpm eval --profile core   # Braintrust scenario eval, fakes only
pnpm report:latency        # p50/p95 from metrics/*.json
pnpm telephony:render      # ${ENV} templates -> telephony/out/ (gitignored)
```

Debugging a conversation without audio, from `agent/`:

```
lk agent debugger start src/agent.ts
lk agent debugger say "Hi, I want to sign up my daughter."
lk agent debugger stop --chat-history
```

## Decisions

- 2026-11-07: LLM default is `openai/gpt-6.1-terra` (PRD said gpt-5.4-mini, which is a generation older and costs more on LiveKit Inference: 0.75/4.50 vs 1.00/5.00 USD per million tokens, but Terra is the current balanced tier). `openai/gpt-6-luna` (0.10/0.50) is the documented cheap swap. Eval judge: `gpt-6.1-terra`; simulated caller: `gpt-6-luna`.
- 2026-11-07: No `@livekit/agents-plugin-silero` or `-livekit`. The SDK bundles `inference.VAD({ model: 'silero' })` and `inference.TurnDetector()` (cloud EOT with local fallback). Dropping the plugins removed `onnxruntime-node` (85 MB) and all 8 high audit findings (adm-zip, sharp via `@huggingface/transformers`).
- 2026-11-07: `DIRECT_DATABASE_URL` points at the Supabase session pooler (port 5432), not the IPv6-only direct host, because this machine has no global IPv6. Same credentials, session mode, fine for migrations.
- 2026-11-07: `TEST_DATABASE_URL` is schema `test` on the same Supabase project via `?options=-c search_path=test`, not a local container.
- 2026-11-07: Relative imports use `.ts` extensions (`allowImportingTsExtensions`, `erasableSyntaxOnly`), so plain `node` (type stripping) and `tsx` both run the same files. `lk agent debugger` launches the agent with plain `node`.
- 2026-11-07: `config.ts` loads the repo `.env` itself when LiveKit variables are absent, so `lk agent dev|console|debugger` work without `--env-file`.
- 2026-11-07: Build scripts allowed in `pnpm-workspace.yaml` after reading each script: esbuild, protobufjs, sharp, @livekit/blingfire, @livekit/local-inference. `braintrust` (downloads a `bt` CLI binary) and `autoevals` (pnpm guard) stay blocked; the SDKs work without their scripts.

## SDK notes

Installed: `@livekit/agents` 1.9.5, `@livekit/rtc-node` 1.2.1, `livekit-server-sdk` 2.19.2,
`zod` 4.6.7, `drizzle-orm` 0.45.4, `postgres` 3.4.9, `braintrust` 3.43.0, `autoevals` 0.4.1,
`vitest` 4.1.12, `typescript` 5.9.3. CLI: `lk` 2.19.3.

- Agent definition: `defineAgent({ entry, prewarm?, onSessionEnd? })` as the default export, plus
  `cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName }))` guarded by
  `process.env.VITEST`. Subcommands: `dev`, `start`, `console`, `connect`, `download-files`.
- Session: `new AgentSession({ vad, stt, llm, tts, turnHandling, ttsTextTransforms, userData })`.
  `session.start({ agent, room: ctx.room })` connects the room itself when it is not connected yet.
- Models: `new inference.STT({ model, language })`, `new inference.LLM({ model })`,
  `new inference.TTS({ model, voice, language })`; string shorthands `provider/model[:voice]` also
  work. Model ids verified on docs.livekit.io/agents/models on 2026-11-07.
- Turn handling: `turnHandling.turnDetection: new inference.TurnDetector()`, `interruption.mode:
  'adaptive'`, `endpointing.mode: 'dynamic'`, `preemptiveGeneration.enabled`.
- Agent: `Agent.create({ instructions, tools, onEnter, onExit, onUserTurnCompleted })`. Greeting
  via `session.generateReply({ instructions })` inside `onEnter`.
- Tools: `tool({ name, description, parameters: z.object(...), execute(args, { ctx }) })`;
  `ctx.userData` is the session user data, `ctx.session` the session.
- Testing API: `session.run({ userInput }).expect.nextEvent().isMessage(...)`,
  `.containsFunctionCall({ name, args })`, `.noMoreEvents()`, `withMockTools(Agent, {...})`,
  `voice.testing.FakeLLM`. An LLM judge lives in `MessageAssert.judge`.
- Metrics: `ChatMessage.metrics` (`MetricsReport`: `e2eLatency`, `llmNodeTtft`, `ttsNodeTtfb`,
  `endOfTurnDelay`, `transcriptionDelay`, `onUserTurnCompletedDelay`, `playbackLatency`) on the
  `conversation_item_added` event; `session_usage_updated` for usage.
- Telemetry: `telemetry.setTracerProvider(provider, { allowPii })`, `telemetry.tracer`,
  `setupCloudTracer`, `flushCloudTraces`. OTel SDK is bundled, so an OTLP exporter to Braintrust
  is possible without extra packages (checked in Phase 5).
- Participant kind: `@livekit/rtc-node` `ParticipantKind.SIP` (3); SIP attributes arrive as
  `participant.attributes['sip.phoneNumber']`.

## Gotchas

- `pnpm install` on pnpm 12 fails with `ERR_PNPM_IGNORED_BUILDS` until build scripts are reviewed.
  The `pnpm.onlyBuiltDependencies` field in `package.json` is ignored now; use `allowBuilds` in
  `pnpm-workspace.yaml` (true or false per package).
- `pnpm -F agent dev` prints "dev mode is deprecated ... use `lk agent dev`". It still works; the
  worker registers as `enroll-agent`.
- `lk agent debugger start src/agent.ts` runs the file with plain `node`, so `.js`-suffixed
  imports of `.ts` files fail with `ERR_MODULE_NOT_FOUND`, and `-- --env-file=.env` did not reach
  the process. Fixed by `.ts` import extensions and self-loading `.env` in `config.ts`.
- Supabase direct host is IPv6-only. Without IPv6 use the session pooler on port 5432.
- The Chrome-driven Supabase password reset: a first attempt leaked the generated password into a
  tool log because of a shell piping mistake, so the password was reset a second time. The live
  password exists only in `.env`.

- drizzle-kit 0.31 writes `REFERENCES "public"."families"` into generated SQL, which pins foreign
  keys to `public` even when the migration runs in the `test` schema. `pnpm db:generate` strips the
  `"public".` qualifier with `sed` after generating; re-check any new migration for it.
- `pnpm -F db <script>`: workspace bins live in `db/node_modules/.bin`, not the root. Call
  `drizzle-kit` by name in the package script, not by path.
- `drizzle-orm` `migrate()` prints a NOTICE object (`CreateSchemaCommand`) when the migrations
  schema already exists. Harmless.
- The `test` schema once had foreign keys to `public` tables (first migration, before the sed
  fix). Fixed by dropping and recreating the schema, then migrating again.

## Known gaps

- OpenAI account has no active billing yet (429 "account is not active"); the eval judge,
  simulated caller, and SDK LLM-judge tests cannot run until it is added.
- `pnpm audit --prod`: clean on 2026-11-07 after removing the two plugins and overriding `glob`
  and `minimatch`.

## Cost estimate

Filled in Phase 8 from PRD section 15 with stated assumptions.

## What production would need

Filled in Phase 8.
