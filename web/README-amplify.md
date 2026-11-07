# Deploying web/ to AWS Amplify Hosting (WEB_COMPUTE)

Prototype setup, not production. The build spec is `amplify.yml` at the repo root. Nothing here
was run against a real Amplify app: the YAML was parsed, the commands were not executed on
Amplify.

## What the docs say (checked 2026-11-07)

All links are under https://docs.aws.amazon.com/amplify/latest/userguide/ unless noted.

- Next.js support: Amplify Hosting compute handles Next.js 12 through 15 with no adapter
  (`ssr-amplify-support.html`, `deploy-nextjs-app.html`). This app uses `next@15.5.29`, the
  newest line the docs list. The docs name no minor version.
- Platform: `WEB_COMPUTE` is the platform for SSR apps. The console detects Next.js SSR
  automatically from the `build` script (`next build`) in `package.json`
  (`deploy-nextjs-app.html`; `platform` option in
  https://docs.aws.amazon.com/cli/latest/reference/amplify/update-app.html).
- Build output: when `amplify.yml` exists, set `baseDirectory` to `.next` yourself. The output
  directory must stay `.next` (no custom `distDir`) (`deploy-nextjs-app.html`,
  `ssr-supported-features.html` troubleshooting).
- `output: 'standalone'`: not required and not forbidden. The only mention is a local startup
  timing recipe in `troubleshooting-SSR.html`. No `next.config.ts` change is needed. The
  existing `serverExternalPackages: ['postgres']` and `transpilePackages: ['db']` are normal
  Next options. `output: 'export'` would break SSR, so do not add it.
- Node version: SSR runtime matches the Node major used in the build. Supported runtimes are
  Node 20, 22 and 24 (`ssr-supported-features.html`). The AL2023 build image supports Node 22
  and 24 with default 22. Pick the version with `nvm use` in `preBuild`, which overrides live
  package updates (`troubleshooting-general.html#update-node-version`). `latest` is not valid
  for the live package override (`custom-build-image.html`). So `amplify.yml` runs
  `nvm install 24 && nvm use 24`.
- pnpm: not in the default build image. The docs show `npm install -g pnpm` in `preBuild`.
  `amplify.yml` uses `corepack enable` and `corepack prepare pnpm@12.18.0 --activate` as asked
  (pnpm 12.18.0 exists on npm and matches `packageManager`). The docs do not describe corepack
  for Amplify. Fallback: `npm install -g pnpm@12.18.0`.
- Monorepo: `applications: - appRoot: web`. `appRoot` must equal the
  `AMPLIFY_MONOREPO_APP_ROOT` env var. The console sets it when you tick "My app is a
  monorepo". Without `buildPath`, commands run in `appRoot` and `baseDirectory` is relative to
  it. With `buildPath: /`, commands run from the repo root and `baseDirectory` becomes
  `web/.next` (`monorepo-configuration.html`).
- pnpm workspace: the docs say pnpm and Turborepo apps need an `.npmrc` in the project root
  with `node-linker=hoisted` (`monorepo-configuration.html`). This repo's `.npmrc` only has
  `engine-strict=true`. I was not allowed to edit it, so the install command passes
  `--config.node-linker=hoisted`. See risks.
- SSR runtime env vars: Next.js server code does not see Amplify console variables by default.
  Write them to `.env.production` in the build step, for example
  `env | grep -e NEXT_PUBLIC_ >> .env.production` (`ssr-environment-variables.html`). The docs
  warn that anyone with access to deployment artifacts can read these values, and recommend an
  IAM compute role for AWS resources instead of secrets. In a monorepo the file path must be
  prefixed with the app root only when the build runs from the repo root (`buildPath: /`).
  Here the working directory is `web/`, so the plain `.env.production` path is correct.
- Limits: build output 220 MB, HTTP response 5.72 MB, env var value 5500 characters
  (`troubleshooting-SSR.html`, `update-app` reference).
- Unsupported: Edge API routes, On-Demand ISR, Next.js streaming, `unstable_after`
  (`ssr-amplify-support.html`). Check that `web/app/api/*` routes do not use the edge runtime.

## Console steps

1. Amplify console, Create new app, GitHub, authorize the Amplify GitHub App for
   `umutc/movo-voice-demo`.
2. Pick the repository and branch `main`.
3. Tick "My app is a monorepo" and enter `web` as the path. The console sets
   `AMPLIFY_MONOREPO_APP_ROOT=web`.
4. On App settings, confirm the framework shows Next.js SSR (platform `WEB_COMPUTE`). Let
   Amplify create the service role. The repo's `amplify.yml` overrides any console build
   settings.
5. Add the environment variables below (Hosting, Environment variables) before the first build.
6. Save and deploy. Check the build log for the Node and pnpm versions printed in `preBuild`.

## Environment variables to set in Amplify

```
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
DATABASE_URL
AGENT_NAME
ALLOW_TOKEN_ROUTE=true
DEMO_ACADEMY_NAME
DEMO_AGENT_PERSONA_NAME
LK_STT_MODEL
LK_LLM_MODEL
LK_TTS_MODEL
NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER
```

Notes:

- `amplify.yml` copies only names that match `LIVEKIT_`, `DATABASE_URL`, `AGENT_NAME`,
  `ALLOW_TOKEN_ROUTE`, `DEMO_`, `LK_` and `NEXT_PUBLIC_` into `.env.production`. A name outside
  that list never reaches SSR.
- `NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER` is read in `web/app/page.tsx` and can be inlined at build
  time, so set it before the build, not after.
- `DATABASE_URL` should be the Supabase transaction pooler URL (CLAUDE.md rule 9).
- `LIVEKIT_API_SECRET` and `DATABASE_URL` land in the build artifacts in plain text (see the
  docs warning above). Use demo-only credentials and rotate them after the demo.
- `ALLOW_TOKEN_ROUTE=true` makes `/api/token` mint tokens outside development
  (`web/app/api/token/route.ts`). The route is open to anyone who finds the URL.
- `update-app --environment-variables` replaces the whole map. Include every variable,
  including `AMPLIFY_MONOREPO_APP_ROOT=web`, in each call.

## CLI commands

Set `APP_ID`, `AWS_REGION` and the branch first. The app must exist (console step above).
Read the secret values from your shell or password manager. Do not paste them into a file in
the repo.

```bash
export AWS_REGION=us-east-1
export APP_ID=dxxxxxxxxxxxxx
export BRANCH=main

# 1. Platform, env vars (replaces the full map)
aws amplify update-app --app-id "$APP_ID" --platform WEB_COMPUTE \
  --environment-variables \
  "AMPLIFY_MONOREPO_APP_ROOT=web,\
LIVEKIT_URL=$LIVEKIT_URL,LIVEKIT_API_KEY=$LIVEKIT_API_KEY,LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET,\
DATABASE_URL=$DATABASE_URL,AGENT_NAME=$AGENT_NAME,ALLOW_TOKEN_ROUTE=true,\
DEMO_ACADEMY_NAME=$DEMO_ACADEMY_NAME,DEMO_AGENT_PERSONA_NAME=$DEMO_AGENT_PERSONA_NAME,\
LK_STT_MODEL=$LK_STT_MODEL,LK_LLM_MODEL=$LK_LLM_MODEL,LK_TTS_MODEL=$LK_TTS_MODEL,\
NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER=$NEXT_PUBLIC_LIVEKIT_PHONE_NUMBER"
# Shorthand splits on commas, so a value with a comma breaks it (DEMO_ACADEMY_NAME has spaces,
# which is fine). If any value has a comma, use --cli-input-json with a JSON map instead.

# 2. Start a build and deploy
aws amplify start-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-type RELEASE
# note the jobId in the output

# 3. Check the job
aws amplify get-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" \
  --query 'job.summary.status' --output text
# full steps and log URLs:
aws amplify get-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" \
  --query 'job.steps[].[stepName,status,logUrl]' --output table

# 4. Custom domain movo-voice-demo.umutcelik.com.tr (Route 53 zone in the same account)
aws amplify create-domain-association --app-id "$APP_ID" \
  --domain-name umutcelik.com.tr \
  --sub-domain-settings prefix=movo-voice-demo,branchName="$BRANCH"
aws amplify get-domain-association --app-id "$APP_ID" --domain-name umutcelik.com.tr \
  --query 'domainAssociation.[domainStatus,statusReason]' --output text
```

Domain notes (`to-add-a-custom-domain-managed-by-amazon-route-53.html`,
`create-domain-association` CLI reference):

- `--domain-name` is the root domain, `umutcelik.com.tr`. The subdomain goes in
  `--sub-domain-settings` as `prefix=movo-voice-demo`. The result is
  `movo-voice-demo.umutcelik.com.tr`.
- When the zone is a Route 53 hosted zone in the same account, Amplify creates the validation
  and CNAME records itself. Without `--certificate-settings` it uses the Amplify managed
  certificate.
- The CLI reference says nothing about a country-code TLD like `.com.tr` being special. Not
  verified: that Amplify accepts `umutcelik.com.tr` as the root domain. If it rejects it,
  check the status reason and the hosted zone name.
- Status moves through values such as `PENDING_VERIFICATION` and `AVAILABLE`. The docs say
  DNS propagation and certificate issue can take up to 24 hours.

## Known risks

1. Workspace install from inside appRoot. The build starts in `web/`, so the install `cd`s to
   the root and back. Amplify's docs show only npm/Nx examples for this; the pnpm example is a
   one-line `npm install -g pnpm`. If the install or the artifact tracing fails, switch to the
   documented `buildPath: /` form: put `buildPath: /` under `frontend`, drop the `cd` steps,
   run `pnpm --filter web build`, write `web/.env.production`, and set `baseDirectory:
   web/.next`.
2. hoisted linker via flag. The docs ask for `node-linker=hoisted` in `.npmrc`. I used
   `--config.node-linker=hoisted` on `pnpm install` instead. That is a pnpm CLI feature, not
   an Amplify doc item, and I did not run it with pnpm 12.18.0. The safest fix is to add
   `node-linker=hoisted` to the root `.npmrc` and drop the flag. This also changes local
   installs, so test it locally first. `--filter "web..." --filter "db..."` also installs the
   Cloudflare dev dependencies (`wrangler`, `@opennextjs/cloudflare`) of `web`.
3. `postgres` as an external package at runtime. `serverExternalPackages` keeps `postgres` out
   of the bundle, so it must exist in `node_modules` at runtime. Amplify packages server
   dependencies from the build output and traced files. I found no doc that confirms how this
   works with a hoisted workspace root one level above `web/`. Check the first deploy:
   call `/api/calls/<id>` and read the CloudWatch SSR logs for `Cannot find module 'postgres'`.
   If it fails, try `outputFileTracingRoot: resolve(process.cwd(), '..')` in `next.config.ts`
   or move the DB call behind a different runtime.
4. Env at SSR runtime. Only variables written to `web/.env.production` reach the server, and
   only if the grep pattern matches. Secrets end up in the artifacts. A missing variable shows
   up as the route's own "not configured" error, not a build failure. After deploy, test
   `/api/token` once.
5. Cache. `node_modules/**/*` and `.next/cache/**/*` are cached relative to `web/`. With the
   hoisted root, most packages live in the root `node_modules`, which this cache does not
   cover, so installs may stay cold. Correct, only slower.
6. Lockfile. The build needs `pnpm-lock.yaml` committed and in sync
   (`--frozen-lockfile`). `allowBuilds` in `pnpm-workspace.yaml` is a pnpm 12 feature, so the
   Node and pnpm versions printed in `preBuild` matter when you read a failure.
