import type { PriceBar } from "./types.js";
import { normalizeForApi } from "./tickers.js";

const BATCH_SIZE = 6;
const BATCH_DELAY_MS = 45_000;
const OUTPUTSIZE = 280; // ~13 months of trading days

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPriceSeries(
  ticker: string,
  apiKey: string
): Promise<PriceBar[]> {
  const apiTicker = normalizeForApi(ticker);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(apiTicker)}&interval=1day&outputsize=${OUTPUTSIZE}&apikey=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Twelve Data HTTP ${response.status} for ${ticker}`);
  }

  const json = (await response.json()) as {
    code?: number;
    message?: string;
    values?: { datetime: string; close: string }[];
  };

  if (json.code !== undefined || !json.values) {
    throw new Error(
      `Twelve Data API error for ${ticker}: ${json.message ?? "unknown error"}`
    );
  }

  const bars: PriceBar[] = json.values.map((v) => ({
    date: v.datetime,
    close: parseFloat(v.close),
  }));

  // Sort ascending (oldest first)
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return bars;
}

export async function rateLimitedBatchFetch(
  tickers: string[],
  apiKey: string
): Promise<{ ticker: string; prices: PriceBar[] | null; error?: string }[]> {
  const results: { ticker: string; prices: PriceBar[] | null; error?: string }[] = [];
  const chunks: string[][] = [];

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    chunks.push(tickers.slice(i, i + BATCH_SIZE));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];

    const chunkResults = await Promise.all(
      chunk.map(async (ticker) => {
        try {
          const prices = await fetchPriceSeries(ticker, apiKey);
          return { ticker, prices, error: undefined };
        } catch (err) {
          return {
            ticker,
            prices: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    results.push(...chunkResults);

    // Sleep between chunks but NOT after the last chunk
    if (ci < chunks.length - 1) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return results;
}
