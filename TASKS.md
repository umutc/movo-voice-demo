# TASKS.md

Work in dependency order: core phases 0 to 8, then optional 9, then stretch. Each phase ends with a commit `phase-N: ...` and every "Verify" line actually run. `[MANUAL]` tasks are for Umut. If a `[MANUAL]` task is not done, finish every independent core task first; optional integrations never block core; stop only when no core task can proceed, then print the exact manual actions and how to verify each. Outbound (Phase 9) is capped at 60 minutes.

Time budget: the core time boxes below add up to about 15 hours including Phase 0 (Friday night plus two full days), so buffer is thin. If behind schedule at Sunday noon, apply this cut list in order and record each cut in README: (1) Phase 8 cloud simulations, (2) Phase 8 Cartesia quality check, (3) Phase 5 OTel export (use manual spans), (4) second and third eval tuning iterations in Phase 6 (ship with the first passing run), (5) Phase 7 second-phone verification (one phone is enough). Never cut core behavior, tests, or the invariants.

Test layers: `pnpm test` (behavior, fakes), `pnpm test:db` (real adapter, isolated test database), `pnpm eval --profile core` (fakes). SMS and dial are fake outside live runs.

Status legend: `[ ]` todo, `[x]` done and verified, `[~]` reported by human, not yet verified, `[-]` skipped with reason in README.

---

## Phase 0: Accounts and local setup (Friday night, 45 min)

Reported by human (mark `[~]`), verified by agent (mark `[x]` after the Verify command passes without printing secrets):

- [x] `[MANUAL]` LiveKit Cloud project `movo-voice-demo`, Build plan, recordings and insights enabled. Verify: `lk project list` shows it; a token can be minted with the server SDK. (2026-11-07: listed; a hand-minted JWT called RoomService/ListRooms with HTTP 200; recordings and insights enabled as reported by Umut, checked in the dashboard in Phase 8)
- [x] `[MANUAL]` `brew install livekit-cli`, `lk cloud auth`. Verify: `lk project list`. (2026-11-07: lk 2.19.3, project listed, LIVEKIT_* copied from the CLI config into .env)
- [x] `[MANUAL]` Supabase project (free): pooler URL in `DATABASE_URL`, direct URL in `DIRECT_DATABASE_URL`. Verify: `select 1` through both. (2026-11-07: project created via MCP, password reset via browser, `select 1` ok on all three URLs, `TEST_DATABASE_URL` resolves `current_schema() = test`; direct host is IPv6-only so `DIRECT_DATABASE_URL` is the session pooler) For `TEST_DATABASE_URL` either a separate schema on the same project (set `search_path`) or a local Postgres container; the agent may set this up itself.
- [x] `[MANUAL]` Braintrust account, project `movo-voice-demo`, `BRAINTRUST_API_KEY`. Verify: log one test span. (2026-11-07: span `phase0-verify` logged and flushed with the SDK)
- [~] `[MANUAL]` `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for eval judge and simulated caller. Verify: one tiny completion. (2026-11-07: key valid, `GET /v1/models` 200 and gpt-6.1-terra, gpt-6-luna listed; a completion returned 429 "account is not active, check billing". Blocks Phase 3 judge tests and Phase 6 until billing is added)
- [x] Node 24 LTS and pnpm 12 via mise: after Phase 1 creates `mise.toml`, run `mise install` in the repo (until then `mise use -g node@24 pnpm@12` is fine). Verify: `mise current` shows node 24.x and pnpm 12.x; `node -v`, `pnpm -v`. (2026-11-07: node 24.22.1, pnpm 12.18.0)
- [ ] (Only for Phase 9 / stretch) `[MANUAL]` Twilio trial, both demo phones as Verified Caller IDs, trial number, SID, auth token. Not required for core.

Done when: `.env` has every core variable from `.env.example`; feature flags default false.

## Phase 1: Repo scaffold and hello-world agent (Saturday 09:00, 90 min)

- [x] pnpm workspace: `agent/`, `db/`, `eval/`, `scripts/`, `telephony/`, `web/` (web created in Phase 4). Root scripts from CLAUDE.md. TypeScript 5.9 strict, ESM, `tsx`, Vitest 4. Install exactly the pinned versions from CLAUDE.md (all `@livekit/agents*` at the same exact version), `mise.toml` with node 24 and pnpm 12, `packageManager` field, `.npmrc` with `engine-strict=true`, commit `pnpm-lock.yaml`, run `pnpm audit --prod` and record the result in README.
- [x] `agent/src/config.ts`: Zod env with feature flags; Twilio variables required only when `FEATURE_SMS` or `FEATURE_OUTBOUND` is true.
- [x] Read `node_modules/@livekit/agents` types and agents-js examples. Write README "SDK notes": installed version, agent definition, tool registration, `AgentSession` config, console/text mode availability, testing API (`session.run`), `ChatMessage.metrics` fields, OTel export availability.
- [x] `agent/src/agent.ts`: minimal agent named `AGENT_NAME` with LiveKit Inference STT, LLM, TTS from env (ids verified on docs.livekit.io/agents/models), VAD + turn detection, greeting on join.
- [x] `agent/src/ports/`: `DbPort`, `SmsPort`, `DialPort` interfaces; fakes for all three; real adapters stubbed for now. (DbPort interface lives in `db/port.ts`; its fake arrives with the seed data in Phase 2)
- [x] Verify: `pnpm -F agent dev` connects without errors; a playground conversation gets a spoken reply. `pnpm typecheck` green. (2026-11-07: worker registered as enroll-agent; `lk agent debugger` text and audio sessions got replies; typecheck, lint and `pnpm audit --prod` clean)

Commit `phase-1: scaffold + hello agent + ports`.

## Phase 2: Database (Saturday 10:30, 60 min)

- [x] `db/schema.ts` per PRD section 8, including `families.is_demo`, `bookings` unique (child_id, slot_id), `calls.identity_source`.
- [x] Drizzle config: app connection via pooler with `prepare: false`; migrations via `DIRECT_DATABASE_URL`. Generate and apply the migration.
- [x] `db/seed.ts`: 5 programs, 2 locations, prices, coaches, 3 to 5 open slots per program in the next 14 days, one demo family (`is_demo = true`, phone `DEMO_RETURNING_PHONE`, summary, prior inquiry).
- [x] `db/index.ts` real `DbPort` adapter: `findFamilyByPhone`, `createFamily`, `upsertFamilySummary`, `findOrCreateChild(familyId, name, age)` (normalized name match), `listPrograms(age)`, `listOpenSlots(programId)`, `bookTrialClass` (single transaction in this order: lock slot row, return existing booking for (child, slot) if any, capacity check only for a new booking, insert with ON CONFLICT DO NOTHING, increment only on insert), `createCallbackRequest`, `insertCall`, `finishCall`.
- [x] `db/fake.ts`: in-memory `DbPort` with the same semantics, seeded from the same seed data, resettable.
- [x] `db/test/*.test.ts` (`pnpm test:db`, isolated `TEST_DATABASE_URL`, reset per test): two concurrent bookings for the last seat produce one booking and `booked_count == capacity`; repeat request on a full slot returns the original booking; a different child on a full slot is refused; `findOrCreateChild` is stable for the same normalized name.
- [x] Verify: `pnpm db:migrate && pnpm db:seed`; a smoke script lists programs for age 7; `pnpm test:db` green; the same cases pass against the fake in `pnpm test`. (2026-11-07: migration 0000 applied to `public` and `test`; seed 5 programs, 21 slots, demo family; `pnpm db:smoke` lists Juniors U8 with 3 open slots; `pnpm test:db` 6/6 in 15.8 s; `pnpm test` 6/6 on the fake)

Commit `phase-2: db schema + seed + DbPort + db integration tests`.

## Phase 3: Context, tools, prompt, memory (Saturday 11:30, 150 min incl. lunch)

- [x] `agent/src/context.ts`: identity resolution per PRD section 5: server-reported participant kind decides `caller_id_only` (SIP) vs `self_reported` (browser attributes, dispatch metadata); E.164 normalization; `familyId` binding (`is_demo` gate for `self_reported`); booking proposal state machine (pending, confirmed, cleared, consumed) keyed by `proposalId` with the recorded `readbackText`; call row creation with `identity_source` using the same two values.
- [x] Core tools: `lookup_programs`, `check_trial_slots`, `propose_booking` (stores a `pending` proposal, returns `{ proposalId, readbackText }`, only the text is spoken), `book_trial_class` (PRD FR-14: requires a `confirmed` proposal with identical details, marks it `consumed`), `request_human_callback`, `end_call`. The worker drives the proposal state machine from conversation events: `confirmed` when the user turn right after the read-back is affirmative, `cleared` on anything else in between or a non-affirmative reply. Filler after confirmation is allowed. Tool arguments never determine identity or the bound family. Spoken-friendly results.
- [x] `agent/src/prompt.ts`: PRD section 9, variants `inbound` and `follow_up`, memory block, America/New_York time, snapshot test.
- [x] `agent/src/memory.ts`: load family before first turn when allowed; on session end LLM summary, upsert family and children, finish call row.
- [x] Filler before slow tools via the SDK mechanism if available; otherwise prompt instruction and a README note. (`ctx.filler(text, { delay: 400 }, fn)` in check_trial_slots and book_trial_class, plus the prompt instruction; the LLM also says its own filler before tool calls)
- [x] Vitest behavior tests via `session.run` with fakes: age routing, `propose_booking` before `book_trial_class`, happy path read-back then yes then filler then booking succeeds, booking refused without a matching proposal, booking refused when a different assistant question sits between the read-back and the user's yes (negative test), booking refused after a detail change, consumed proposal cannot book twice, grounding refusal, callback on off-topic, isolation (self-reported real number loads nothing, SIP-kind participant loads), idempotent booking on the fake.
- [~] Verify by voice in the playground: book a trial; row in `bookings`; hang up; `calls.summary` populated. Reconnect as the demo family; greeting references the previous call. `pnpm test` green. (2026-11-07: verified in text mode with `lk agent debugger` against the real database: booking row landed, the simulated returning caller was greeted by name with the last summary; `pnpm test` 40/40. The end-of-call summary write is covered by the happy-path test on the fake, but the SDK `onSessionEnd` path could not be observed because the debugger kills the process when the session closes; it is checked with a real room in Phase 4)

Commit `phase-3: context + tools + prompt + memory + tests`.

## Phase 4: Browser demo (Saturday 14:30, 60 min)

- [ ] Read `design/README.md`, then `design/parent-main.html`, `design/parent-call.html`, `design/parent-done.html`. These three screens are the spec for `web/`; the console pages in `design/` are Stretch and must not be started here.
- [ ] `lk app create --template agent-starter-react web` (confirm template name with `lk app create --help`). Point at the project; confirm it reaches the agent. Keep the starter's LiveKit wiring (room connection, audio track, transcription hooks); replace its visual shell with the three design screens: structure, copy, tokens and status patterns from `design/README.md`. Remove the starter's hero, orb or waveform visuals and any sample marketing copy.
- [ ] Pre-call form (`parent-main.html`): guardian name, phone, email, consent (required). The server-side token endpoint validates the form, sets only those whitelisted attributes on the token, and grants no attribute or metadata update permission to the client; the agent treats the values as `self_reported`.
- [ ] Call page (`parent-call.html`): transcript first with the read-back turn highlighted; "Under the hood" aside fed by real data only (identity source and family from the token attributes and the agent's state, pipeline ids from env, proposal state and per-turn latency from the agent via data messages or the room's transcription events, tool calls from the same channel). Any aside field without a real source is left out, not faked.
- [ ] Booked page (`parent-done.html`): booking details from the database row, "What Maya will remember" from the written summary, the call's latency rows from `metrics/<callId>.json` when available. `BK-[ID]` and `[LIVEKIT NUMBER]` are filled from data and env.
- [ ] Time box: layout and copy fidelity, not pixel fidelity. If the 60 minutes run out, ship the starter UI with the design's copy and tokens only, keep the aside minimal, and record the gap in README "Known gaps".
- [ ] Verify: form with `DEMO_RETURNING_PHONE` -> memory greeting; form with another number -> fresh session, no memory; booking lands in Postgres; transcript visible in LiveKit Cloud; the three screens match the design at 1280 wide (screenshot each next to its mockup). AC-1, AC-2.

Commit `phase-4: browser demo with pre-call form`.

## Phase 5: Interruption, metrics, tracing (Saturday 15:30, 120 min)

- [ ] Interruption test in a real browser call: speech stops within about half a second, context truncation observed; adjust SDK settings if needed; note behavior in README. AC-3.
- [ ] `agent/src/metrics.ts`: subscribe to `ConversationItemAdded`, read `ChatMessage.metrics` (e2e latency, LLM ttft, TTS ttfb) and `session_usage_updated`; per-plugin metrics for EOU delay if exposed; write `metrics/<callId>.json`.
- [ ] `agent/src/tracing.ts`: OTel export to Braintrust if the SDK supports it, else manual Braintrust spans per call, turn, tool; attach summary and outcome; flush on end.
- [ ] `scripts/report-latency.ts`: p50/p95 per metric with n, markdown table.
- [ ] Verify: two browser calls appear in Braintrust with nested spans; `pnpm report:latency` prints a table.

Commit `phase-5: interruption check + metrics + tracing`.

## Phase 6: Scenario eval (Sunday 09:00, 150 min)

- [ ] `eval/scenarios.yaml`: 13 scenarios from PRD 11.2, each tagged with a profile (`core`: 1 to 8, 10, 13; `sms`: 9; `guardian`: 11; `outbound`: 12). Only `core` is required now; the others are enabled when their feature ships.
- [ ] `eval/simulated-caller.ts`: persona LLM, one or two sentences per turn, stops at goal or refusal.
- [ ] `eval/run.ts`: Braintrust `Eval` with `--profile`; task runs the real prompt + real handlers over fresh fakes per scenario; records the ordered conversation timeline (user turns, assistant turns, tool calls); prefer the SDK testing API for the turn loop.
- [ ] `eval/invariants.ts` + `eval/scorers.ts`: must-pass invariants on the timeline plus final fake DB state (booking authorized only by an affirmative user turn whose immediately preceding assistant turn is the matching read-back, with nothing in between; consent; isolation; capacity; idempotency; forbidden tools); judge and style scores computed over the selected profile; thresholds; non-zero exit on failure.
- [ ] Verify: `pnpm eval --profile core` prints the scorecard; results in Braintrust; scenario 5 proves the old "yes" did not authorize the new slot and scenario 13 proves a stray "yes" did not either; fix prompt issues (first passing run is enough if time is short). AC-5.

Commit `phase-6: scenario eval + invariants`.

## Phase 7: Inbound phone (Sunday 12:00, 60 min)

- [ ] `lk number search --country-code US --area-code 718` (or 347, 929); `lk number purchase --numbers +1...` (first number free).
- [ ] Render `telephony/dispatch-rule.template.json` -> `telephony/out/` (gitignored); `lk sip dispatch create --config ...`; `lk number update --id <number_id> --sip-dispatch-rule-id <rule_id>`.
- [ ] Confirm the participant kind is SIP and `sip.phoneNumber` arrives; identity source recorded as `caller_id_only`; memory works for a synthetic family created by an earlier phone call.
- [ ] Verify: both demo phones call, each completes a booking; second call from the same phone is recognized. AC-6.

Commit `phase-7: inbound phone via LiveKit number`.

## Phase 8: Hardening, deploy, docs, recording (Sunday 13:30, 180 min incl. lunch)

- [ ] 20+ real turns across browser and phone with dev models; `pnpm report:latency`.
- [ ] Digit-spelling step: check endpointing while reading a phone number; adjust if needed.
- [ ] `lk agent simulate text -n 10` plus 2 or 3 audio simulations in the dashboard; screenshots.
- [ ] Switch `LK_TTS_MODEL` to Cartesia for a quality check; back to the cheap model until recording.
- [ ] `lk agent create` (or current equivalent) to deploy with secrets; confirm the generated Dockerfile uses Node 24 and `pnpm install --frozen-lockfile`; stop the local worker; inbound still works. AC-7.
- [ ] `pnpm audit --prod` clean of high or critical findings; record moderate ones in README.
- [ ] README.md: honest scope; architecture diagram; setup in 10 steps; commands; SDK notes; cost estimate with assumptions (PRD 15); latency table (dated, n); eval scorecard; Braintrust screenshot; gotchas; known gaps; "what production would need" (concurrency, failover, TCPA consent capture, recording consent, PII handling, verified identity for web, warm transfer, AMD for outbound, regression evals from production calls). AC-8.
- [ ] `demo-script.md`: browser call with booking and an interruption; phone call from a returning number; Braintrust trace; latency table; eval scorecard.
- [ ] Final `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm eval --profile core` green. Tag `v0.1-demo`.

Commit `phase-8: deploy + docs + recording plan`.

---

## Phase 9 (optional, cap 60 min): Outbound via Twilio trial

- [ ] `[MANUAL]` Twilio: Verified Caller IDs, Elastic SIP Trunk, termination URI, credential list; values into `.env`.
- [ ] Render `telephony/outbound-trunk.template.json` from env; `lk sip outbound create --config telephony/out/outbound-trunk.json`; `LK_OUTBOUND_TRUNK_ID`; `FEATURE_OUTBOUND=true`.
- [ ] `scripts/call.ts`: create room, dispatch `AGENT_NAME` with metadata `{ phone, reason: "follow_up" }`; agent dials via real `DialPort`, waits until answered, starts follow-up variant; timeout -> `no_answer`.
- [ ] Enable the `outbound` eval profile (scenario 12, fake dial) and run it.
- [ ] Verify: `pnpm call -- +1<verified>` rings, trial announcement, agent speaks. If Twilio refuses SIP on trial: stop at the cap, README section with the exact error, code path stays covered by the fake `DialPort` test and the `outbound` profile. AC-9.

Commit `phase-9: outbound dial (optional)`.

## Stretch (only after Phase 8 is green)

- [ ] SMS confirmation behind `FEATURE_SMS` with consent gating; enable the `sms` eval profile (scenario 9); AC-10.
- [ ] Second guardian tool (its contact arguments are ordinary data, never identity); enable the `guardian` eval profile (scenario 11).
- [ ] Provider fallback factory: Deepgram plugin (Deepgram free credit) and OpenAI plugin behind `PROVIDER_MODE=inference|byok`, conditional env validation.
- [ ] `MODE=realtime`: OpenAI Realtime through LiveKit Inference as an A/B config; same metrics; comparison row in README.
- [ ] Console, read-only, in `web/` under `/console`, following `design/console-*.html` and `design/README.md`. Order: (1) Dashboard, Calls and Callbacks from the real tables (calls, bookings, callback requests, families); (2) Quality from `metrics/*.json` and the last `pnpm eval` output saved as `eval/out/last-run.json` (add that write to `eval/run.ts` when this starts; numbers on screen are never typed in); (3) Families and Programs; (4) Settings as a read-only view of `config.ts` values and feature flags, no editing. Access behind a single `CONSOLE_PASSWORD` check on the server route; no user accounts, no tenant switching (the switcher renders the one seeded academy). Every console number is a query result; if a page has no data source yet, leave the page out rather than render placeholders. Record which pages shipped in README.
