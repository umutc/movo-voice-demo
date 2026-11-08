# Demo script

Target: a 2 to 3 minute screen recording. It shows the success path from PRD section 1: a call that
books a trial class, with memory, an interruption, a trace and numbers behind it.

## Before recording

- [ ] In `.env`, set `LK_TTS_MODEL` to the Cartesia value of `LK_TTS_MODEL_RECORDING` from
      `.env.example`. Switch it back to the Deepgram line after the recording (CLAUDE.md rule 12).
- [ ] Restart the worker so it reads the new model: stop it, then `pnpm -F agent dev`. Skip this if you
      record against the deployed agent, and redeploy with the new value first.
- [ ] Pre-warm with one short call (under 30 seconds). The first call after a restart is slower.
- [ ] Keep every call under two minutes. Build-plan minutes are capped (CLAUDE.md rule 12).
- [ ] Run `pnpm eval --profile core` once before you record, so you know it passes. It takes a while,
      so cut it in the edit or show a finished run.
- [ ] Mute notifications (Do Not Disturb). Close chat and mail windows.
- [ ] Set the browser window to 1280 wide. Open the Braintrust logs tab in advance.
- [ ] Have the phone ready with the seeded demo number (`DEMO_RETURNING_PHONE`).

## Beats

1. Start the worker (15 s).
   - Show: terminal with the worker registering as `enroll-agent`.
   - Say: "The agent is a Node worker on LiveKit Agents. It registers with LiveKit Cloud."
   - Run: `pnpm -F agent dev` (or show the deployed agent in the LiveKit Cloud dashboard).

2. Open the web app (10 s).
   - Show: the start form with name, phone, email and the consent box.
   - Say: "This is the parent's entry point. Identity here is self-reported, and the demo says so."
   - Run: `pnpm -F web dev`, then open http://localhost:3000

3. Browser call that books a trial class, with one interruption (60 s).
   - Show: live transcript, then the read-back, then the booked page.
   - Say: "I ask for a trial class, I cut Maya off mid-sentence, and she stops. Booking needs a
     read-back and a yes."
   - Do: use a name that is not the demo family. Ask for a program for a child. Interrupt once while
     Maya talks. Confirm the read-back with a plain yes. End the call.
   - URL: http://localhost:3000 (the booked page shows after the call).

4. Phone call, returning family (30 s).
   - Show: the phone screen dialing, then the greeting by name and the earlier booking.
   - Say: "Same agent over SIP. The caller id matches a family, so Maya greets them by name."
   - Do: call +1 929 428 8103 from the seeded demo number. Hang up after the greeting.
   - Note: this beat works only after Umut assigns the dispatch rule to the number. Cut the beat if
     the phone test has not passed.

5. Braintrust trace (25 s).
   - Show: the newest `call` trace, nested spans, a `tool:propose_booking` span, the summary.
   - Say: "Every call is one trace: turns, model calls, tool calls and the final outcome."
   - URL: https://www.braintrust.dev/app/movo-voice-demo/p/movo-voice-demo/logs

6. Latency table (15 s).
   - Show: the p50 and p95 rows in the terminal.
   - Say: "These numbers come from the metrics files of real calls, not from me."
   - Run: `pnpm report:latency`

7. Eval (20 s).
   - Show: the scorecard and the PASS line.
   - Say: "Ten scenarios with a simulated caller. The read-back and consent rules must all pass."
   - Run: `pnpm eval --profile core`

8. Booked page (10 s).
   - Show: the booking from beat 3 with its `BK-` id and the call summary.
   - Say: "The booking is in Postgres, and the summary is what Maya will remember next time."
   - URL: http://localhost:3000

Total: about 3 minutes. Beats 4 and 7 are the first to cut if you run long.

## Do not show

- `.env` or any terminal that prints environment values.
- The Braintrust API key, the LiveKit secret and the database URL. Do not open key or settings pages.
- The demo phone number on screen. Blur it in the edit, hide the call log, and show only the greeting.
  The LiveKit number +1 929 428 8103 may be shown.
