# Cloudflare Workers build (OpenNext)

Status (2026-11-07): `pnpm -F web cf:build` succeeds and `wrangler deploy --dry-run` bundles the
worker. Not deployed. Not run in `cf:preview`. No database call was made from a Worker.

Versions: `@opennextjs/cloudflare` 1.20.16, `wrangler` 4.158.0, Next.js 15.5.29. Config files:
`open-next.config.ts` (no cache override), `wrangler.jsonc` (worker `movo-voice-demo-web`,
`nodejs_compat`, `global_fetch_strictly_public`, assets in `.open-next/assets`).
`workerd` (a wrangler dependency) runs an install script, so the root `pnpm-workspace.yaml`
lists it under `allowBuilds`.

## postgres.js on Workers

postgres.js 3.4.9 supports Workers. Its `package.json` has a `workerd` export condition that
points to `cf/src/index.js`, which uses `cloudflare:sockets`. The README has a "Cloudflare Workers
support" section. Workers also support `node:net` and `node:tls` under `nodejs_compat`.

Catch: the OpenNext bundle did not pick the `workerd` entry. The built `worker.js` contains the
Node entry of postgres.js, which imports `net`. This should work through the `node:net` support
in Workers, but nobody ran it. Test `GET /api/calls/<id>` against the real database on a
`wrangler dev` or deployed worker before you rely on it.

Rules that apply to our code:

- `db/read.ts` makes one client per request (`max: 1`) and closes it. Keep it that way. OpenNext
  docs warn against a global client or pool, because Workers cannot reuse a connection across
  requests.
- A Worker opens TCP connections itself, so each request pays the TLS and auth cost. Use the
  Supabase transaction pooler URL (as now, with `prepare: false`).

Hyperdrive alternative (pooling and lower latency):

1. Create a config: `wrangler hyperdrive create movo-db --connection-string "<DATABASE_URL>"`.
2. Add to `wrangler.jsonc`: `"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>" }]`.
3. In the route, read `getCloudflareContext().env.HYPERDRIVE.connectionString` and pass it to
   `getCallView` in place of `process.env.DATABASE_URL`. Keep `prepare: false` and a client per
   request. Then `DATABASE_URL` is no longer needed on the worker.

## Environment variables

Secrets (set with `wrangler secret put`): `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DATABASE_URL`.

Plain vars (set in `wrangler.jsonc` under `vars`, or as secrets): `LIVEKIT_URL`, `AGENT_NAME`,
`ALLOW_TOKEN_ROUTE`, `DEMO_ACADEMY_NAME`, `DEMO_AGENT_PERSONA_NAME`, `LK_STT_MODEL`,
`LK_LLM_MODEL`, `LK_TTS_MODEL`, `NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER`.

Notes:

- `ALLOW_TOKEN_ROUTE` must be `true`, or `/api/token` returns an error outside development.
- The home page `/` is prerendered at build time (shown as static in the build output). The
  values `app/page.tsx` reads (`AGENT_NAME`, `DEMO_*`, `LK_*`, `NEXT_PUBLIC_*`) are fixed at
  build time, from the shell or from the root `.env` that `next.config.ts` loads. Changing them
  with `wrangler` does not change the page. Rebuild, or add `export const dynamic =
  'force-dynamic'` to `app/page.tsx`. The two API routes read `process.env` at request time.
- For `cf:preview`, put local values in `web/.dev.vars` (gitignored).

## Commands

```
pnpm -F web cf:build            # build only, output in .open-next/
pnpm -F web cf:preview          # build + run in the local Workers runtime
wrangler login                  # once, interactive
wrangler secret put <NAME>      # one per secret, run from web/
pnpm -F web cf:deploy           # build + deploy
```
