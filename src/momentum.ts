import type { PriceBar, MomentumResult, RankedResult } from "./types.js";

const SKIP_RECENT = 21;   // ~1 month of trading days
const LOOKBACK = 252;     // ~12 months of trading days
const MIN_BARS = SKIP_RECENT + 2; // absolute minimum to compute anything

function qualityLabel(
  fip: number,
  _positive: boolean
): "smooth" | "moderate" | "lumpy" {
  // The sign() in the FIP formula already encodes direction, so thresholds
  // are the same regardless of whether momentum is positive or negative:
  //   smooth = consistent small moves in trend direction → FIP very negative
  //   lumpy  = few large moves → FIP positive
  if (fip < -0.1) return "smooth";
  if (fip <= 0.1) return "moderate";
  return "lumpy";
}

export function computeMomentum(
  prices: PriceBar[]
): { value: number; percentage: string; period: string; cutoffIdx: number; startIdx: number } {
  if (prices.length < MIN_BARS) {
    throw new Error(`Insufficient price data: ${prices.length} bars (need >= ${MIN_BARS})`);
  }

  const cutoffIdx = prices.length - 1 - SKIP_RECENT;
  const startIdx = Math.max(0, cutoffIdx - LOOKBACK);

  const endPrice = prices[cutoffIdx].close;
  const startPrice = prices[startIdx].close;

  if (startPrice === 0) throw new Error("Start price is zero — cannot compute momentum");

  const value = (endPrice - startPrice) / startPrice;
  const percentage = (value * 100).toFixed(2) + "%";

  return { value, percentage, period: "12-1 months", cutoffIdx, startIdx };
}

export function computeFIP(
  prices: PriceBar[],
  momentumValue: number,
  cutoffIdx: number,
  startIdx: number
): MomentumResult["fip"] {
  let positiveDays = 0;
  let negativeDays = 0;
  let totalDays = 0;

  for (let i = startIdx + 1; i <= cutoffIdx; i++) {
    const ret = (prices[i].close - prices[i - 1].close) / prices[i - 1].close;
    if (ret > 0) positiveDays++;
    else if (ret < 0) negativeDays++;
    totalDays++;
  }

  if (totalDays === 0) {
    throw new Error("No trading days in window for FIP computation");
  }

  const pctNeg = negativeDays / totalDays;
  const pctPos = positiveDays / totalDays;
  const score = Math.sign(momentumValue) * (pctNeg - pctPos);
  const quality = qualityLabel(score, momentumValue >= 0);

  return {
    score: parseFloat(score.toFixed(4)),
    quality,
    positive_days: (pctPos * 100).toFixed(1) + "%",
    negative_days: (pctNeg * 100).toFixed(1) + "%",
  };
}

export function computeResult(ticker: string, prices: PriceBar[]): MomentumResult {
  const computed_at = new Date().toISOString();

  try {
    const mom = computeMomentum(prices);
    const fip = computeFIP(prices, mom.value, mom.cutoffIdx, mom.startIdx);

    return {
      ticker,
      momentum: {
        value: parseFloat(mom.value.toFixed(6)),
        percentage: mom.percentage,
        period: mom.period,
      },
      fip,
      data_range: {
        start: prices[mom.startIdx].date,
        end: prices[mom.cutoffIdx].date,
        trading_days: mom.cutoffIdx - mom.startIdx,
      },
      computed_at,
    };
  } catch (err) {
    return {
      ticker,
      momentum: { value: 0, percentage: "0.00%", period: "12-1 months" },
      fip: { score: 0, quality: "moderate", positive_days: "0%", negative_days: "0%" },
      data_range: { start: "", end: "", trading_days: 0 },
      computed_at,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function rankResults(results: MomentumResult[]): RankedResult[] {
  const valid = results.filter((r) => !r.error);

  valid.sort((a, b) => {
    const momDiff = b.momentum.value - a.momentum.value;
    if (momDiff !== 0) return momDiff;
    // Tie-break: lower FIP score = smoother momentum = better rank
    return a.fip.score - b.fip.score;
  });

  return valid.map((r, i) => ({ ...r, rank: i + 1 }));
}
