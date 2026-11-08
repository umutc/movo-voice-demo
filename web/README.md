# web/

Next.js 15 app for the voice enrollment demo. It started from LiveKit's `agent-starter-react`
template; the LiveKit wiring stays, the screens follow `design/`.

- Parent site at `/`: the pre-call form, the live call view and the booked view. It also lists
  programs and coaches from the database.
- `/api/token`: mints a LiveKit token with whitelisted attributes and dispatches the agent.
- `/api/calls/[id]`: the call record the booked view polls for the summary.
- `/console`: read-only academy console behind `CONSOLE_PASSWORD`.

## Run it

From the repo root, after `pnpm install` and the database steps in the [root README](../README.md):

```
pnpm -F web dev        # http://localhost:3000
pnpm --filter web build && pnpm --filter web start
```

The agent must run too (`pnpm -F agent dev`, or the deployed cloud agent) for a call to connect.

## Env

`next.config.ts` loads the repo root `.env`. The app reads:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AGENT_NAME`: token route.
- `DATABASE_URL`: home catalog, call records, console.
- `ALLOW_TOKEN_ROUTE=true`: required outside `next dev`, or `/api/token` returns 403.
- `ALLOWED_ORIGINS`: origins allowed to call `/api/token` in production.
- `DEMO_ACADEMY_NAME`, `DEMO_AGENT_PERSONA_NAME`: names on every page.
- `NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER`: the inbound number shown on the form.
- `DEMO_LIMIT_PER_IP_PER_DAY`, `DEMO_LIMIT_GLOBAL_PER_DAY`: daily demo caps (unset means none).
- `CONSOLE_PASSWORD`: turns the console on; unset means `/console` returns 404.

`../.env.example` explains each one.

## Deploy

See [README-amplify.md](README-amplify.md) for the Amplify setup that runs the live site, and
[README-cloudflare.md](README-cloudflare.md) for the Cloudflare alternative.
