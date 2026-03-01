import type { Env, MomentumResult, ScreenResult, CronSummary } from "./types.js";
import { getBatches } from "./tickers.js";
import { refreshConstituents, getActiveTickers } from "./constituents.js";
import { rateLimitedBatchFetch } from "./data.js";
import { computeResult, rankResults } from "./momentum.js";
import {
  KV_KEYS,
  getPartial,
  setPartial,
  setScreenResult,
  setCronSummary,
} from "./cache.js";

const METHODOLOGY_NOTES: ScreenResult["methodology_notes"] = {
  momentum_period: "12-1 months (skip most recent month to avoid short-term reversal)",
  fip_formula: "sign(momentum) × (% negative days − % positive days)",
  fip_quality: {
    smooth: "Consistent daily gains (FIP < -0.1 for positive momentum) — preferred",
    moderate: "Mixed pattern (-0.1 to 0.1)",
    lumpy: "Driven by few large moves (FIP > 0.1 for positive momentum) — less reliable",
  },
};

function buildCronSummary(
  id: "A" | "B" | "C",
  results: MomentumResult[],
  t0: number,
  constituentChanges?: { added: string[]; removed: string[] }
): CronSummary {
  return {
    cron_id: id,
    tickers_processed: results.filter((r) => !r.error).length,
    tickers_errored: results.filter((r) => !!r.error).length,
    constituent_changes: constituentChanges,
    duration_ms: Date.now() - t0,
    timestamp: new Date().toISOString(),
  };
}

// ─── Cron A ──────────────────────────────────────────────────────────────────
// Runs at 00:00, 12:00 UTC
// Responsibilities: constituent refresh + tickers[0..47] prices + store partial:0

export async function runCronA(env: Env): Promise<CronSummary> {
  const t0 = Date.now();

  // 1. Refresh constituents (1 subrequest)
  const constituentResult = await refreshConstituents(
    env.MOMENTUM_CACHE,
    env.DATA_API_KEY
  );

  // 2. Slice batch A
  const [batchA] = getBatches(constituentResult.tickers);

  // 3. Fetch price series for batch A (up to 48 subrequests, rate-limited)
  const fetchResults = await rateLimitedBatchFetch(batchA, env.DATA_API_KEY);

  // 4. Compute momentum + FIP for each ticker
  const momentumResults: MomentumResult[] = fetchResults.map(({ ticker, prices, error }) => {
    if (!prices || error) {
      return computeResult(ticker, []); // returns error result
    }
    return computeResult(ticker, prices);
  });

  // 5. Store partial A (1 KV write = 1 subrequest)
  await setPartial(env.MOMENTUM_CACHE, KV_KEYS.MOMENTUM_PARTIAL_A, momentumResults);

  const summary = buildCronSummary("A", momentumResults, t0, {
    added: constituentResult.added,
    removed: constituentResult.removed,
  });

  await setCronSummary(env.MOMENTUM_CACHE, "A", summary);
  return summary;
}

// ─── Cron B ──────────────────────────────────────────────────────────────────
// Runs at 04:00, 16:00 UTC
// Responsibilities: tickers[48..95] prices + store partial:1

export async function runCronB(env: Env): Promise<CronSummary> {
  const t0 = Date.now();

  // 1. Read active tickers (1 KV read = 1 subrequest)
  const allTickers = await getActiveTickers(env.MOMENTUM_CACHE);
  const [, batchB] = getBatches(allTickers);

  // 2. Fetch and compute
  const fetchResults = await rateLimitedBatchFetch(batchB, env.DATA_API_KEY);
  const momentumResults: MomentumResult[] = fetchResults.map(({ ticker, prices, error }) => {
    if (!prices || error) return computeResult(ticker, []);
    return computeResult(ticker, prices);
  });

  // 3. Store partial B (1 KV write)
  await setPartial(env.MOMENTUM_CACHE, KV_KEYS.MOMENTUM_PARTIAL_B, momentumResults);

  const summary = buildCronSummary("B", momentumResults, t0);
  await setCronSummary(env.MOMENTUM_CACHE, "B", summary);
  return summary;
}

// ─── Cron C ──────────────────────────────────────────────────────────────────
// Runs at 08:00, 20:00 UTC
// Responsibilities: tickers[96..99] + merge A+B+C + store final ScreenResult

export async function runCronC(env: Env): Promise<CronSummary> {
  const t0 = Date.now();

  // 1. Read active tickers + batch C slice
  const allTickers = await getActiveTickers(env.MOMENTUM_CACHE);
  const [, , batchC] = getBatches(allTickers);

  // 2. Fetch batch C (tiny — typically 4 tickers, 1 network batch, no sleep needed)
  const fetchResults = await rateLimitedBatchFetch(batchC, env.DATA_API_KEY);
  const batchCResults: MomentumResult[] = fetchResults.map(({ ticker, prices, error }) => {
    if (!prices || error) return computeResult(ticker, []);
    return computeResult(ticker, prices);
  });

  // 3. Read partials A and B (2 KV reads)
  const partialA = await getPartial(env.MOMENTUM_CACHE, KV_KEYS.MOMENTUM_PARTIAL_A);
  const partialB = await getPartial(env.MOMENTUM_CACHE, KV_KEYS.MOMENTUM_PARTIAL_B);

  const allResults = [
    ...(partialA ?? []),
    ...(partialB ?? []),
    ...batchCResults,
  ];

  // 4. Rank valid results
  const ranked = rankResults(allResults);
  const errors = allResults
    .filter((r) => !!r.error)
    .map((r) => ({ ticker: r.ticker, error: r.error! }));

  // 5. Build ScreenResult
  const status: ScreenResult["status"] =
    partialA === null || partialB === null ? "partial" : "ok";

  const screenResult: ScreenResult = {
    status,
    generated_at: new Date().toISOString(),
    next_refresh_hint: "in ~4 hours",
    summary: {
      total_screened: ranked.length,
      total_errors: errors.length,
      methodology: "Quantitative Momentum (Gray & Vogel)",
    },
    results: ranked,
    errors: errors.length > 0 ? errors : null,
    methodology_notes: METHODOLOGY_NOTES,
  };

  // 6. Persist screen result + partial C (2 KV writes)
  await setScreenResult(env.MOMENTUM_CACHE, screenResult);
  await setPartial(env.MOMENTUM_CACHE, KV_KEYS.MOMENTUM_PARTIAL_C, batchCResults);

  const summary = buildCronSummary("C", allResults, t0);
  await setCronSummary(env.MOMENTUM_CACHE, "C", summary);
  return summary;
}
