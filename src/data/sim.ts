// Synthetic market for `npm run demo`: lets you watch the whole pipeline and dashboard
// with no wallet and no network. Paper mode only — the demo never touches a real chain.
import { CONFIG } from "../config.js";
import { fromUi } from "../util.js";
import type { Market } from "./market.js";
import type { MintFacts, PairSnapshot } from "../types.js";

const NAMES = ["BONKZ", "WIF2", "MOODENG", "GIGA", "PNUT", "CHILLGUY", "FWOG", "MEW", "RETARDIO", "SIGMA", "ZEREBRO", "GOAT", "POPCAT", "MICHI", "SC"];

interface SimToken { mint: string; symbol: string; price: number; decimals: number; flaw: string | null; lp: number; dev: number; holders: number; m5: number; h1: number; h6: number }
const tokens = new Map<string, SimToken>();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function spawn(): SimToken {
  const flaws = [null, null, null, "freeze", "mint", "lp", "dev", "honeypot"];
  const flaw = flaws[Math.floor(Math.random() * flaws.length)];
  const t: SimToken = {
    mint: "SIM" + Math.random().toString(36).slice(2, 12).toUpperCase(),
    symbol: NAMES[Math.floor(Math.random() * NAMES.length)],
    price: rnd(0.00001, 0.01),
    decimals: 6,
    flaw,
    lp: flaw === "lp" ? rnd(40, 84) : rnd(85, 100),
    dev: flaw === "dev" ? rnd(6, 15) : rnd(0, 4.5),
    holders: Math.floor(rnd(300, 3000)),
    m5: 0,
    h1: rnd(5_000, 40_000),
    h6: rnd(30_000, 200_000),
  };
  t.m5 = (t.h1 / 12) * rnd(2.5, 9);
  tokens.set(t.mint, t);
  return t;
}

// Random walk with a slight upward drift so demo trades resolve in a few minutes.
setInterval(() => { for (const t of tokens.values()) t.price *= 1 + rnd(-0.03, 0.033); }, 2_000).unref();

export const simMarket: Market = {
  async discover(): Promise<PairSnapshot[]> {
    const fresh = Array.from({ length: Math.floor(rnd(0, 3)) }, spawn);
    return fresh.map((t) => ({ mint: t.mint, symbol: t.symbol, name: t.symbol, pairAddress: "sim", priceUsd: t.price, liquidityUsd: 50_000, volM5: t.m5, volH1: t.h1, volH6: t.h6 }));
  },
  async holders(m) { return tokens.get(m)?.holders ?? null; },
  async lpLockedPct(m) { return tokens.get(m)?.lp ?? null; },
  async mintFacts(m): Promise<MintFacts> {
    const t = tokens.get(m)!;
    return {
      decimals: t.decimals, supply: 10n ** 15n,
      mintAuthority: t.flaw === "mint" ? "SimMintAuth111" : null,
      freezeAuthority: t.flaw === "freeze" ? "SimFreezeAuth111" : null,
      tokenProgram: "sim", extensions: [], transferFeeBps: 0, defaultFrozen: false,
    };
  },
  async devWalletPct(m) { return tokens.get(m)?.dev ?? null; },
  async sellTest(m) { return tokens.get(m)?.flaw === "honeypot" ? "sell simulation failed (custom program error 0x1771)" : null; },
  async quote(inMint, outMint, amount) {
    const isBuy = inMint === CONFIG.quoteMint;
    const t = tokens.get(isBuy ? outMint : inMint);
    if (!t) return null;
    const impact = rnd(0.1, 0.8) / 100;
    const out = isBuy
      ? fromUi((Number(amount) / 1e6 / t.price) * (1 - impact), t.decimals)
      : fromUi((Number(amount) / 10 ** t.decimals) * t.price * (1 - impact), 6);
    return { inAmount: amount, outAmount: out, priceImpactPct: impact * 100, raw: null };
  },
};
