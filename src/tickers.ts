export const SP100_TICKERS_FALLBACK: string[] = [
  "AAPL", "ABBV", "ABT", "ACN", "ADBE", "AIG", "AMD", "AMGN", "AMT", "AMZN",
  "AVGO", "AXP", "BA", "BAC", "BK", "BKNG", "BLK", "BMY", "BRK-B", "C",
  "CAT", "CL", "CMCSA", "COF", "COP", "COST", "CRM", "CSCO", "CVS", "CVX",
  "DE", "DHR", "DIS", "DUK", "EMR", "EXC", "F", "FDX", "GD", "GE",
  "GILD", "GM", "GOOGL", "GS", "HD", "HON", "IBM", "INTC", "INTU", "JNJ",
  "JPM", "KO", "LIN", "LLY", "LMT", "LOW", "MA", "MCD", "MDT", "MET",
  "META", "MMC", "MMM", "MO", "MRK", "MS", "MSFT", "NEE", "NFLX", "NKE",
  "NOW", "NVDA", "ORCL", "PEP", "PFE", "PG", "PM", "PYPL", "QCOM", "RTX",
  "SBUX", "SCHW", "SO", "SPG", "T", "TGT", "TJX", "TMO", "TMUS", "TSLA",
  "TXN", "UNH", "UNP", "UPS", "USB", "V", "VZ", "WFC", "WMT", "XOM",
]; // exactly 100 symbols

// Batch boundaries for the 3-cron pipeline
// For a 100-ticker list: A=[0,48), B=[48,96), C=[96,100)
export const BATCH_SPLIT_A = 48;
export const BATCH_SPLIT_B = 96;

export function getBatches(tickers: string[]): [string[], string[], string[]] {
  return [
    tickers.slice(0, BATCH_SPLIT_A),
    tickers.slice(BATCH_SPLIT_A, BATCH_SPLIT_B),
    tickers.slice(BATCH_SPLIT_B),
  ];
}

// Internal format → Twelve Data API format
export const SYMBOL_NORMALIZATION: Record<string, string> = {
  "BRK-B": "BRK/B",
};

export function normalizeForApi(ticker: string): string {
  return SYMBOL_NORMALIZATION[ticker] ?? ticker;
}

export function normalizeFromApi(ticker: string): string {
  const entry = Object.entries(SYMBOL_NORMALIZATION).find(([, v]) => v === ticker);
  return entry ? entry[0] : ticker;
}
