// The one interface agents use to see the market. `liveMarket` talks to real APIs/RPC;
// sim.ts provides a synthetic one for `npm run demo` (paper only).
import { PublicKey } from "@solana/web3.js";
import * as dex from "./dexscreener.js";
import * as birdeye from "./birdeye.js";
import * as jup from "./jupiter.js";
import * as sol from "./solana.js";
import { rugReport } from "./rugcheck.js";
import type { MintFacts, PairSnapshot, Quote } from "../types.js";

export interface Market {
  discover(): Promise<PairSnapshot[]>;
  holders(mint: string): Promise<number | null>;
  lpLockedPct(mint: string): Promise<number | null>;
  mintFacts(mint: string): Promise<MintFacts>;
  devWalletPct(mint: string, facts: MintFacts): Promise<number | null>;
  /** null = holder sell simulated fine; string = exact failure reason. */
  sellTest(mint: string): Promise<string | null>;
  quote(inputMint: string, outputMint: string, amount: bigint): Promise<Quote | null>;
}

export const liveMarket: Market = {
  async discover() {
    const mints = [...new Set([...(await dex.latestMints()), ...(await birdeye.newListings())])];
    return dex.pairsFor(mints);
  },
  async holders(mint) {
    return (await birdeye.holders(mint)) ?? (await rugReport(mint)).totalHolders;
  },
  async lpLockedPct(mint) {
    return (await rugReport(mint)).lpLockedPct;
  },
  mintFacts: sol.mintFacts,
  async devWalletPct(mint, facts) {
    const { creator } = await rugReport(mint);
    if (!creator || facts.supply === 0n) return null;
    const held = await sol.tokenBalance(new PublicKey(creator), mint);
    return (Number(held) / Number(facts.supply)) * 100;
  },
  async sellTest(mint) {
    const holders = await sol.sellSimHolders(mint, 2);
    if (!holders.length) return "sell simulation failed: no holder wallet to simulate";
    for (const h of holders) {
      const err = await jup.simulateHolderSell(mint, h.owner, h.amount / 10n || 1n);
      if (err) return err;
    }
    return null;
  },
  quote: jup.quote,
};
