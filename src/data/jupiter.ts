// Jupiter: quotes, swap-transaction building, and simulating someone else's sell.
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { CONFIG } from "../config.js";
import { fetchJson } from "../util.js";
import { conn } from "./solana.js";
import type { Quote } from "../types.js";

const headers = (): Record<string, string> => ({
  "content-type": "application/json",
  ...(CONFIG.jupiterApiKey ? { "x-api-key": CONFIG.jupiterApiKey } : {}),
});

export async function quote(inputMint: string, outputMint: string, amount: bigint): Promise<Quote | null> {
  if (amount <= 0n) return null;
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: String(CONFIG.executor.slippageBps),
    restrictIntermediateTokens: "true",
  });
  try {
    const r = await fetchJson<any>(`${CONFIG.jupiterBase}/quote?${q}`, { headers: headers() });
    if (!r?.outAmount) return null;
    // Our own request params must come back unchanged; anything else is not trusted.
    if (r.inputMint !== inputMint || r.outputMint !== outputMint || r.platformFee) return null;
    return { inAmount: BigInt(r.inAmount), outAmount: BigInt(r.outAmount), priceImpactPct: Number(r.priceImpactPct) * 100, raw: r };
  } catch {
    return null;
  }
}

/** Build (not sign, not send) a swap transaction for `user`. No fee account, no custom destination. */
export async function buildSwap(q: Quote, user: PublicKey) {
  const r = await fetchJson<any>(`${CONFIG.jupiterBase}/swap`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      quoteResponse: q.raw,
      userPublicKey: user.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "high" } },
    }),
  });
  const tx = VersionedTransaction.deserialize(Buffer.from(r.swapTransaction, "base64"));
  return { tx, lastValidBlockHeight: Number(r.lastValidBlockHeight) };
}

/**
 * Honeypot test: ask Jupiter to build a SELL transaction for a real holder's wallet and
 * simulate it (signatures are not verified in simulation, nothing is ever sent).
 * If an existing holder can't sell, we wouldn't be able to either.
 */
export async function simulateHolderSell(mint: string, holder: string, amount: bigint): Promise<string | null> {
  const q = await quote(mint, CONFIG.wsolMint, amount);
  if (!q) return "no sell route on Jupiter";
  const { tx } = await buildSwap(q, new PublicKey(holder));
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  return sim.value.err ? `sell simulation failed (${JSON.stringify(sim.value.err)})` : null;
}
