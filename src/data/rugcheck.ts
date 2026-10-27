// rugcheck.xyz report: LP lock percentage, creator address, holder count.
// Mint/freeze authority are NOT taken from here; those are read on-chain in solana.ts.
import { fetchJson } from "../util.js";

export interface RugReport {
  lpLockedPct: number | null;
  creator: string | null;
  totalHolders: number | null;
}

const cache = new Map<string, { at: number; r: RugReport }>();

export async function rugReport(mint: string): Promise<RugReport> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < 60_000) return hit.r;
  const j = await fetchJson<any>(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {}, 15_000).catch(() => null);
  // Use the most liquid market's LP lock; a token is only as safe as the pool we'd trade in.
  const markets: any[] = Array.isArray(j?.markets) ? j.markets : [];
  const main = markets.sort((a, b) => (b?.lp?.quoteUSD ?? 0) - (a?.lp?.quoteUSD ?? 0))[0];
  const lp = Number(main?.lp?.lpLockedPct);
  const r: RugReport = {
    lpLockedPct: Number.isFinite(lp) ? lp : null,
    creator: typeof j?.creator === "string" ? j.creator : null,
    totalHolders: Number.isFinite(Number(j?.totalHolders)) ? Number(j.totalHolders) : null,
  };
  cache.set(mint, { at: Date.now(), r });
  return r;
}
