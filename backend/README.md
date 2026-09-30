# Shared placement backend

The GitHub Pages frontend calls a Cloudflare Worker, which stores the one shared
State 798 placement draft and revision history in D1. Public GET routes show the
current draft, history list, and individual snapshots.
PUT requires `EDITOR_KEY` and the revision last read by the editor. A stale
revision returns HTTP 409 and the frontend reloads the latest draft. Restoring an
old snapshot also requires the key and creates a new revision.

## Deploy

Run these commands from this directory after `npx wrangler login`:

```
npx wrangler d1 create state-798-placement
```

Copy the returned database ID into `wrangler.toml`, replacing the all-zero local
placeholder. Then:

```
npx wrangler d1 execute state-798-placement --remote --file=schema.sql
npx wrangler secret put EDITOR_KEY
npx wrangler deploy
```

For an existing database created before history support, first apply
`migrations/001_history.sql` with `--remote`. It records the current draft as the
first baseline entry; older drafts cannot be recovered.

Generate a long random editor key and enter it at Wrangler's secret prompt. Keep
it out of source control. Put the resulting Worker URL in `placement-config.js`.
The GitHub Pages origin is allowlisted in `worker.js`.

## Local checks

```
npx wrangler d1 execute state-798-placement --local --file=schema.sql
npx wrangler dev --local --port 8787 --var EDITOR_KEY:local-test-key
node test-api.mjs
```

From the repository root, `node planner.test.cjs` checks manual locks, wedge
refill, pair swaps, and draft validation. `node backend/test-validation.mjs` checks
the API's draft and plan identity validation. D1 retains revision snapshots until
explicitly removed. The editor key can be rotated
with `npx wrangler secret put EDITOR_KEY`.
