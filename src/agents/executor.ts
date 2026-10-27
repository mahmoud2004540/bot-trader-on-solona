// AGENT 4 — EXECUTOR (teal). One job: open and close positions via Jupiter.
//
// - Slippage cap 2.0% on every swap (slippageBps=200); entries whose quoted price impact
//   is above the cap are not taken.
// - Records entry, exit, and ACTUAL slippage (quoted out vs. tokens/USDC really received).
// - Stop-loss -12%, take-profit +36% (3R). Mark price = what Jupiter would pay for the
//   whole bag right now, so the stop reflects real exit liquidity, not a chart price.
// - In paper mode fills are taken from Jupiter quotes and nothing is signed.
import { PublicKey } from "@solana/web3.js";
import { CONFIG } from "../config.js";
import { setAgent, update } from "../state.js";
import { fromUi, toUi, usd, signedUsd } from "../util.js";
import { conn, tokenBalance } from "../data/solana.js";
import { buildSwap } from "../data/jupiter.js";
import { allowQuoteSpend } from "../security/txGuard.js";
import { signGuarded, walletPublicKey } from "../security/wallet.js";
import type { Market } from "../data/market.js";
import type { Candidate, ClosedTrade, Mode, Position, Quote } from "../types.js";

const E = CONFIG.executor;
const capPct = E.slippageBps / 100;

async function swapLive(q: Quote, maxQuoteSpend: bigint): Promise<string> {
  const me = walletPublicKey();
  if (!me) throw new Error("live mode without wallet");
  const { tx, lastValidBlockHeight } = await buildSwap(q, me);
  allowQuoteSpend(maxQuoteSpend);
  const signed = await signGuarded(conn, tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  const blockhash = signed.message.recentBlockhash;
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`swap failed on-chain ${JSON.stringify(res.value.err)}`);
  return sig;
}

const slipPct = (quoted: bigint, actual: bigint) =>
  quoted > 0n ? Math.max(0, (Number(quoted - actual) / Number(quoted)) * 100) : 0;

export async function open(
  market: Market,
  mode: Mode,
  c: Candidate,
  decimals: number,
  sizeUsd: number,
  sizePct: number,
  entryReason: string,
): Promise<Position | { error: string }> {
  setAgent("executor", "EXEC", `buying ${c.ticker} ${usd(sizeUsd)}`);
  update((s) => (s.flow.stage = "exec"));
  const amountIn = fromUi(sizeUsd, CONFIG.quoteDecimals);
  const q = await market.quote(CONFIG.quoteMint, c.mint, amountIn);
  if (!q) return { error: "no Jupiter route" };
  if (q.priceImpactPct > capPct) return { error: `price impact ${q.priceImpactPct.toFixed(1)}% > cap ${capPct}%` };

  let tokens = q.outAmount;
  if (mode === "live") {
    const me = walletPublicKey()!;
    const before = await tokenBalance(me, c.mint);
    try {
      await swapLive(q, amountIn);
    } catch (e) {
      // A confirmation timeout does not mean the swap didn't land: never lose track of a bag.
      if ((await tokenBalance(me, c.mint)) <= before) throw e;
    }
    tokens = (await tokenBalance(me, c.mint)) - before;
    if (tokens <= 0n) throw new Error("buy confirmed but no tokens received");
  }
  const pos: Position = {
    mint: c.mint,
    ticker: c.ticker,
    decimals,
    openedAt: Date.now(),
    costUsd: sizeUsd,
    tokens,
    entryPrice: sizeUsd / toUi(tokens, decimals),
    entrySlipPct: slipPct(q.outAmount, tokens),
    sizePctOfEquity: sizePct,
    entryReason,
    markUsd: sizeUsd,
  };
  setAgent("executor", "LONG", `long ${c.ticker} · ${usd(sizeUsd)}`);
  return pos;
}

/** Returns an exit reason when stop or target is hit, else null. Updates the mark. */
export async function monitor(market: Market, pos: Position): Promise<string | null> {
  const q = await market.quote(pos.mint, CONFIG.quoteMint, pos.tokens);
  if (!q) {
    setAgent("executor", "LONG", `${pos.ticker} · no quote, holding`, false);
    return null;
  }
  pos.markUsd = toUi(q.outAmount, CONFIG.quoteDecimals);
  const pnlPct = (pos.markUsd / pos.costUsd - 1) * 100;
  setAgent("executor", "LONG", `${pos.ticker} ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% · ${signedUsd(pos.markUsd - pos.costUsd)}`, false);
  update((s) => (s.position = { ...pos }));
  if (pnlPct <= E.stopLossPct) return `stop ${Math.abs(pnlPct).toFixed(0)}% hit`;
  if (pnlPct >= E.takeProfitPct) return "take-profit 3R";
  return null;
}

export async function close(market: Market, mode: Mode, pos: Position, exitReason: string): Promise<ClosedTrade> {
  setAgent("executor", "EXEC", `selling ${pos.ticker} · ${exitReason}`);
  let tokens = pos.tokens;
  let me: PublicKey | null = null;
  if (mode === "live") {
    me = walletPublicKey()!;
    tokens = await tokenBalance(me, pos.mint);
    if (tokens === 0n) {
      // An earlier exit landed after its confirmation timed out; book it at the last mark.
      return closedTrade(pos, pos.tokens, pos.markUsd, 0, `${exitReason} (late fill)`);
    }
  }
  const q = await market.quote(pos.mint, CONFIG.quoteMint, tokens);
  if (!q) throw new Error("no Jupiter route to exit");
  let received = q.outAmount;
  if (mode === "live" && me) {
    const before = await tokenBalance(me, CONFIG.quoteMint);
    await swapLive(q, 0n); // a sell may not spend any USDC
    received = (await tokenBalance(me, CONFIG.quoteMint)) - before;
  }
  return closedTrade(pos, tokens, toUi(received, CONFIG.quoteDecimals), slipPct(q.outAmount, received), exitReason);
}

function closedTrade(pos: Position, tokens: bigint, proceedsUsd: number, exitSlipPct: number, exitReason: string): ClosedTrade {
  const t: ClosedTrade = {
    ...pos,
    markUsd: proceedsUsd,
    closedAt: Date.now(),
    exitPrice: proceedsUsd / toUi(tokens, pos.decimals),
    exitSlipPct,
    proceedsUsd,
    pnlUsd: proceedsUsd - pos.costUsd,
    pnlPct: (proceedsUsd / pos.costUsd - 1) * 100,
    exitReason,
  };
  setAgent("executor", "FLAT", `closed ${pos.ticker} ${signedUsd(t.pnlUsd)}`);
  return t;
}
