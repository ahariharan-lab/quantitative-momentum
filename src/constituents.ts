import type { ConstituentRefreshResult, ChangelogEntry } from "./types.js";
import { SP100_TICKERS_FALLBACK, normalizeFromApi } from "./tickers.js";
import {
  getStoredConstituents,
  setStoredConstituents,
  setConstituentsUpdated,
  appendChangelog,
} from "./cache.js";

export async function fetchLiveConstituents(apiKey: string): Promise<string[]> {
  const url = `https://api.twelvedata.com/constituents?index=OEX&apikey=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Twelve Data HTTP ${response.status} fetching constituents`);
  }

  const json = (await response.json()) as {
    code?: number;
    message?: string;
    constituents?: { symbol: string }[];
  };

  if (json.code !== undefined || !json.constituents) {
    throw new Error(
      `Twelve Data API error for constituents: ${json.message ?? "unknown error"}`
    );
  }

  return json.constituents.map((c) => normalizeFromApi(c.symbol));
}

export async function getActiveTickers(kv: KVNamespace): Promise<string[]> {
  const stored = await getStoredConstituents(kv);
  return stored ?? SP100_TICKERS_FALLBACK;
}

export async function refreshConstituents(
  kv: KVNamespace,
  apiKey: string
): Promise<ConstituentRefreshResult> {
  const timestamp = new Date().toISOString();
  const previous = await getActiveTickers(kv);

  let fresh: string[];
  try {
    fresh = await fetchLiveConstituents(apiKey);
  } catch (err) {
    console.error("[constituents] fetch failed, using existing list:", err);
    return {
      tickers: previous,
      added: [],
      removed: [],
      unchanged: previous.length,
      source: "fallback",
      timestamp,
    };
  }

  const added = fresh.filter((t) => !previous.includes(t));
  const removed = previous.filter((t) => !fresh.includes(t));

  if (added.length > 0 || removed.length > 0) {
    await setStoredConstituents(kv, fresh);

    const entry: ChangelogEntry = { timestamp, added, removed };
    await appendChangelog(kv, entry);

    console.log(
      `[constituents] changes detected — added: ${added.join(",") || "none"}, removed: ${removed.join(",") || "none"}`
    );
  }

  await setConstituentsUpdated(kv);

  return {
    tickers: fresh,
    added,
    removed,
    unchanged: fresh.length - added.length,
    source: "api",
    timestamp,
  };
}
