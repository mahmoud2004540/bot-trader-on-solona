// AGENT 2 — RUG CHECK (red). One job: nothing executes before a pass.
//
// Rejects (FILTERED, never traded) with the exact failing reason when:
//   freeze authority on · mint authority not revoked · LP locked < 85% · dev wallet > 5%
//   · dangerous Token-2022 extension · sell simulation fails (honeypot)
//   · buy->sell round trip on Jupiter loses too much (hidden tax)
// Any error while checking is also a reject: unknown == unsafe.
import { CONFIG } from "../config.js";
import { setAgent, update } from "../state.js";
import { fromUi, pct } from "../util.js";
import { isDangerousExtension } from "../data/solana.js";
import type { Market } from "../data/market.js";
import type { Candidate, RugResult } from "../types.js";

const R = CONFIG.rug;

async function evaluate(market: Market, c: Candidate): Promise<RugResult> {
  const fail = (reason: string, extra: Partial<RugResult> = {}): RugResult => ({
    pass: false,
    reason,
    devWalletPct: NaN,
    lpLockedPct: c.lpLockedPct,
    decimals: 0,
    ...extra,
  });

  const f = await market.mintFacts(c.mint);
  if (f.freezeAuthority) return fail("freeze authority on");
  if (f.mintAuthority) return fail("mint authority not revoked");
  if (f.defaultFrozen) return fail("token accounts frozen by default");
  const bad = f.extensions.find(isDangerousExtension);
  if (bad) return fail(`token-2022 extension: ${bad}`);
  if (f.transferFeeBps > R.maxTransferFeeBps) return fail(`transfer fee ${(f.transferFeeBps / 100).toFixed(1)}%`);

  const lp = await market.lpLockedPct(c.mint);
  if (lp === null) return fail("LP lock unknown");
  if (lp < R.minLpLockedPct) return fail(`LP locked ${pct(lp, 0)} < ${R.minLpLockedPct}%`);

  const dev = await market.devWalletPct(c.mint, f);
  if (dev === null) return fail("dev wallet unknown", { lpLockedPct: lp });
  if (dev > R.maxDevWalletPct) return fail(`dev wallet ${pct(dev, 0)} > ${R.maxDevWalletPct}%`, { lpLockedPct: lp, devWalletPct: dev });

  const sellErr = await market.sellTest(c.mint);
  if (sellErr) return fail(sellErr, { lpLockedPct: lp, devWalletPct: dev });

  // Round trip $10 USDC -> token -> USDC through Jupiter.
  const probe = fromUi(10, CONFIG.quoteDecimals);
  const buy = await market.quote(CONFIG.quoteMint, c.mint, probe);
  const back = buy && (await market.quote(c.mint, CONFIG.quoteMint, buy.outAmount));
  if (!buy || !back) return fail("sell simulation failed: no Jupiter round trip", { lpLockedPct: lp, devWalletPct: dev });
  const loss = (1 - Number(back.outAmount) / Number(probe)) * 100;
  if (loss > R.maxRoundTripLossPct) return fail(`round trip loses ${pct(loss)} (tax/honeypot)`, { lpLockedPct: lp, devWalletPct: dev });

  return { pass: true, reason: `dev wallet ${pct(dev, 0)} · LP ${pct(lp, 0)}`, devWalletPct: dev, lpLockedPct: lp, decimals: f.decimals };
}

export async function rugCheck(market: Market, c: Candidate): Promise<RugResult> {
  setAgent("rug", "CHECK", `checking ${c.ticker}`);
  update((s) => (s.flow = { ticker: c.ticker, stage: "check", filteredReason: null }));
  let r: RugResult;
  try {
    r = await evaluate(market, c);
  } catch (e) {
    r = { pass: false, reason: `check error: ${(e as Error).message.slice(0, 60)}`, devWalletPct: NaN, lpLockedPct: c.lpLockedPct, decimals: 0 };
  }
  update((s) => {
    const card = s.candidates.find((x) => x.mint === c.mint);
    if (card) Object.assign(card, { status: r.pass ? "pass" : "filtered", reason: r.reason });
    if (!r.pass) {
      s.filtered++;
      s.flow = { ticker: c.ticker, stage: "check", filteredReason: r.reason };
    }
  });
  setAgent("rug", r.pass ? "PASS" : "FAIL", r.pass ? `${c.ticker} passed · ${r.reason}` : `${c.ticker} · ${r.reason}`);
  return r;
}
