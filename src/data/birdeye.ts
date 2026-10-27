// Birdeye (optional, needs BIRDEYE_API_KEY): new listings and holder counts.
import { CONFIG } from "../config.js";
import { fetchJson } from "../util.js";

const BASE = "https://public-api.birdeye.so";
const headers = () => ({ "X-API-KEY": CONFIG.birdeyeApiKey, "x-chain": "solana", accept: "application/json" });

export const birdeyeEnabled = () => Boolean(CONFIG.birdeyeApiKey);

export async function newListings(): Promise<string[]> {
  if (!birdeyeEnabled()) return [];
  const r = await fetchJson<any>(`${BASE}/defi/v2/tokens/new_listing?limit=20&meme_platform_enabled=true`, { headers: headers() }).catch(() => null);
  return (r?.data?.items ?? []).map((t: any) => t?.address).filter((a: unknown) => typeof a === "string");
}

export async function holders(mint: string): Promise<number | null> {
  if (!birdeyeEnabled()) return null;
  const r = await fetchJson<any>(`${BASE}/defi/token_overview?address=${mint}`, { headers: headers() }).catch(() => null);
  const h = Number(r?.data?.holder);
  return Number.isFinite(h) && h > 0 ? h : null;
}
