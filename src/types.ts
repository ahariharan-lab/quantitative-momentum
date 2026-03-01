export interface Env {
  MOMENTUM_CACHE: KVNamespace;
  DATA_API_KEY: string;
  REFRESH_SECRET: string;
}

export interface PriceBar {
  date: string;
  close: number;
}

export interface MomentumResult {
  ticker: string;
  momentum: {
    value: number;
    percentage: string;
    period: string;
  };
  fip: {
    score: number;
    quality: "smooth" | "moderate" | "lumpy";
    positive_days: string;
    negative_days: string;
  };
  data_range: {
    start: string;
    end: string;
    trading_days: number;
  };
  computed_at: string;
  error?: string;
}

export interface RankedResult extends MomentumResult {
  rank: number;
}

export interface ScreenResult {
  status: "ok" | "partial" | "stale";
  generated_at: string;
  next_refresh_hint: string;
  summary: {
    total_screened: number;
    total_errors: number;
    methodology: string;
  };
  results: RankedResult[];
  errors: { ticker: string; error: string }[] | null;
  methodology_notes: {
    momentum_period: string;
    fip_formula: string;
    fip_quality: Record<string, string>;
  };
}

export interface ConstituentRefreshResult {
  tickers: string[];
  added: string[];
  removed: string[];
  unchanged: number;
  source: "api" | "fallback";
  timestamp: string;
}

export interface ChangelogEntry {
  timestamp: string;
  added: string[];
  removed: string[];
}

export interface CronSummary {
  cron_id: "A" | "B" | "C";
  tickers_processed: number;
  tickers_errored: number;
  constituent_changes?: { added: string[]; removed: string[] };
  duration_ms: number;
  timestamp: string;
}
