import type { Env } from "./types.js";
import { getActiveTickers, getChangelog } from "./constituents.js";
import {
  getScreenResult,
  getCronSummary,
  getConstituentsUpdated,
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

// ─── HTTP Router ─────────────────────────────────────────────────────────────

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // GET /health
  if (method === "GET" && pathname === "/health") {
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
    return json({
      tickers,
      count: tickers.length,
      last_updated: last_updated ?? "never",
      source: "live",
    });
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

    const found = result.results.find(
      (r) => r.ticker.toUpperCase() === ticker
    );

    if (!found) {
      return err(
        `${ticker} not found. Either not in the S&P 100 or data is still pending.`,
        "TICKER_NOT_FOUND",
        404
      );
    }

    return json(found);
  }

  // GET /status
  if (method === "GET" && pathname === "/status") {
    const [a, b, c] = await Promise.all([
      getCronSummary(env.MOMENTUM_CACHE, "A"),
      getCronSummary(env.MOMENTUM_CACHE, "B"),
      getCronSummary(env.MOMENTUM_CACHE, "C"),
    ]);

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
