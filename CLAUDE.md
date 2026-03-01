# quantitative-momentum-worker — Claude Code Instructions

## What this project is
A Cloudflare Worker (TypeScript) that screens S&P 100 stocks by quantitative momentum
(12-1 month return) and FIP quality score. Designed for the Workers **free plan**.
All computation runs in 3 staggered cron triggers; HTTP endpoints are pure KV reads.

---

## Your first task when starting a session

Run this immediately to orient yourself:

```bash
cat CLAUDE.md                        # this file — read it fully first
ls src/                              # source modules
npx vitest run --reporter=verbose    # confirm all 49 tests pass before touching anything
wrangler whoami                      # confirm auth
wrangler kv:namespace list           # confirm MOMENTUM_CACHE namespace exists
```

If tests fail before you've changed anything, stop and report the failures — do not proceed.

---

## Prerequisites the human must complete before you run anything

The human must have already done these steps manually. Verify each one:

1. **Node.js 18+** — `node --version` should print v18 or higher
2. **Wrangler authenticated** — `wrangler whoami` should print their Cloudflare account name
3. **KV namespace created** — `wrangler kv:namespace list` should show a namespace named `MOMENTUM_CACHE`
4. **wrangler.toml patched** — `grep REPLACE wrangler.toml` should return nothing (ID already substituted)
5. **Secrets set** — verify with:
   ```bash
   wrangler secret list   # should show DATA_API_KEY and REFRESH_SECRET
   ```

If any of these are missing, stop and tell the human exactly which step to complete.
Do NOT attempt to set secrets, create namespaces, or log in on their behalf.

---

## Deployment procedure (run in this exact order)

### Step 1 — Install dependencies
```bash
npm install
```

### Step 2 — Run full test suite
```bash
npx vitest run --reporter=verbose
```
All 49 tests must pass. If any fail, fix them before proceeding. Do not deploy broken code.

### Step 3 — Type-check
```bash
npx tsc --noEmit
```
Fix any type errors before proceeding.

### Step 4 — Deploy
```bash
wrangler deploy
```
Note the deployed URL from the output — it will be:
`https://quantitative-momentum.<subdomain>.workers.dev`

### Step 5 — Verify health endpoint
```bash
curl -s https://quantitative-momentum.<subdomain>.workers.dev/health | jq .
```
Expected: `{ "status": "healthy", ... }`

### Step 6 — Bootstrap KV (critical — do before waiting for crons)
Trigger the 3-cron pipeline in sequence. Wait for each to finish before triggering the next.
In production, use the Cloudflare dashboard "Test" button for scheduled events, OR:

```bash
# Option A: Use wrangler dev to bootstrap locally first (recommended)
wrangler dev &
sleep 3

# Trigger each cron in sequence (wait ~10 min between A and B for rate limiter)
curl "http://localhost:8787/__scheduled?cron=0+0%2C12+*+*+*"   # Cron A
# Wait for it to complete in the wrangler dev terminal output, then:
curl "http://localhost:8787/__scheduled?cron=0+4%2C16+*+*+*"   # Cron B
# Wait, then:
curl "http://localhost:8787/__scheduled?cron=0+8%2C20+*+*+*"   # Cron C

# Verify screen data was produced
curl "http://localhost:8787/screen?top=5" | jq '.results[] | {rank, ticker, momentum: .momentum.percentage, quality: .fip.quality}'

kill %1  # stop wrangler dev
```

Note: In `wrangler dev`, the 45-second sleep between batch chunks is real. Cron A takes
~6 minutes to fetch all 48 tickers. Cron B takes ~6 minutes. Cron C is fast (~30 seconds).
Total bootstrap time: ~13 minutes.

### Step 7 — Smoke test production endpoints
```bash
BASE="https://quantitative-momentum.<subdomain>.workers.dev"

curl -s "$BASE/health" | jq .
curl -s "$BASE/universe" | jq '{count: .count, last_updated: .last_updated}'
curl -s "$BASE/screen?top=10" | jq '.results[] | {rank, ticker, momentum: .momentum.percentage, fip_quality: .fip.quality}'
curl -s "$BASE/momentum/NVDA" | jq '{rank, ticker, momentum: .momentum.percentage}'
curl -s "$BASE/status" | jq .
```

---

## Project structure

```
src/
  types.ts         — all TypeScript interfaces (Env, PriceBar, MomentumResult, etc.)
  tickers.ts       — 100-ticker fallback list, getBatches(), normalizeForApi/FromApi()
  constituents.ts  — fetchLiveConstituents(), getActiveTickers(), refreshConstituents()
  data.ts          — fetchPriceSeries(), rateLimitedBatchFetch(), sleep()
  momentum.ts      — computeMomentum(), computeFIP(), computeResult(), rankResults()
  cache.ts         — all KV read/write helpers, KV_KEYS constants
  pipeline.ts      — runCronA(), runCronB(), runCronC()
  index.ts         — fetch() HTTP router + scheduled() cron dispatcher

test/
  momentum.test.ts — 49 tests across all modules
```

---

## Key constraints (free plan — never violate these)

| Constraint | Limit | How we comply |
|---|---|---|
| CPU time per HTTP request | 10ms | All endpoints are pure KV reads — zero computation |
| CPU time per cron | 30ms | Computation is simple JS math, no heavy loops |
| Subrequests per invocation | 50 | Cron A = 50 exactly; B = 49; C = 8 |
| Simultaneous outgoing connections | 6 | rateLimitedBatchFetch uses chunks of 6 |
| Cron triggers per account | 5 | We use 3 |

**Never add live API calls to HTTP handlers.** Any fetch() in the request path will blow
the 10ms CPU and 50 subrequest limits on cache misses.

---

## Cron schedule (UTC)

```
Cron A: 0 0,12 * * *   — constituent refresh + tickers[0..47]  → writes momentum:partial:0
Cron B: 0 4,16 * * *   — tickers[48..95]                       → writes momentum:partial:1
Cron C: 0 8,20 * * *   — tickers[96..99] + merge A+B+C         → writes screen:sp100:latest
```

Full refresh cycle: 8 hours. Data is at most 12 hours stale.

---

## Twelve Data API rate limits

- Free tier: 800 requests/day, 8 requests/minute
- We use: ~202 requests/day (100 tickers × 2 cycles + 2 constituent calls)
- `rateLimitedBatchFetch` enforces: 6 parallel fetches, 45-second delay between chunks
- **Never remove or shorten the 45-second sleep** — it will cause HTTP 429 rate limit errors

---

## KV key reference

```
constituents:sp100:current     — JSON string[] of active tickers (no TTL)
constituents:sp100:last_updated — ISO timestamp of last constituent refresh
constituents:sp100:changelog    — JSON ChangelogEntry[] (last 50 entries, no TTL)
momentum:partial:0              — JSON MomentumResult[] for tickers[0..47] (no TTL)
momentum:partial:1              — JSON MomentumResult[] for tickers[48..95] (no TTL)
momentum:partial:2              — JSON MomentumResult[] for tickers[96..99] (no TTL)
screen:sp100:latest             — JSON ScreenResult (full ranked output, no TTL)
cron:summary:A/B/C              — JSON CronSummary (TTL: 48 hours)
```

To inspect KV values directly:
```bash
wrangler kv:key get "screen:sp100:latest" --binding MOMENTUM_CACHE | jq '.summary'
wrangler kv:key get "constituents:sp100:last_updated" --binding MOMENTUM_CACHE
wrangler kv:key get "cron:summary:C" --binding MOMENTUM_CACHE | jq .
```

---

## Debugging runbook

### "Data not yet available" on /screen
Cron C hasn't run yet. Check:
```bash
wrangler kv:key get "momentum:partial:0" --binding MOMENTUM_CACHE | jq 'length'
wrangler kv:key get "momentum:partial:1" --binding MOMENTUM_CACHE | jq 'length'
```
If partials are null, Crons A/B haven't run. Trigger them via wrangler dev or wait.

### status: "partial" in ScreenResult
One of the partials was missing when Cron C ran. Check cron summaries:
```bash
wrangler kv:key get "cron:summary:A" --binding MOMENTUM_CACHE | jq '{processed: .tickers_processed, errored: .tickers_errored, ts: .timestamp}'
```

### HTTP 429 from Twelve Data
The 45-second sleep in `rateLimitedBatchFetch` was bypassed or Twelve Data's daily limit
was hit. Check remaining quota at twelvedata.com dashboard. Daily reset is at midnight UTC.

### Constituent fetch returning "fallback"
Twelve Data's `/constituents?index=OEX` endpoint is returning an error.
Check `DATA_API_KEY` secret is set correctly:
```bash
wrangler secret list
```
The fallback keeps the last known good list — data stays valid, just won't pick up changes.

---

## How to update the KV namespace ID in wrangler.toml

If the human hasn't done this yet:
```bash
wrangler kv:namespace list | jq '.[] | select(.title == "MOMENTUM_CACHE") | .id'
```
Copy the ID, then update wrangler.toml:
```toml
[[kv_namespaces]]
binding = "MOMENTUM_CACHE"
id = "<paste-id-here>"
```

---

## Running tests

```bash
npx vitest run                          # run once
npx vitest run --reporter=verbose       # with full test names
npx vitest                              # watch mode
npx vitest run test/momentum.test.ts    # single file
```

Tests use mocked fetch and KV — no real API calls are made during testing.
The "fetch failed" stderr output in refreshConstituents tests is intentional
(testing the graceful fallback path).

---

## What NOT to do

- Do not add `fetch()` calls to HTTP handler paths
- Do not remove the `sleep(45_000)` between batch chunks in `rateLimitedBatchFetch`
- Do not set secrets via code — always use `wrangler secret put`
- Do not commit `wrangler.toml` with real KV IDs to public repos
- Do not increase BATCH_SPLIT_A beyond 48 (breaks the 50-subrequest budget for Cron A)
- Do not run `wrangler deploy` without passing tests first
