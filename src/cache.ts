import type { MomentumResult, ScreenResult, CronSummary, ChangelogEntry } from "./types.js";

export const KV_KEYS = {
  CONSTITUENTS_CURRENT:   "constituents:sp100:current",
  CONSTITUENTS_UPDATED:   "constituents:sp100:last_updated",
  CONSTITUENTS_CHANGELOG: "constituents:sp100:changelog",
  MOMENTUM_PARTIAL_A:     "momentum:partial:0",
  MOMENTUM_PARTIAL_B:     "momentum:partial:1",
  MOMENTUM_PARTIAL_C:     "momentum:partial:2",
  SCREEN_LATEST:          "screen:sp100:latest",
  CRON_SUMMARY_A:         "cron:summary:A",
  CRON_SUMMARY_B:         "cron:summary:B",
  CRON_SUMMARY_C:         "cron:summary:C",
} as const;

type KVKey = typeof KV_KEYS[keyof typeof KV_KEYS];

async function kvGet<T>(kv: KVNamespace, key: KVKey): Promise<T | null> {
  const raw = await kv.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function kvPut(
  kv: KVNamespace,
  key: KVKey,
  value: unknown,
  ttl?: number
): Promise<void> {
  const options = ttl ? { expirationTtl: ttl } : undefined;
  await kv.put(key, JSON.stringify(value), options);
}

// ─── Partials ───────────────────────────────────────────────────────────────

export async function getPartial(
  kv: KVNamespace,
  key: KVKey
): Promise<MomentumResult[] | null> {
  return kvGet<MomentumResult[]>(kv, key);
}

export async function setPartial(
  kv: KVNamespace,
  key: KVKey,
  results: MomentumResult[]
): Promise<void> {
  await kvPut(kv, key, results);
}

// ─── Screen Result ───────────────────────────────────────────────────────────

export async function getScreenResult(kv: KVNamespace): Promise<ScreenResult | null> {
  return kvGet<ScreenResult>(kv, KV_KEYS.SCREEN_LATEST);
}

export async function setScreenResult(
  kv: KVNamespace,
  result: ScreenResult
): Promise<void> {
  await kvPut(kv, KV_KEYS.SCREEN_LATEST, result);
}

// ─── Cron Summaries ──────────────────────────────────────────────────────────

const CRON_SUMMARY_KEYS = {
  A: KV_KEYS.CRON_SUMMARY_A,
  B: KV_KEYS.CRON_SUMMARY_B,
  C: KV_KEYS.CRON_SUMMARY_C,
} as const;

const CRON_SUMMARY_TTL = 48 * 60 * 60; // 48 hours

export async function setCronSummary(
  kv: KVNamespace,
  id: "A" | "B" | "C",
  summary: CronSummary
): Promise<void> {
  await kvPut(kv, CRON_SUMMARY_KEYS[id], summary, CRON_SUMMARY_TTL);
}

export async function getCronSummary(
  kv: KVNamespace,
  id: "A" | "B" | "C"
): Promise<CronSummary | null> {
  return kvGet<CronSummary>(kv, CRON_SUMMARY_KEYS[id]);
}

// ─── Constituents ────────────────────────────────────────────────────────────

export async function getStoredConstituents(kv: KVNamespace): Promise<string[] | null> {
  return kvGet<string[]>(kv, KV_KEYS.CONSTITUENTS_CURRENT);
}

export async function setStoredConstituents(
  kv: KVNamespace,
  tickers: string[]
): Promise<void> {
  await kvPut(kv, KV_KEYS.CONSTITUENTS_CURRENT, tickers);
}

export async function getConstituentsUpdated(kv: KVNamespace): Promise<string | null> {
  return kv.get(KV_KEYS.CONSTITUENTS_UPDATED);
}

export async function setConstituentsUpdated(kv: KVNamespace): Promise<void> {
  await kv.put(KV_KEYS.CONSTITUENTS_UPDATED, new Date().toISOString());
}

export async function getChangelog(kv: KVNamespace): Promise<ChangelogEntry[]> {
  return (await kvGet<ChangelogEntry[]>(kv, KV_KEYS.CONSTITUENTS_CHANGELOG)) ?? [];
}

export async function appendChangelog(
  kv: KVNamespace,
  entry: ChangelogEntry
): Promise<void> {
  const existing = await getChangelog(kv);
  existing.push(entry);
  const trimmed = existing.slice(-50); // keep last 50 entries
  await kvPut(kv, KV_KEYS.CONSTITUENTS_CHANGELOG, trimmed);
}
