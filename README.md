# Quantitative Momentum

A serverless S&P 100 momentum screener built on **Cloudflare Workers**, implementing the quantitative momentum strategy from *Quantitative Momentum* by Wesley Gray and Jack Vogel.

All momentum calculations run in three staggered cron jobs every 8 hours. HTTP endpoints are pure KV reads — zero live API calls in the request path, sub-millisecond response times. Runs entirely on Cloudflare's free tier.

Data source: [Twelve Data API](https://twelvedata.com) (free tier: 800 requests/day).

---

## Methodology

### 12-1 Month Momentum

Returns over the past 12 months, **excluding the most recent month**. Skipping the final month avoids the well-documented short-term reversal effect.

### Frog-in-the-Pan (FIP) Quality Score

Measures whether momentum arrived smoothly (many small gains) or lumpily (few large jumps):

```
FIP = sign(momentum) × (% negative days − % positive days)
```

- **Smooth momentum** — many small daily gains — consistent, reliable signal — preferred
- **Lumpy momentum** — few large jumps — often news-driven, less reliable

For positive-momentum stocks, a **more negative FIP score** indicates smoother, higher-quality momentum.

| FIP Score   | Quality  | Interpretation                              |
|-------------|----------|---------------------------------------------|
| < −0.1      | Smooth   | Consistent daily gains — high quality       |
| −0.1 to 0.1 | Moderate | Mixed pattern                               |
| > 0.1       | Lumpy    | Driven by few large moves — less reliable   |

---

## Architecture

Three cron triggers run in sequence, each writing pre-computed results to Cloudflare KV:

```
Cron A  00:00, 12:00 UTC   constituent refresh + tickers[0..47]   → momentum:partial:0
Cron B  04:00, 16:00 UTC   tickers[48..95]                        → momentum:partial:1
Cron C  08:00, 20:00 UTC   tickers[96..99] + merge A+B+C          → screen:sp100:latest
```

Full refresh every **8 hours**. HTTP endpoints read from KV — no live fetches, no computation in the request path. The rate limiter fetches 6 tickers in parallel with a 45-second delay between batches to stay within Twelve Data's 8 requests/minute limit.

---

## API Endpoints

All responses are JSON with CORS headers. Base URL after deployment:
`https://quantitative-momentum.<subdomain>.workers.dev`

### `GET /health`

```json
{
  "status": "healthy",
  "service": "quantitative-momentum",
  "version": "1.0.0",
  "universe": "S&P 100 (dynamic)",
  "plan": "free",
  "refresh_schedule": "every 12 hours via 3-cron pipeline"
}
```

### `GET /screen?top=N`

Full ranked screen. Optional `top` parameter limits results (1–100).

```bash
curl https://quantitative-momentum.<subdomain>.workers.dev/screen?top=10
```

```json
{
  "status": "ok",
  "generated_at": "2025-01-15T08:01:23.000Z",
  "summary": {
    "total_screened": 98,
    "total_errors": 2,
    "methodology": "Quantitative Momentum (Gray & Vogel)"
  },
  "results": [
    {
      "rank": 1,
      "ticker": "NVDA",
      "momentum": { "value": 0.8921, "percentage": "89.21%", "period": "12-1 months" },
      "fip": { "score": -0.1234, "quality": "smooth", "positive_days": "58.3%", "negative_days": "41.7%" },
      "data_range": { "start": "2024-01-15", "end": "2024-12-15", "trading_days": 231 }
    }
  ],
  "methodology_notes": { "..." : "..." }
}
```

### `GET /momentum/:ticker`

Single ticker result from the pre-computed screen.

```bash
curl https://quantitative-momentum.<subdomain>.workers.dev/momentum/AAPL
```

Returns 404 if the ticker is not in the S&P 100, or 503 if the pipeline has not run yet.

### `GET /universe`

Active ticker list with the timestamp of the last constituent refresh.

### `GET /universe/changelog`

History of S&P 100 constituent changes (additions and removals), stored as the last 50 entries.

### `GET /status`

Cron pipeline status — when each cron last ran, how many tickers were processed, and any errors.

---

## Setup

### Prerequisites

1. **Node.js 18+**
2. **Cloudflare account** — [sign up free](https://dash.cloudflare.com/sign-up)
3. **Twelve Data API key** — [get a free key](https://twelvedata.com/pricing)

### Install

```bash
git clone https://github.com/ahariharan-lab/quantitative-momentum.git
cd quantitative-momentum
npm install
```

### Configure Cloudflare

```bash
# Authenticate Wrangler
npx wrangler login

# Create the KV namespace
npx wrangler kv:namespace create MOMENTUM_CACHE
# Copy the namespace ID from the output, then update wrangler.toml:
# Replace REPLACE_WITH_YOUR_KV_NAMESPACE_ID with the actual ID
```

### Set Secrets

```bash
npx wrangler secret put DATA_API_KEY    # your Twelve Data API key
npx wrangler secret put REFRESH_SECRET  # any random string
```

### Test & Deploy

```bash
npm test           # run 49 unit tests (mocked — no real API calls)
npx tsc --noEmit   # type check
npm run deploy     # deploy to Cloudflare Workers
```

### Bootstrap KV (one-time)

After deploying, trigger the cron pipeline once to populate KV before the first scheduled run:

```bash
npx wrangler dev &
sleep 3

# Trigger each cron in sequence — wait for each to finish before the next
curl "http://localhost:8787/__scheduled?cron=0+0%2C12+*+*+*"   # Cron A (~6 min)
# wait for it to finish in the wrangler dev output, then:
curl "http://localhost:8787/__scheduled?cron=0+4%2C16+*+*+*"   # Cron B (~6 min)
# wait, then:
curl "http://localhost:8787/__scheduled?cron=0+8%2C20+*+*+*"   # Cron C (~30 sec)

# Verify
curl "http://localhost:8787/screen?top=5" | jq '.results[] | {rank, ticker, momentum: .momentum.percentage}'

kill %1
```

Total bootstrap time: ~13 minutes (Twelve Data rate limiting: 8 requests/minute).

---

## Development

```bash
npm test              # run all 49 tests once
npm run test:watch    # watch mode
npx wrangler dev      # local dev server with KV simulation
```

Tests use mocked `fetch` and `KVNamespace` — no real API calls are made.

---

## References

- Gray, W. R., & Vogel, J. R. (2016). *Quantitative Momentum: A Practitioner's Guide to Building a Momentum-Based Stock Selection System*. Wiley.
- [Twelve Data API](https://twelvedata.com)
- [Cloudflare Workers](https://workers.cloudflare.com)

## License

MIT License
