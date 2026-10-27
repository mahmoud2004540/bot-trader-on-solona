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
    // Two independent answers for "who is the dev": rugcheck's creator and the on-chain payer
    // of the mint's first transaction. They can disagree, so the larger holding counts.
    const creators = [(await rugReport(mint)).creator, await sol.mintCreator(mint).catch(() => null)];
    const known = [...new Set(creators.filter((c): c is string => Boolean(c)))];
    if (!known.length || facts.supply === 0n) return null;
    let worst = 0;
    for (const c of known) worst = Math.max(worst, Number(await sol.tokenBalance(new PublicKey(c), mint)) / Number(facts.supply) * 100);
    return worst;
  },
  async sellTest(mint) {
    const holders = await sol.sellSimHolders(mint, (await rugReport(mint)).topHolderOwners);
    if (!holders.length) return "sell simulation failed: no holder wallet to simulate";
    for (const h of holders) {
      const err = await jup.simulateHolderSell(mint, h.owner, h.amount / 10n || 1n);
      if (err) return err;
    }
    return null;
  },
  quote: jup.quote,
};
