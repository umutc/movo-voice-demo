# CLAUDE.md

Guide for the coding agent working in this repo. Read docs/build-process/PRD.md (required behavior) and docs/build-process/TASKS.md (execution order and progress) before touching code. PRD wins on behavior, this file wins on implementation rules, TASKS wins on order.

## What this repo is

A weekend prototype of a conversational voice agent for youth sports academy enrollment ("Brooklyn Youth Soccer Academy", fictional). It is a demo built while preparing for a voice AI engineering role. Production shape, prototype scope. Never describe it as production in README or code comments.

## Stack (do not swap without a reason written in README)

- Runtime: Node 24 LTS pinned in `mise.toml` (the human uses mise, not nvm; Maintenance LTS until April 2028, best native-module coverage; Node 26 is acceptable only if `@livekit/rtc-node` and `sharp` have prebuilt binaries for it), pnpm 12 also pinned in `mise.toml`, TypeScript 5.9 strict, ESM, pnpm workspaces, `tsx` for running TS, Vitest 4 for tests
- Voice framework: `@livekit/agents` (LiveKit Agents for Node.js) + LiveKit Cloud
- Models: LiveKit Inference (single `LIVEKIT_API_KEY`), model ids configurable via env
- Telephony: LiveKit Phone Numbers (inbound, core). Twilio trial Elastic SIP Trunking (outbound, optional) and Twilio SMS (stretch)
- Database: Supabase Postgres via Drizzle ORM with the `postgres` (postgres.js) driver
- Observability and evals: LiveKit built-in testing API and Cloud insights, plus Braintrust (`braintrust`, `autoevals`)
- Frontend: LiveKit `agent-starter-react` template created with `lk app create`, lightly modified
- Validation: Zod for every tool schema and every env var

## Repo layout

```
movo-voice-demo/
  CLAUDE.md  README.md  docs/build-process/{CLAUDE,PRD,TASKS,demo-script}.md
  package.json  pnpm-workspace.yaml  .env.example  .gitignore
  agent/
    src/agent.ts         # entrypoint: dispatch handling, caller identification, session wiring, outbound dial
    src/prompt.ts        # system prompt builder (voice rules + memory injection)
    src/context.ts       # per-session context: identity source and trust level, bound familyId, pending booking proposal, call row id
    src/tools/*.ts       # one file per tool, Zod schema + handler, reads family from context only
    src/memory.ts        # family lookup, post-call summary write-back
    src/metrics.ts       # per-turn latency from ChatMessage.metrics -> JSON + Braintrust
    src/tracing.ts       # Braintrust logger / OTel export, span helpers
    src/config.ts        # env parsing (Zod), feature flags, conditional credential checks
    src/ports/           # interfaces: DbPort, SmsPort, DialPort + real adapters
    test/                # Vitest tests using the SDK testing API (session.run)
  db/
    schema.ts  seed.ts  drizzle.config.ts  migrations/  index.ts  fake.ts (in-memory DbPort for evals)  test/ (integration tests, isolated DB)
  eval/
    scenarios.yaml  run.ts  simulated-caller.ts  scorers.ts  invariants.ts
  scripts/
    call.ts              # outbound: dispatch agent into a room that dials a number (optional feature)
    report-latency.ts    # p50/p95 table from metrics/*.json
  telephony/
    dispatch-rule.template.json  outbound-trunk.template.json   # placeholders only, never secrets
  web/                   # LiveKit React starter + pre-call form
  design/                # static reference mockups (parent-*.html, console-*.html) + README.md with tokens; read before touching web/
```

## Pinned versions (checked on npm on 2026-11-07; re-run `npm view <pkg> version time.modified` before changing)

| Package | Pin | Why |
|---|---|---|
| `@livekit/agents` and every `@livekit/agents-plugin-*` (silero, livekit, deepgram, openai, cartesia) | exact `1.9.5` | plugins must match the core version; releases land every 1 to 2 weeks, so do not float; Apache-2.0, about 1.3M weekly downloads |
| `@livekit/rtc-node` | `^1.2.1` | peer of agents (native bindings, needs Node prebuilds) |
| `livekit-server-sdk` | `^2.19.2` | agents depends on `^2.15`; used for tokens, dispatch, SIP |
| `@modelcontextprotocol/client` | `^2.3.1` | declared peer of agents; install it so pnpm does not warn |
| `zod` | `^4.6.7` | agents peer range allows `^4.1.8`; use the zod 4 API |
| `drizzle-orm` / `drizzle-kit` | `^0.45.4` / `^0.31.11` | stable line; never the `1.0.0-rc.*` tags |
| `postgres` (postgres.js) | `^3.4.9` | 4.0.0 shipped 2026-10-29 as a new major; stay on 3.4.x for the weekend |
| `braintrust` / `autoevals` | `^3.43.0` / `^0.4.1` | official Braintrust SDKs, MIT, frequent releases |
| `typescript` | `~5.9.3` | 7.0 (the native compiler) shipped days ago; tooling compatibility unverified |
| `vitest` | `^4.1.12` | 5.x shipped 2026-11-02; stay on 4.1 unless the LiveKit testing docs require 5 |
| `tsx` | `^4.23.15` | runner |
| `libphonenumber-js` | `^1.13.15` | E.164 normalization |
| `yaml` | `^2.9.1` | scenarios file |
| `twilio` | `^6.3.0` | only when a Twilio feature is enabled |
| `dotenv` | not used | Node 24 has `node --env-file=.env`; pass it through `tsx`/`node` scripts |
| OpenTelemetry packages | none extra | `@livekit/agents` already bundles the OTel SDK and OTLP exporter; configure export through the SDK |

Toolchain file, repo root `mise.toml`:

```toml
[tools]
node = "24"
pnpm = "12"
```

Do not add `.nvmrc` or `.node-version`; mise reads `mise.toml` and `mise install` sets both tools. Also set `"packageManager": "pnpm@12.18.0"` in the root `package.json` so corepack-based environments (LiveKit Cloud build) match.

Hygiene: commit `pnpm-lock.yaml`; `pnpm install --frozen-lockfile` in CI and deploy; `pnpm audit --prod` must be clean of high or critical findings at the end of Phase 1 and Phase 8 (record moderate ones in README); never use `latest` or `next` dist-tags; `engine-strict=true` in `.npmrc` with `engines.node` set to `>=24 <27` in the root `package.json`.

## Hard rules

1. Never guess SDK signatures. Before using any `@livekit/agents`, `livekit-server-sdk`, `braintrust`, or `drizzle-orm` API, read the installed types in `node_modules` and the official docs (docs.livekit.io; `lk docs` in the CLI; examples in github.com/livekit/agents-js). Record installed versions and the API decisions you made in README "SDK notes". If a feature exists in the Python SDK but not in Node, say so in README "Known gaps" and implement the smallest workaround.
2. Verify LiveKit Inference model ids against docs.livekit.io/agents/models before hardcoding defaults. Defaults live in `.env.example`, read in `config.ts`.
3. Secrets only in `.env` (gitignored). `.env.example` lists every variable with a comment. `telephony/*.template.json` contain `${ENV_VAR}` placeholders; a tiny script renders them to a gitignored `telephony/out/` before running `lk` commands. Never print secret values in logs or handoff messages.
4. Identity is server-side and never verified in this demo. Trust levels: `caller_id_only` (the participant kind reported by the server is SIP, phone from `sip.phoneNumber`; caller id is spoofable) and `self_reported` (browser form attributes, dispatch metadata). The bound family lives in the session context, set once at session start. Tool arguments can never determine the session identity or the bound family; tools read `familyId` from context. `self_reported` sessions load a family only when it is flagged `is_demo`. All family data is synthetic; README states what production would need (OTP or account link). The browser token endpoint sets only whitelisted attributes and grants no attribute or metadata update permission.
5. Every tool: Zod input schema, typed return, errors returned as a spoken-friendly string (never thrown into the LLM), and a one-line result the LLM can read aloud. Writes are idempotent and transactional (PRD section 8). Booking follows the read-back protocol (PRD FR-14): `propose_booking` stores a `pending` proposal and returns `{ proposalId, readbackText }`; only `readbackText` is spoken, the id never reaches the LLM output. The worker moves the proposal to `confirmed` when the user turn right after the read-back is affirmative, to `cleared` if anything else happens between the read-back and that reply or the reply is not affirmative, and to `consumed` when `book_trial_class` succeeds. `book_trial_class` refuses without a `confirmed` proposal with identical details. The pre-tool filler comes after confirmation and is fine. A "yes" to any other question never books.
6. Side effects go through ports (`agent/src/ports/`): `DbPort`, `SmsPort`, `DialPort`. Real adapters are wired in `agent.ts` for live runs. Three test layers: behavior tests (`pnpm test`) and scenario evals (`pnpm eval`) use fakes for all ports; DB integration tests (`pnpm test:db`) use the real Drizzle adapter against an isolated test database (`TEST_DATABASE_URL`) to prove locking, concurrency, and idempotency; `SmsPort` and `DialPort` are fake everywhere except live runs. An eval must never be able to send a real SMS or place a real call.
7. Feature flags in `config.ts`: `FEATURE_SMS`, `FEATURE_OUTBOUND` (default false). Credentials for a feature are validated only when the flag is on. The hello-world agent must start with only LiveKit and database variables set.
8. Voice output rules live in `prompt.ts` and are tested. Do not scatter prompt text across files.
9. Database access only through `db/` helpers. No raw SQL in tools. Supabase: use the transaction pooler URL with `prepare: false` in postgres.js for the app; use the direct connection URL (`DIRECT_DATABASE_URL`) for migrations.
10. Keep each phase in TASKS.md independently runnable and committed. Commit message format: `phase-N: short summary`.
11. Do not fabricate measurements. Latency and eval numbers in README come from `pnpm report:latency` and `pnpm eval` output, pasted verbatim with date and sample size. Never claim an integration works unless it was exercised end to end.
12. Spend limits: LiveKit Build plan has hard caps (2.50 USD inference credit, 1,000 agent minutes, 50 inbound phone minutes, 5 concurrent sessions). Keep dev test calls under 2 minutes. Use the cheapest configured models during development; switch to the demo voice only for the final recording.
13. Twilio is a trial account: only verified numbers can be called or texted, a trial announcement plays, calls cap at 10 minutes. Outbound and SMS are optional features and must never block core work.

## SDK notes to apply (verified against docs on 2026-11-07, re-check against the installed version)

- Testing: `@livekit/agents` ships a testing API for Node: `session.run({ userInput }).wait()` with assertions on messages, tool calls, and handoffs, an LLM judge, and tool mocking, designed for Vitest. Use it for `agent/test/*.test.ts`. Docs: docs.livekit.io/testing/unit-tests/.
- Simulations: `lk agent simulate text -n 10` runs text simulations in LiveKit Cloud (included on the Build plan).
- Latency: the session-level `metrics_collected` event is deprecated. Use `ChatMessage.metrics` (for example `e2eLatency`, LLM ttft, TTS ttfb) from the `ConversationItemAdded` event, and `session_usage_updated` for usage. Per-plugin `metrics_collected` events are still fine for pipeline breakdown. Docs: docs.livekit.io/testing/observability/data/.
- Tracing: check whether the installed SDK exports OpenTelemetry spans. If yes, send them to Braintrust's OTLP endpoint first; add manual Braintrust spans only for what OTel does not cover (tool results, summary, outcome). If no, use manual spans and say so in README.

## UI rules (web/, and the console if it ships)

1. `design/` is the spec. Read `design/README.md` and the matching `design/*.html` before writing or changing any screen. Phase 4 builds only the three parent screens; console pages are Stretch and need their TASKS.md item.
2. Keep the starter's LiveKit wiring, replace its visual shell. No hero orb, waveform hero, gradients, emoji, three-feature-card rows, or marketing copy.
3. Tokens come from `design/README.md`: Inter for text, Space Grotesk for titles and the one large number per page, monospace for ids, model names, tool names and latency values; the listed palette; 12px radius on cards, 8px on controls, 1px borders, no shadows.
4. Status is a dot plus text, never a colored pill or badge. Buttons: one primary per screen, secondary buttons are outlined.
5. Microcopy is sentence case, names the thing, says what happens next. No "Powered by AI", "seamless", "experience", or exclamation marks. Placeholders in square brackets (`[LIVEKIT NUMBER]`, `BK-[ID]`) are filled from env or data before anything ships; a bracket on a live screen is a bug.
6. Every number on a screen comes from the database, token attributes, env, `metrics/*.json`, or eval output. Hard rule 11 applies to the UI: no typed-in metrics, no sample values, no fake transcript lines. If a field in the design has no real source yet, leave it out.
7. Pages are plain React with the starter's styling system; no new UI libraries, no icon packs (inline SVG for the few icons), no animation libraries. Screens are checked at 1280 wide against the mockup before the phase commit.

## Commands (keep these working)

```
pnpm install
pnpm -F agent dev          # run agent worker locally against LiveKit Cloud
pnpm -F agent console      # console mode if the SDK offers it, else document the alternative
pnpm -F web dev            # browser demo at http://localhost:3000
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm test                  # Vitest, SDK testing API, fakes only, no network side effects
pnpm test:db               # real DbPort adapter against TEST_DATABASE_URL (isolated), reset per test
pnpm eval --profile core   # Braintrust eval over eval/scenarios.yaml, fakes only; profiles: core, sms, guardian, outbound, all
pnpm report:latency        # p50/p95 table from metrics/*.json
pnpm call -- +1XXXXXXXXXX  # outbound test call (FEATURE_OUTBOUND=true, verified number only)
pnpm typecheck && pnpm lint
```

## Env vars (mirror in .env.example)

```
LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
AGENT_NAME=enroll-agent
LK_STT_MODEL, LK_LLM_MODEL, LK_TTS_MODEL        # LiveKit Inference ids, e.g. provider/model[:voice]
DATABASE_URL                                     # Supabase transaction pooler URL (app)
DIRECT_DATABASE_URL                              # Supabase direct URL (migrations)
TEST_DATABASE_URL                                # isolated test schema or local Postgres, used only by pnpm test:db
BRAINTRUST_API_KEY, BRAINTRUST_PROJECT=movo-voice-demo
OPENAI_API_KEY                                   # eval judge + simulated caller only (or ANTHROPIC_API_KEY, see eval/run.ts)
FEATURE_SMS=false, FEATURE_OUTBOUND=false
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER   # required only when a Twilio feature is on
TWILIO_SIP_TERMINATION_URI, TWILIO_SIP_USERNAME, TWILIO_SIP_PASSWORD  # outbound trunk template inputs
LK_OUTBOUND_TRUNK_ID                             # set after `lk sip outbound create`
DEMO_ACADEMY_NAME="Brooklyn Youth Soccer Academy"
DEMO_AGENT_PERSONA_NAME=Maya
DEMO_RETURNING_PHONE                             # seeded demo family phone (Umut's), is_demo=true
```

## Working style

- Work through TASKS.md in dependency order; core phases before optional and stretch. Mark a task done only after its "Verify" line passed. Record anything skipped or unverified with the reason.
- Phase 0 has two states: reported by the human and verified by you (a successful command or API call that does not print secrets). Verify prerequisites when a task needs them.
- When an unfinished `[MANUAL]` task blocks a task, complete all independent core tasks first. An optional integration (outbound, SMS) must never block core progress. Stop only when no remaining core task can proceed, then list the exact manual actions and how the human can verify each one.
- At each handoff report: completed work, checks run, unresolved failures, next task.
- Prefer the SDK's built-in features (turn detection, interruption handling, metrics, testing API, tool calling) over custom code.
- When something fails, write the failure and the fix into README "Gotchas" as you go. That section is part of the deliverable.
- Keep README honest: what works, what is mocked, what was not tested.
- No em dashes anywhere in generated text.
