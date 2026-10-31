// DexScreener: discovers newly profiled/boosted Solana tokens and reads pair volume.
import { fetchJson } from "../util.js";
import type { PairSnapshot } from "../types.js";

const BASE = "https://api.dexscreener.com";

/** Solana mints from DexScreener's latest profiles, latest + top boosts and community takeovers. */
export async function latestMints(): Promise<string[]> {
  const feeds = await Promise.allSettled([
    fetchJson<any[]>(`${BASE}/token-profiles/latest/v1`),
    fetchJson<any[]>(`${BASE}/token-boosts/latest/v1`),
    fetchJson<any[]>(`${BASE}/token-boosts/top/v1`),
    fetchJson<any[]>(`${BASE}/community-takeovers/latest/v1`),
  ]);
  const mints = new Set<string>();
  for (const f of feeds)
    if (f.status === "fulfilled" && Array.isArray(f.value))
      for (const t of f.value) if (t?.chainId === "solana" && typeof t.tokenAddress === "string") mints.add(t.tokenAddress);
  return [...mints];
}

/** Best (most liquid) pair per mint. Accepts any number of mints; batches by 30. */
export async function pairsFor(mints: string[]): Promise<PairSnapshot[]> {
  const out: PairSnapshot[] = [];
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const pairs = await fetchJson<any[]>(`${BASE}/tokens/v1/solana/${batch.join(",")}`).catch(() => []);
    const best = new Map<string, any>();
    for (const p of pairs ?? []) {
      const mint = p?.baseToken?.address;
      if (!batch.includes(mint)) continue;
      if ((p.liquidity?.usd ?? 0) > (best.get(mint)?.liquidity?.usd ?? -1)) best.set(mint, p);
    }
    for (const [mint, p] of best)
      out.push({
        mint,
        symbol: String(p.baseToken?.symbol ?? ""), // untrusted
        name: String(p.baseToken?.name ?? ""), // untrusted
        pairAddress: String(p.pairAddress),
        priceUsd: Number(p.priceUsd ?? 0),
        liquidityUsd: Number(p.liquidity?.usd ?? 0),
        volM5: Number(p.volume?.m5 ?? 0),
        volH1: Number(p.volume?.h1 ?? 0),
        volH6: Number(p.volume?.h6 ?? 0),
      });
  }
  return out;
}
