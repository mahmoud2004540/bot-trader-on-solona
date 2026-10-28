// Jupiter: quotes, swap-transaction building, and simulating someone else's sell.
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { CONFIG } from "../config.js";
import { sleep } from "../util.js";
import { conn } from "./solana.js";
import type { Quote } from "../types.js";

const headers = (): Record<string, string> => ({
  "content-type": "application/json",
  ...(CONFIG.jupiterApiKey ? { "x-api-key": CONFIG.jupiterApiKey } : {}),
});

// The free lite-api only allows a few requests at a time and answers 429 beyond that.
// Every Jupiter call goes through one queue at a pace it accepts, and 429/5xx are retried
// with backoff, so "Jupiter was busy" is never mistaken for "this token can't be sold".
const MIN_GAP_MS = CONFIG.jupiterApiKey ? 250 : 1_100;
let nextSlot = 0;
async function slot() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await sleep(wait);
}

export class JupiterBusy extends Error {
  constructor() {
    super("Jupiter busy (rate limited), will retry");
  }
}

async function jup(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await slot();
    let res: Response;
    try {
      res = await fetch(`${CONFIG.jupiterBase}${path}`, { ...init, headers: headers(), signal: AbortSignal.timeout(10_000) });
    } catch {
      await sleep(1_000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(1_000 * 2 ** attempt);
      continue;
    }
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  throw new JupiterBusy();
}

/** null = Jupiter has no route (a real answer). Throws JupiterBusy if it couldn't be asked. */
export async function quote(inputMint: string, outputMint: string, amount: bigint): Promise<Quote | null> {
  if (amount <= 0n) return null;
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: String(CONFIG.executor.slippageBps),
    restrictIntermediateTokens: "true",
  });
  const { status, body: r } = await jup(`/quote?${q}`);
  if (status !== 200 || !r?.outAmount) return null;
  // Our own request params must come back unchanged; anything else is not trusted.
  if (r.inputMint !== inputMint || r.outputMint !== outputMint || r.platformFee) return null;
  return { inAmount: BigInt(r.inAmount), outAmount: BigInt(r.outAmount), priceImpactPct: Number(r.priceImpactPct) * 100, raw: r };
}

/** Build (not sign, not send) a swap transaction for `user`. No fee account, no custom destination. */
export async function buildSwap(q: Quote, user: PublicKey) {
  const { status, body: r } = await jup("/swap", {
    method: "POST",
    body: JSON.stringify({
      quoteResponse: q.raw,
      userPublicKey: user.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 2_000_000, priorityLevel: "high" } },
    }),
  });
  if (status !== 200 || !r?.swapTransaction) throw new Error(`Jupiter /swap ${status}`);
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
