// AGENT 6 — EQUITY (blue). One job: update balance + equity curve on every close,
// and count closes. Live balance = wallet USDC (read on-chain); paper balance = ledger.
import { CONFIG } from "../config.js";
import { setAgent, update, state } from "../state.js";
import { db } from "./logger.js";
import { tokenBalance } from "../data/solana.js";
import { walletPublicKey } from "../security/wallet.js";
import { toUi, usd } from "../util.js";
import type { ClosedTrade, Mode } from "../types.js";

let paperBalance = CONFIG.paperStartUsd;

export async function readBalance(mode: Mode): Promise<number> {
  const me = walletPublicKey();
  if (mode === "live" && me) return toUi(await tokenBalance(me, CONFIG.quoteMint), CONFIG.quoteDecimals);
  return paperBalance;
}

/** Called once at start and whenever the mode changes. */
export async function resetSession(mode: Mode) {
  if (mode === "paper") paperBalance = CONFIG.paperStartUsd;
  const bal = await readBalance(mode);
  update((s) => {
    s.startBalance = bal;
    s.balance = bal;
    s.equityCurve = [{ t: Date.now(), v: bal }];
  });
  setAgent("equity", "UPDATE", `${usd(bal)} · ${state.closes} closes`, false);
  return bal;
}

export async function onClose(mode: Mode, t: ClosedTrade) {
  if (mode === "paper") paperBalance += t.pnlUsd;
  const bal = await readBalance(mode).catch(() => state.balance + t.pnlUsd);
  update((s) => {
    s.balance = bal;
    s.closes++;
    s.trades++;
    if (t.pnlUsd >= 0) s.wins++;
    else s.losses++;
    s.equityCurve = [...s.equityCurve, { t: t.closedAt, v: bal }].slice(-500);
    s.lastClose = { ticker: t.ticker, pnlUsd: t.pnlUsd, pnlPct: t.pnlPct };
  });
  db.prepare("INSERT INTO equity VALUES (?,?,?,?)").run(Date.now(), bal, state.closes, mode);
  setAgent("equity", "UPDATE", `${usd(bal)} · ${state.closes} closes`);
}
