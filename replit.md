# JobPilot

JobPilot helps users discover, evaluate, prepare, batch, and track job applications from one workspace.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/jobpilot` — React application
- `artifacts/api-server/src/routes/jobpilot.ts` — application API handlers
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `lib/db/src/schema/jobpilot.ts` — persisted product data

## Architecture decisions

- Review-first and controlled batch application modes are equally important product paths.
- Batch mode is opt-in and configurable, with fit thresholds, daily caps, pacing, and hard stops for CAPTCHA, MFA, and sensitive answers.
- PostgreSQL persists application state; all frontend server state uses generated OpenAPI hooks.

## Product

The first release includes an operational dashboard, job discovery queue, application pipeline, editable career profile, activity feed, and controlled batch engine.

## User preferences

- Do not reduce the product to human-approved applications only; retain controlled mass-submission capability as a core mode.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, always run API codegen before editing consumers.
- The app uses the root preview path; API calls use `/api` through the shared proxy.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
