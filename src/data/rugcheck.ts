// rugcheck.xyz report: LP lock percentage, creator address, holder count, top holders.
// Mint/freeze authority are NOT taken from here; those are read on-chain in solana.ts.
//
// rugcheck allows ~15 requests/minute (x-rate-limit-limit: 15). Calls are queued at that
// pace, a 429 waits and retries once, and good reports are cached for 10 minutes, so a busy
// scan doesn't turn into "LP lock unknown" for tokens that are fine.
import { sleep } from "../util.js";

export interface RugReport {
  lpLockedPct: number | null;
  creator: string | null;
  totalHolders: number | null;
  /** Wallet owners of the largest token accounts (unverified; re-checked on-chain before use). */
  topHolderOwners: string[];
}

const OK_TTL_MS = 10 * 60_000;
const FAIL_TTL_MS = 2 * 60_000;
const MIN_GAP_MS = 4_200; // ~14/min
const cache = new Map<string, { at: number; ttl: number; r: RugReport }>();
let nextSlot = 0;

/** Last time rugcheck answered with a usable report / with an error (for the dashboard). */
export const rugcheckHealth = { lastOk: 0, lastFail: 0 };

async function slot() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await sleep(wait);
}

async function fetchReport(mint: string): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await slot();
    let res: Response;
    try {
      res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { signal: AbortSignal.timeout(15_000) });
    } catch {
      continue;
    }
    if (res.status === 429) {
      await sleep(15_000);
      continue;
    }
    return res.ok ? res.json().catch(() => null) : null;
  }
  return null;
}

const inFlight = new Map<string, Promise<RugReport>>();

/** One request per mint at a time: concurrent callers (LP + holders) share it. */
export function rugReport(mint: string): Promise<RugReport> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.r);
  const running = inFlight.get(mint);
  if (running) return running;
  const p = loadReport(mint).finally(() => inFlight.delete(mint));
  inFlight.set(mint, p);
  return p;
}

async function loadReport(mint: string): Promise<RugReport> {
  const j = await fetchReport(mint);
  // Use the most liquid market's LP lock; a token is only as safe as the pool we'd trade in.
  const markets: any[] = Array.isArray(j?.markets) ? j.markets : [];
  const main = markets.sort((a, b) => (b?.lp?.quoteUSD ?? 0) - (a?.lp?.quoteUSD ?? 0))[0];
  const lp = Number(main?.lp?.lpLockedPct);
  const r: RugReport = {
    lpLockedPct: Number.isFinite(lp) ? lp : null,
    creator: typeof j?.creator === "string" ? j.creator : null,
    totalHolders: Number.isFinite(Number(j?.totalHolders)) ? Number(j.totalHolders) : null,
    topHolderOwners: (Array.isArray(j?.topHolders) ? j.topHolders : [])
      .map((h: any) => h?.owner)
      .filter((o: unknown): o is string => typeof o === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(o)),
  };
  const usable = r.lpLockedPct !== null;
  rugcheckHealth[usable ? "lastOk" : "lastFail"] = Date.now();
  cache.set(mint, { at: Date.now(), ttl: usable ? OK_TTL_MS : FAIL_TTL_MS, r });
  if (cache.size > 2_000) for (const [m, c] of cache) if (Date.now() - c.at > c.ttl) cache.delete(m);
  return r;
}
