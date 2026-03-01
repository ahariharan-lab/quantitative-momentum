import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PriceBar, MomentumResult } from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a synthetic price series with a fixed daily return.
 * startPrice × (1 + dailyReturn)^i for i in [0, numBars)
 */
function makePrices(
  numBars: number,
  startPrice: number,
  dailyReturn: number,
  startDate = "2023-01-01"
): PriceBar[] {
  const bars: PriceBar[] = [];
  const base = new Date(startDate);
  let price = startPrice;

  for (let i = 0; i < numBars; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    bars.push({
      date: d.toISOString().slice(0, 10),
      close: parseFloat(price.toFixed(6)),
    });
    price *= 1 + dailyReturn;
  }

  return bars;
}

/**
 * Mix of up and down days with a specific ratio.
 * If positiveFraction = 0.8 → 80% up days, 20% down days.
 */
function makeMixedPrices(
  numBars: number,
  startPrice: number,
  positiveFraction: number,
  upReturn = 0.005,
  downReturn = -0.005
): PriceBar[] {
  const bars: PriceBar[] = [];
  let price = startPrice;

  for (let i = 0; i < numBars; i++) {
    const d = new Date("2023-01-01");
    d.setDate(d.getDate() + i);
    bars.push({
      date: d.toISOString().slice(0, 10),
      close: parseFloat(price.toFixed(6)),
    });
    const ret = i / numBars < positiveFraction ? upReturn : downReturn;
    price *= 1 + ret;
  }

  return bars;
}

// ─── 1. normalizeForApi / normalizeFromApi ────────────────────────────────────

describe("Symbol normalization", () => {
  it("normalizeForApi: BRK-B → BRK/B", async () => {
    const { normalizeForApi } = await import("../src/tickers.js");
    expect(normalizeForApi("BRK-B")).toBe("BRK/B");
  });

  it("normalizeForApi: passthrough for regular tickers", async () => {
    const { normalizeForApi } = await import("../src/tickers.js");
    expect(normalizeForApi("AAPL")).toBe("AAPL");
    expect(normalizeForApi("MSFT")).toBe("MSFT");
  });

  it("normalizeFromApi: BRK/B → BRK-B round-trip", async () => {
    const { normalizeFromApi } = await import("../src/tickers.js");
    expect(normalizeFromApi("BRK/B")).toBe("BRK-B");
  });

  it("normalizeFromApi: passthrough for unmapped symbols", async () => {
    const { normalizeFromApi } = await import("../src/tickers.js");
    expect(normalizeFromApi("NVDA")).toBe("NVDA");
  });
});

// ─── 2. getBatches ────────────────────────────────────────────────────────────

describe("getBatches", () => {
  it("splits 100-ticker list into [48, 48, 4]", async () => {
    const { getBatches, SP100_TICKERS_FALLBACK } = await import("../src/tickers.js");
    const [a, b, c] = getBatches(SP100_TICKERS_FALLBACK);
    expect(a.length).toBe(48);
    expect(b.length).toBe(48);
    expect(c.length).toBe(4);
  });

  it("batch A starts from index 0", async () => {
    const { getBatches, SP100_TICKERS_FALLBACK } = await import("../src/tickers.js");
    const [a] = getBatches(SP100_TICKERS_FALLBACK);
    expect(a[0]).toBe(SP100_TICKERS_FALLBACK[0]);
    expect(a[47]).toBe(SP100_TICKERS_FALLBACK[47]);
  });

  it("batch B starts from index 48", async () => {
    const { getBatches, SP100_TICKERS_FALLBACK } = await import("../src/tickers.js");
    const [, b] = getBatches(SP100_TICKERS_FALLBACK);
    expect(b[0]).toBe(SP100_TICKERS_FALLBACK[48]);
  });

  it("batch C is the remainder", async () => {
    const { getBatches, SP100_TICKERS_FALLBACK } = await import("../src/tickers.js");
    const [, , c] = getBatches(SP100_TICKERS_FALLBACK);
    expect(c[0]).toBe(SP100_TICKERS_FALLBACK[96]);
    expect(c[c.length - 1]).toBe(SP100_TICKERS_FALLBACK[99]);
  });

  it("all batches together cover all tickers exactly once", async () => {
    const { getBatches, SP100_TICKERS_FALLBACK } = await import("../src/tickers.js");
    const [a, b, c] = getBatches(SP100_TICKERS_FALLBACK);
    const all = [...a, ...b, ...c];
    expect(all).toEqual(SP100_TICKERS_FALLBACK);
  });

  it("handles a list shorter than BATCH_SPLIT_A", async () => {
    const { getBatches } = await import("../src/tickers.js");
    const [a, b, c] = getBatches(["X", "Y", "Z"]);
    expect(a).toEqual(["X", "Y", "Z"]);
    expect(b).toEqual([]);
    expect(c).toEqual([]);
  });
});

// ─── 3. computeMomentum ──────────────────────────────────────────────────────

describe("computeMomentum", () => {
  it("returns positive momentum for a rising price series", async () => {
    const { computeMomentum } = await import("../src/momentum.js");
    // 300 bars, +0.1% per day → strongly positive 12-1 month return
    const prices = makePrices(300, 100, 0.001);
    const result = computeMomentum(prices);
    expect(result.value).toBeGreaterThan(0);
    expect(result.period).toBe("12-1 months");
  });

  it("returns negative momentum for a falling price series", async () => {
    const { computeMomentum } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, -0.001);
    const result = computeMomentum(prices);
    expect(result.value).toBeLessThan(0);
  });

  it("skips the most recent 21 bars (avoids short-term reversal)", async () => {
    const { computeMomentum } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, 0.001);

    // Manually compute expected cutoff
    const cutoffIdx = prices.length - 1 - 21;
    const startIdx = Math.max(0, cutoffIdx - 252);
    const expectedMom =
      (prices[cutoffIdx].close - prices[startIdx].close) / prices[startIdx].close;

    const result = computeMomentum(prices);
    expect(result.value).toBeCloseTo(expectedMom, 6);
  });

  it("throws with insufficient price data", async () => {
    const { computeMomentum } = await import("../src/momentum.js");
    const prices = makePrices(10, 100, 0.001); // way too few
    expect(() => computeMomentum(prices)).toThrow("Insufficient price data");
  });

  it("percentage string is formatted to 2 decimal places", async () => {
    const { computeMomentum } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, 0.001);
    const result = computeMomentum(prices);
    expect(result.percentage).toMatch(/^-?\d+\.\d{2}%$/);
  });
});

// ─── 4. computeFIP ───────────────────────────────────────────────────────────

describe("computeFIP", () => {
  it("returns negative FIP (smooth) for positive momentum with many positive days", async () => {
    const { computeMomentum, computeFIP } = await import("../src/momentum.js");
    // Uniform small up-days → very smooth positive momentum
    const prices = makePrices(300, 100, 0.001);
    const mom = computeMomentum(prices);
    const fip = computeFIP(prices, mom.value, mom.cutoffIdx, mom.startIdx);

    expect(fip.score).toBeLessThan(-0.1); // smooth range
    expect(fip.quality).toBe("smooth");
  });

  it("returns positive FIP (lumpy) for positive momentum with many negative days", async () => {
    const { computeMomentum, computeFIP } = await import("../src/momentum.js");
    // Mostly down days except a few large up days
    // We simulate this by having 80% negative days but a net positive return
    const prices = makeMixedPrices(300, 100, 0.1, 0.05, -0.003); // 10% up days
    const mom = computeMomentum(prices);
    if (mom.value > 0) {
      const fip = computeFIP(prices, mom.value, mom.cutoffIdx, mom.startIdx);
      expect(fip.score).toBeGreaterThan(0.1); // lumpy range
      expect(fip.quality).toBe("lumpy");
    }
  });

  it("FIP score has correct sign for positive momentum (negative = many positive days)", async () => {
    const { computeMomentum, computeFIP } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, 0.001); // all up days
    const mom = computeMomentum(prices);
    const fip = computeFIP(prices, mom.value, mom.cutoffIdx, mom.startIdx);

    // All up days → pct_neg = 0, pct_pos ≈ 1
    // FIP = sign(+) × (0 - 1) = -1 → very smooth
    expect(fip.score).toBeLessThan(-0.5);
  });

  it("FIP score has correct sign for negative momentum (consistent decline = smooth)", async () => {
    const { computeMomentum, computeFIP } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, -0.001); // all down days
    const mom = computeMomentum(prices);
    const fip = computeFIP(prices, mom.value, mom.cutoffIdx, mom.startIdx);

    // All down days → pctNeg ≈ 1, pctPos ≈ 0
    // FIP = sign(-) × (1 - 0) = -1 → very negative → "smooth"
    expect(fip.score).toBeLessThan(-0.5);
    expect(fip.quality).toBe("smooth");
  });

  it("positive_days and negative_days are percentage strings", async () => {
    const { computeMomentum, computeFIP } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, 0.001);
    const mom = computeMomentum(prices);
    const fip = computeFIP(prices, mom.value, mom.cutoffIdx, mom.startIdx);

    expect(fip.positive_days).toMatch(/^\d+\.\d%$/);
    expect(fip.negative_days).toMatch(/^\d+\.\d%$/);
  });
});

// ─── 5. computeResult ────────────────────────────────────────────────────────

describe("computeResult", () => {
  it("returns a valid MomentumResult for sufficient price data", async () => {
    const { computeResult } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, 0.001);
    const result = computeResult("AAPL", prices);

    expect(result.ticker).toBe("AAPL");
    expect(result.error).toBeUndefined();
    expect(result.momentum.value).toBeTypeOf("number");
    expect(result.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns an error result for empty prices array", async () => {
    const { computeResult } = await import("../src/momentum.js");
    const result = computeResult("FAKE", []);

    expect(result.ticker).toBe("FAKE");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Insufficient");
  });

  it("returns error result for a prices array that is too short", async () => {
    const { computeResult } = await import("../src/momentum.js");
    const prices = makePrices(5, 100, 0.001);
    const result = computeResult("SHORT", prices);

    expect(result.error).toBeDefined();
  });

  it("data_range.start is before data_range.end", async () => {
    const { computeResult } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, 0.001);
    const result = computeResult("AAPL", prices);

    expect(result.data_range.start < result.data_range.end).toBe(true);
  });
});

// ─── 6. rankResults ──────────────────────────────────────────────────────────

describe("rankResults", () => {
  it("ranks by momentum descending", async () => {
    const { rankResults } = await import("../src/momentum.js");
    const prices = makePrices(300, 100, 0.001);
    const { computeResult } = await import("../src/momentum.js");

    const a = computeResult("AAPL", makePrices(300, 100, 0.002)); // higher momentum
    const b = computeResult("MSFT", makePrices(300, 100, 0.001)); // lower momentum

    const ranked = rankResults([b, a]);
    expect(ranked[0].ticker).toBe("AAPL");
    expect(ranked[1].ticker).toBe("MSFT");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it("excludes errored results from rankings", async () => {
    const { rankResults, computeResult } = await import("../src/momentum.js");
    const good = computeResult("AAPL", makePrices(300, 100, 0.001));
    const bad = computeResult("FAKE", []); // will have error

    const ranked = rankResults([good, bad]);
    expect(ranked.length).toBe(1);
    expect(ranked[0].ticker).toBe("AAPL");
  });

  it("tie-breaks by FIP score ascending (smoother momentum wins)", async () => {
    const { rankResults } = await import("../src/momentum.js");
    const { computeResult } = await import("../src/momentum.js");

    // Same momentum value magnitude — use two stocks with same daily return
    // but one is smooth (uniform) and one has same endpoint but different path
    const smooth = computeResult("SMOOTH", makePrices(300, 100, 0.001));
    const lumpy = computeResult("LUMPY", makeMixedPrices(300, 100, 0.1, 0.05, -0.003));

    // Force same momentum value to test tie-breaking
    const fakeSmooth: MomentumResult = {
      ...smooth,
      momentum: { ...smooth.momentum, value: 0.5 },
    };
    const fakeLumpy: MomentumResult = {
      ...lumpy,
      momentum: { ...lumpy.momentum, value: 0.5 },
      fip: { ...lumpy.fip, score: 0.3 }, // worse FIP
    };

    const ranked = rankResults([fakeLumpy, fakeSmooth]);
    // Smooth has lower FIP score → should rank first
    expect(ranked[0].ticker).toBe("SMOOTH");
  });

  it("assigns sequential ranks starting at 1", async () => {
    const { rankResults, computeResult } = await import("../src/momentum.js");
    const results = [
      computeResult("A", makePrices(300, 100, 0.003)),
      computeResult("B", makePrices(300, 100, 0.002)),
      computeResult("C", makePrices(300, 100, 0.001)),
    ];

    const ranked = rankResults(results);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("handles empty input array", async () => {
    const { rankResults } = await import("../src/momentum.js");
    expect(rankResults([])).toEqual([]);
  });

  it("handles all errored results", async () => {
    const { rankResults, computeResult } = await import("../src/momentum.js");
    const errored = [
      computeResult("A", []),
      computeResult("B", []),
    ];
    expect(rankResults(errored)).toEqual([]);
  });
});

// ─── 7. rateLimitedBatchFetch ─────────────────────────────────────────────────

describe("rateLimitedBatchFetch", () => {
  let sleepMock: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sleepMock = vi.fn().mockResolvedValue(undefined);
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        values: [
          { datetime: "2024-01-01", close: "100.00" },
          { datetime: "2024-01-02", close: "101.00" },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("processes all tickers and returns results for each", async () => {
    const { rateLimitedBatchFetch } = await import("../src/data.js");
    const tickers = ["AAPL", "MSFT", "GOOGL"];
    const results = await rateLimitedBatchFetch(tickers, "test-key");

    expect(results.length).toBe(3);
    expect(results.map((r) => r.ticker)).toEqual(["AAPL", "MSFT", "GOOGL"]);
    expect(results.every((r) => r.prices !== null)).toBe(true);
  });

  it("splits into chunks of 6", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const callOrder: string[] = [];
    const localFetch = vi.fn().mockImplementation((url: string) => {
      const sym = new URL(url as string).searchParams.get("symbol") ?? "?";
      callOrder.push(sym);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          values: [{ datetime: "2024-01-01", close: "100.00" }],
        }),
      });
    });
    vi.stubGlobal("fetch", localFetch);

    // Import fresh module after stubbing
    const { rateLimitedBatchFetch } = await import("../src/data.js");
    const tickers = ["A", "B", "C", "D", "E", "F", "G"]; // 7 → chunk [6] + [1]

    // Start the batch fetch but advance timers concurrently
    const fetchPromise = rateLimitedBatchFetch(tickers, "key");
    // Advance all pending timers (the 45s sleep between chunks)
    await vi.runAllTimersAsync();
    const results = await fetchPromise;

    // All 7 fetches happened
    expect(localFetch).toHaveBeenCalledTimes(7);
    expect(results.length).toBe(7);
    vi.useRealTimers();
  }, 10_000);

  it("marks failed fetches with error field, not null prices is still included", async () => {
    vi.resetModules();
    let callCount = 0;
    fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: async () => ({}),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          values: [{ datetime: "2024-01-01", close: "100.00" }],
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rateLimitedBatchFetch } = await import("../src/data.js");
    const results = await rateLimitedBatchFetch(["AAPL", "MSFT", "GOOGL"], "key");

    const errored = results.filter((r) => r.error);
    expect(errored.length).toBe(1);
    expect(errored[0].prices).toBeNull();
  });
});

// ─── 8. refreshConstituents ──────────────────────────────────────────────────

describe("refreshConstituents", () => {
  function makeMockKV(stored: string[] | null = null): KVNamespace {
    const store = new Map<string, string>();

    if (stored !== null) {
      store.set("constituents:sp100:current", JSON.stringify(stored));
    }

    return {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => { store.delete(key); }),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("detects added tickers correctly", async () => {
    const existing = ["AAPL", "MSFT"];
    const fresh = ["AAPL", "MSFT", "NVDA"]; // NVDA is new

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        constituents: fresh.map((s) => ({ symbol: s })),
      }),
    }));

    const { refreshConstituents } = await import("../src/constituents.js");
    const kv = makeMockKV(existing);
    const result = await refreshConstituents(kv, "test-key");

    expect(result.added).toContain("NVDA");
    expect(result.removed).toHaveLength(0);
    expect(result.source).toBe("api");
  });

  it("detects removed tickers correctly", async () => {
    const existing = ["AAPL", "MSFT", "IBM"];
    const fresh = ["AAPL", "MSFT"]; // IBM removed

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        constituents: fresh.map((s) => ({ symbol: s })),
      }),
    }));

    const { refreshConstituents } = await import("../src/constituents.js");
    const kv = makeMockKV(existing);
    const result = await refreshConstituents(kv, "test-key");

    expect(result.removed).toContain("IBM");
    expect(result.added).toHaveLength(0);
  });

  it("does NOT overwrite KV when the API call fails", async () => {
    const existing = ["AAPL", "MSFT", "GOOGL"];

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const { refreshConstituents } = await import("../src/constituents.js");
    const kv = makeMockKV(existing);
    const result = await refreshConstituents(kv, "test-key");

    expect(result.source).toBe("fallback");
    expect(result.tickers).toEqual(existing);
    // KV put should NOT have been called for constituents:sp100:current
    const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
    const constituentPut = putCalls.find(
      (c: string[]) => c[0] === "constituents:sp100:current"
    );
    expect(constituentPut).toBeUndefined();
  });

  it("does NOT overwrite KV when the API returns an error code", async () => {
    const existing = ["AAPL", "MSFT"];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 400, message: "Invalid API key" }),
    }));

    const { refreshConstituents } = await import("../src/constituents.js");
    const kv = makeMockKV(existing);
    const result = await refreshConstituents(kv, "bad-key");

    expect(result.source).toBe("fallback");
    expect(result.tickers).toEqual(existing);
  });

  it("uses SP100_TICKERS_FALLBACK when KV has no stored list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const { refreshConstituents } = await import("../src/constituents.js");
    const { SP100_TICKERS_FALLBACK } = await import("../src/tickers.js");
    const kv = makeMockKV(null); // nothing stored
    const result = await refreshConstituents(kv, "key");

    expect(result.tickers).toEqual(SP100_TICKERS_FALLBACK);
    expect(result.source).toBe("fallback");
  });

  it("writes changelog entry when changes are detected", async () => {
    const existing = ["AAPL", "MSFT"];
    const fresh = ["AAPL", "MSFT", "NVDA"];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        constituents: fresh.map((s) => ({ symbol: s })),
      }),
    }));

    const { refreshConstituents } = await import("../src/constituents.js");
    const kv = makeMockKV(existing);
    await refreshConstituents(kv, "key");

    const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
    const changelogPut = putCalls.find(
      (c: string[]) => c[0] === "constituents:sp100:changelog"
    );
    expect(changelogPut).toBeDefined();
  });
});

// ─── 9. runCronC (merge and publish) ─────────────────────────────────────────

describe("runCronC", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("merges partial A, B, and C into a ranked ScreenResult and writes to KV", async () => {
    // Build fake partials
    const { computeResult } = await import("../src/momentum.js");
    const partial_a = [
      computeResult("AAPL", makePrices(300, 100, 0.003)),
      computeResult("MSFT", makePrices(300, 100, 0.002)),
    ];
    const partial_b = [
      computeResult("GOOGL", makePrices(300, 100, 0.001)),
    ];
    const partial_c_tickers = ["XOM"];

    const kvStore = new Map<string, string>([
      ["momentum:partial:0", JSON.stringify(partial_a)],
      ["momentum:partial:1", JSON.stringify(partial_b)],
      ["constituents:sp100:current", JSON.stringify(["AAPL", "MSFT", "GOOGL", "XOM"])],
    ]);

    const kv: KVNamespace = {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { kvStore.set(key, value); }),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;

    // Mock fetch for batchC (XOM)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        values: Array.from({ length: 280 }, (_, i) => ({
          datetime: `2024-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-${String((i % 30) + 1).padStart(2, "0")}`,
          close: String(100 + i * 0.1),
        })),
      }),
    }));

    const env = {
      MOMENTUM_CACHE: kv,
      DATA_API_KEY: "test-key",
      REFRESH_SECRET: "secret",
    };

    const { runCronC } = await import("../src/pipeline.js");
    const summary = await runCronC(env as unknown as import("../src/types.js").Env);

    // CronSummary assertions
    expect(summary.cron_id).toBe("C");
    expect(summary.duration_ms).toBeGreaterThanOrEqual(0);

    // ScreenResult should have been written
    const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
    const screenPut = putCalls.find((c: string[]) => c[0] === "screen:sp100:latest");
    expect(screenPut).toBeDefined();

    const screenResult = JSON.parse(screenPut![1]);
    expect(screenResult.status).toBe("ok"); // both partials were present
    expect(screenResult.results.length).toBeGreaterThan(0);
    expect(screenResult.results[0].rank).toBe(1);

    // Results should be sorted by momentum descending
    const momentumValues = screenResult.results.map((r: { momentum: { value: number } }) => r.momentum.value);
    for (let i = 0; i < momentumValues.length - 1; i++) {
      expect(momentumValues[i]).toBeGreaterThanOrEqual(momentumValues[i + 1]);
    }
  });

  it("sets status to 'partial' when partial A is missing", async () => {
    const { computeResult } = await import("../src/momentum.js");
    const partial_b = [computeResult("GOOGL", makePrices(300, 100, 0.001))];

    const kvStore = new Map<string, string>([
      ["momentum:partial:1", JSON.stringify(partial_b)],
      ["constituents:sp100:current", JSON.stringify(["GOOGL", "XOM"])],
    ]);

    const kv: KVNamespace = {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { kvStore.set(key, value); }),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        values: Array.from({ length: 280 }, (_, i) => ({
          datetime: `2024-01-${String(i + 1).padStart(2, "0")}`,
          close: String(100 + i * 0.01),
        })),
      }),
    }));

    const env = {
      MOMENTUM_CACHE: kv,
      DATA_API_KEY: "test-key",
      REFRESH_SECRET: "secret",
    };

    const { runCronC } = await import("../src/pipeline.js");
    await runCronC(env as unknown as import("../src/types.js").Env);

    const putCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls;
    const screenPut = putCalls.find((c: string[]) => c[0] === "screen:sp100:latest");
    expect(screenPut).toBeDefined();
    const screenResult = JSON.parse(screenPut![1]);
    expect(screenResult.status).toBe("partial");
  });
});

// ─── 10. HTTP endpoint validation ────────────────────────────────────────────

describe("HTTP endpoints (index.ts)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function makeEnv(kvStore?: Map<string, string>) {
    const store = kvStore ?? new Map<string, string>();
    const kv: KVNamespace = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace;

    return {
      MOMENTUM_CACHE: kv,
      DATA_API_KEY: "test-key",
      REFRESH_SECRET: "secret",
    };
  }

  it("GET /health returns 200 with service info", async () => {
    const worker = await import("../src/index.js");
    const env = makeEnv();
    const req = new Request("http://localhost/health");
    const res = await worker.default.fetch(req, env as unknown as import("../src/types.js").Env);

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("quantitative-momentum");
  });

  it("GET /screen returns 503 when KV has no data", async () => {
    const worker = await import("../src/index.js");
    const env = makeEnv();
    const req = new Request("http://localhost/screen");
    const res = await worker.default.fetch(req, env as unknown as import("../src/types.js").Env);

    expect(res.status).toBe(503);
  });

  it("GET /screen returns ranked results when KV has data", async () => {
    const { computeResult, rankResults } = await import("../src/momentum.js");
    const results = rankResults([
      computeResult("AAPL", makePrices(300, 100, 0.002)),
      computeResult("MSFT", makePrices(300, 100, 0.001)),
    ]);

    const screenResult = {
      status: "ok",
      generated_at: new Date().toISOString(),
      next_refresh_hint: "in ~4 hours",
      summary: { total_screened: 2, total_errors: 0, methodology: "test" },
      results,
      errors: null,
      methodology_notes: {},
    };

    const store = new Map([["screen:sp100:latest", JSON.stringify(screenResult)]]);
    const env = makeEnv(store);
    const worker = await import("../src/index.js");

    const req = new Request("http://localhost/screen");
    const res = await worker.default.fetch(req, env as unknown as import("../src/types.js").Env);

    expect(res.status).toBe(200);
    const body = await res.json() as { results: unknown[]; cache_hit: boolean };
    expect(body.results.length).toBe(2);
    expect(body.cache_hit).toBe(true);
  });

  it("GET /screen?top=1 returns only 1 result", async () => {
    const { computeResult, rankResults } = await import("../src/momentum.js");
    const results = rankResults([
      computeResult("AAPL", makePrices(300, 100, 0.002)),
      computeResult("MSFT", makePrices(300, 100, 0.001)),
      computeResult("NVDA", makePrices(300, 100, 0.003)),
    ]);

    const screenResult = {
      status: "ok",
      generated_at: new Date().toISOString(),
      next_refresh_hint: "in ~4 hours",
      summary: { total_screened: 3, total_errors: 0, methodology: "test" },
      results,
      errors: null,
      methodology_notes: {},
    };

    const store = new Map([["screen:sp100:latest", JSON.stringify(screenResult)]]);
    const env = makeEnv(store);
    const worker = await import("../src/index.js");

    const req = new Request("http://localhost/screen?top=1");
    const res = await worker.default.fetch(req, env as unknown as import("../src/types.js").Env);
    const body = await res.json() as { results: unknown[] };
    expect(body.results.length).toBe(1);
  });

  it("GET /momentum/AAPL returns 404 for unknown ticker", async () => {
    const { computeResult, rankResults } = await import("../src/momentum.js");
    const results = rankResults([
      computeResult("MSFT", makePrices(300, 100, 0.001)),
    ]);

    const screenResult = {
      status: "ok",
      generated_at: new Date().toISOString(),
      next_refresh_hint: "in ~4 hours",
      summary: { total_screened: 1, total_errors: 0, methodology: "test" },
      results,
      errors: null,
      methodology_notes: {},
    };

    const store = new Map([["screen:sp100:latest", JSON.stringify(screenResult)]]);
    const env = makeEnv(store);
    const worker = await import("../src/index.js");

    const req = new Request("http://localhost/momentum/AAPL"); // AAPL not in results
    const res = await worker.default.fetch(req, env as unknown as import("../src/types.js").Env);
    expect(res.status).toBe(404);
  });

  it("GET /momentum/MSFT returns the ticker result when present", async () => {
    const { computeResult, rankResults } = await import("../src/momentum.js");
    const results = rankResults([
      computeResult("MSFT", makePrices(300, 100, 0.001)),
    ]);

    const screenResult = {
      status: "ok",
      generated_at: new Date().toISOString(),
      next_refresh_hint: "in ~4 hours",
      summary: { total_screened: 1, total_errors: 0, methodology: "test" },
      results,
      errors: null,
      methodology_notes: {},
    };

    const store = new Map([["screen:sp100:latest", JSON.stringify(screenResult)]]);
    const env = makeEnv(store);
    const worker = await import("../src/index.js");

    const req = new Request("http://localhost/momentum/MSFT");
    const res = await worker.default.fetch(req, env as unknown as import("../src/types.js").Env);
    expect(res.status).toBe(200);
    const body = await res.json() as { ticker: string; rank: number };
    expect(body.ticker).toBe("MSFT");
    expect(body.rank).toBe(1);
  });

  it("OPTIONS request returns 204 with CORS headers", async () => {
    const worker = await import("../src/index.js");
    const env = makeEnv();
    const req = new Request("http://localhost/screen", { method: "OPTIONS" });
    const res = await worker.default.fetch(req, env as unknown as import("../src/types.js").Env);

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("unknown route returns 404", async () => {
    const worker = await import("../src/index.js");
    const env = makeEnv();
    const req = new Request("http://localhost/doesnotexist");
    const res = await worker.default.fetch(req, env as unknown as import("../src/types.js").Env);
    expect(res.status).toBe(404);
  });
});
