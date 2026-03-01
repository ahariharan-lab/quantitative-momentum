import type { Env } from "./types.js";
import type { ScreenResult, RankedResult, CronSummary } from "./types.js";
import { getActiveTickers } from "./constituents.js";
import {
  getScreenResult,
  getCronSummary,
  getConstituentsUpdated,
  getChangelog,
} from "./cache.js";
import { runCronA, runCronB, runCronC } from "./pipeline.js";

// ─── CORS headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function err(message: string, code: string, status: number): Response {
  return json({ error: message, code }, status);
}

// ─── HTML rendering ──────────────────────────────────────────────────────────

function isHtmlRequest(request: Request): boolean {
  return (request.headers.get("Accept") ?? "").includes("text/html");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlPage(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)}</title>` +
    `<style>*{margin:0;padding:0;box-sizing:border-box}` +
    `body{background:#0d1117;color:#c9d1d9;font-family:'Courier New',Courier,monospace;` +
    `font-size:13px;padding:2rem;line-height:1.6}` +
    `.h{color:#58a6ff}.ok{color:#3fb950}.warn{color:#d29922}.err{color:#f85149}` +
    `.dim{color:#6e7681}</style>` +
    `</head><body><pre>${body}</pre></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS } }
  );
}

function fmtTs(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

// ─── /screen table ───────────────────────────────────────────────────────────

function renderScreenHtml(result: ScreenResult, rows: RankedResult[]): string {
  const W = { rank: 4, ticker: 6, mom: 10, quality: 8, range: 23 };

  const hr = (l: string, j: string, r: string): string =>
    `${l}${"─".repeat(W.rank + 2)}${j}${"─".repeat(W.ticker + 2)}${j}` +
    `${"─".repeat(W.mom + 2)}${j}${"─".repeat(W.quality + 2)}${j}` +
    `${"─".repeat(W.range + 2)}${r}`;

  const row = (rank: string, ticker: string, mom: string, quality: string, range: string): string =>
    `│ ${rank.padStart(W.rank)} │ ${ticker.padEnd(W.ticker)} │ ` +
    `${mom.padStart(W.mom)} │ ${quality.padEnd(W.quality)} │ ${range.padEnd(W.range)} │`;

  const hdr = row("#", "Ticker", "Momentum", "Quality", "Data Range");

  const dataRows = rows.map(r => {
    const pct = r.momentum.percentage;
    const mom = (pct.startsWith("-") ? "" : "+") + pct;
    const range = `${r.data_range.start} \u2192 ${r.data_range.end}`;
    return row(String(r.rank), r.ticker, mom, r.fip.quality, range);
  });

  const statusClass = result.status === "ok" ? "ok" : result.status === "partial" ? "warn" : "err";

  return [
    `<span class="h">S&amp;P 100 Quantitative Momentum Screen</span>`,
    ``,
    `  Generated  ${esc(fmtTs(result.generated_at))}`,
    `  Screened   ${result.summary.total_screened} stocks` +
      (result.summary.total_errors ? `   <span class="warn">Errors ${result.summary.total_errors}</span>` : "") +
      `   Status <span class="${statusClass}">${result.status}</span>`,
    `  Method     ${esc(result.summary.methodology)}`,
    ``,
    hr("┌", "┬", "┐"),
    hdr,
    hr("├", "┼", "┤"),
    ...dataRows,
    hr("└", "┴", "┘"),
  ].join("\n");
}

// ─── /momentum/:ticker detail ─────────────────────────────────────────────────

function renderTickerHtml(r: RankedResult, total: number): string {
  const pct = r.momentum.percentage;
  const mom = (pct.startsWith("-") ? "" : "+") + pct;
  const momClass = pct.startsWith("-") ? "err" : "ok";
  const qualityClass = r.fip.quality === "smooth" ? "ok" : r.fip.quality === "lumpy" ? "err" : "warn";

  const kv = (label: string, value: string, cls = ""): string =>
    `  ${label.padEnd(12)}${cls ? `<span class="${cls}">${esc(value)}</span>` : esc(value)}`;

  return [
    `<span class="h">${esc(r.ticker)}</span>  Momentum Detail`,
    ``,
    kv("Rank", `#${r.rank} of ${total}`),
    kv("Momentum", mom, momClass),
    kv("Quality", r.fip.quality, qualityClass),
    kv("Positive", `${r.fip.positive_days} of trading days up`),
    kv("Negative", `${r.fip.negative_days} of trading days down`),
    kv("Period", r.momentum.period),
    kv("Data Range", `${r.data_range.start} \u2192 ${r.data_range.end}  (${r.data_range.trading_days} days)`),
    kv("Computed", fmtTs(r.computed_at)),
  ].join("\n");
}

// ─── /status view ────────────────────────────────────────────────────────────

function renderStatusHtml(
  a: CronSummary | null,
  b: CronSummary | null,
  c: CronSummary | null
): string {
  const cronRow = (label: string, schedule: string, s: CronSummary | null): string => {
    if (!s) return `  ${label}  <span class="dim">never run</span>`;
    const errPart = s.tickers_errored
      ? `   <span class="warn">errors ${s.tickers_errored}</span>`
      : "";
    return `  ${label}  processed ${String(s.tickers_processed).padStart(3)}${errPart}   ${esc(fmtTs(s.timestamp))}   <span class="dim">${schedule}</span>`;
  };

  return [
    `<span class="h">Pipeline Status</span>`,
    ``,
    cronRow("Cron A", "0 0,12 * * *", a),
    cronRow("Cron B", "0 4,16 * * *", b),
    cronRow("Cron C", "0 8,20 * * *", c),
    ``,
    `  <span class="dim">Full refresh cycle: 8 h   Data at most 12 h stale</span>`,
  ].join("\n");
}

// ─── /health view ────────────────────────────────────────────────────────────

function renderHealthHtml(): string {
  return [
    `<span class="h">Quantitative Momentum Worker</span>`,
    ``,
    `  Status    <span class="ok">healthy</span>`,
    `  Universe  S&amp;P 100 (dynamic)`,
    `  Version   1.0.0`,
    `  Plan      Cloudflare Workers Free`,
    `  Refresh   every 12 hours via 3-cron pipeline`,
    ``,
    `  <span class="dim">Endpoints</span>`,
    `  /screen             ranked momentum results`,
    `  /screen?top=N       top N results`,
    `  /momentum/:ticker   single ticker detail`,
    `  /status             pipeline cron status`,
    `  /universe           active S&amp;P 100 tickers`,
  ].join("\n");
}

// ─── HTTP Router ─────────────────────────────────────────────────────────────

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();
  const html = isHtmlRequest(request);

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // GET /health
  if (method === "GET" && pathname === "/health") {
    if (html) return htmlPage("Momentum Worker", renderHealthHtml());
    return json({
      status: "healthy",
      service: "quantitative-momentum",
      version: "1.0.0",
      universe: "S&P 100 (dynamic)",
      plan: "free",
      refresh_schedule: "every 12 hours via 3-cron pipeline",
    });
  }

  // GET /universe
  if (method === "GET" && pathname === "/universe") {
    const tickers = await getActiveTickers(env.MOMENTUM_CACHE);
    const last_updated = await getConstituentsUpdated(env.MOMENTUM_CACHE);
    if (html) {
      const cols = 10;
      const rows: string[] = [];
      for (let i = 0; i < tickers.length; i += cols) {
        rows.push("  " + tickers.slice(i, i + cols).map(t => t.padEnd(7)).join(" "));
      }
      const body = [
        `<span class="h">S&amp;P 100 Universe</span>  ${tickers.length} tickers`,
        `  Last updated  ${esc(last_updated ? fmtTs(last_updated) : "never")}`,
        ``,
        ...rows,
      ].join("\n");
      return htmlPage("S&P 100 Universe", body);
    }
    return json({ tickers, count: tickers.length, last_updated: last_updated ?? "never", source: "live" });
  }

  // GET /universe/changelog
  if (method === "GET" && pathname === "/universe/changelog") {
    const changelog = await getChangelog(env.MOMENTUM_CACHE);
    return json({ changelog, count: changelog.length });
  }

  // GET /screen
  if (method === "GET" && pathname === "/screen") {
    const topParam = url.searchParams.get("top");
    const top = topParam ? Math.min(100, Math.max(1, parseInt(topParam, 10))) : null;

    const result = await getScreenResult(env.MOMENTUM_CACHE);
    if (!result) {
      return err(
        "Data not yet available. Pipeline initializing — check back after 08:00 UTC.",
        "DATA_PENDING",
        503
      );
    }

    const slicedResults = top ? result.results.slice(0, top) : result.results;
    if (html) return htmlPage("Momentum Screen", renderScreenHtml(result, slicedResults));
    return json({ ...result, results: slicedResults, cache_hit: true });
  }

  // GET /momentum/:ticker
  const tickerMatch = pathname.match(/^\/momentum\/([A-Z0-9\-\.]+)$/i);
  if (method === "GET" && tickerMatch) {
    const ticker = tickerMatch[1].toUpperCase();

    const result = await getScreenResult(env.MOMENTUM_CACHE);
    if (!result) {
      return err("Data not yet available. Pipeline initializing.", "DATA_PENDING", 503);
    }

    const found = result.results.find((r) => r.ticker.toUpperCase() === ticker);
    if (!found) {
      return err(
        `${ticker} not found. Either not in the S&P 100 or data is still pending.`,
        "TICKER_NOT_FOUND",
        404
      );
    }

    if (html) return htmlPage(`${found.ticker} — Momentum`, renderTickerHtml(found, result.summary.total_screened));
    return json(found);
  }

  // GET /status
  if (method === "GET" && pathname === "/status") {
    const [a, b, c] = await Promise.all([
      getCronSummary(env.MOMENTUM_CACHE, "A"),
      getCronSummary(env.MOMENTUM_CACHE, "B"),
      getCronSummary(env.MOMENTUM_CACHE, "C"),
    ]);

    if (html) return htmlPage("Pipeline Status", renderStatusHtml(a, b, c));
    return json({
      pipeline: {
        cron_a: a ?? { status: "never_run" },
        cron_b: b ?? { status: "never_run" },
        cron_c: c ?? { status: "never_run" },
      },
      schedule: {
        cron_a: "0 0,12 * * * (UTC)",
        cron_b: "0 4,16 * * * (UTC)",
        cron_c: "0 8,20 * * * (UTC) — MERGE + publish screen result",
      },
    });
  }

  return err("Not found", "NOT_FOUND", 404);
}

// ─── Scheduled Handler ───────────────────────────────────────────────────────

const CRON_MAP: Record<string, (env: Env) => Promise<unknown>> = {
  "0 0,12 * * *": runCronA,
  "0 4,16 * * *": runCronB,
  "0 8,20 * * *": runCronC,
};

// ─── Worker Export ───────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(
    event: { cron: string },
    env: Env,
    _ctx: unknown
  ): Promise<void> {
    const handler = CRON_MAP[event.cron];
    if (!handler) {
      console.error(`[scheduled] Unknown cron expression: ${event.cron}`);
      return;
    }
    const summary = await handler(env);
    console.log(`[scheduled] Cron ${event.cron} complete:`, JSON.stringify(summary));
  },
};
