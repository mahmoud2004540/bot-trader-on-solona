// AGENT 6 — EQUITY (blue). One job: update balance + equity curve on every close,
// and count closes. Live balance = wallet USDC (read on-chain); paper balance = ledger.
// It also owns the "session" (start time + start balance) so a restart at 3am resumes
// the night instead of resetting START vs NOW.
import { CONFIG } from "../config.js";
import { bus, setAgent, update, state } from "../state.js";
import { db, lastSession, newSession, sessionHistory } from "./logger.js";
import { tokenBalance } from "../data/solana.js";
import { walletPublicKey } from "../security/wallet.js";
import { toUi, usd } from "../util.js";
import type { ClosedTrade, Mode } from "../types.js";

const RESUME_WINDOW_MS = 16 * 3600_000; // a restart within one night continues that night
let paperBalance = CONFIG.paperStartUsd;

export async function readBalance(mode: Mode): Promise<number> {
  const me = walletPublicKey();
  if (mode === "live" && me) return toUi(await tokenBalance(me, CONFIG.quoteMint), CONFIG.quoteDecimals);
  return paperBalance;
}

/** Resume the last session if it is recent and in the same mode, else start a new one. */
export async function startSession(mode: Mode, opts: { resume: boolean }) {
  const last = lastSession();
  if (opts.resume && last && last.mode === mode && Date.now() - last.started_at < RESUME_WINDOW_MS) {
    const h = sessionHistory(mode, last.started_at);
    if (mode === "paper") paperBalance = last.start_balance + h.trades.reduce((s, t) => s + t.pnl_usd, 0);
    const bal = await readBalance(mode);
    const lt = h.trades.at(-1);
    update((s) => {
      s.startedAt = last.started_at;
      s.startBalance = last.start_balance;
      s.balance = bal;
      s.trades = s.closes = h.trades.length;
      s.wins = h.trades.filter((t) => t.pnl_usd >= 0).length;
      s.losses = s.trades - s.wins;
      s.equityCurve = [{ t: last.started_at, v: last.start_balance }, ...h.curve.map((c) => ({ t: c.ts, v: c.balance }))];
      s.log = h.log.slice(-3000);
      s.sessionLines = h.log.length;
      s.loggerLine = h.log.at(-1)?.line ?? s.loggerLine;
      s.filtered = h.log.filter((e) => e.kind === "FILTERED").length;
      s.lastClose = lt ? { ticker: lt.ticker, pnlUsd: lt.pnl_usd, pnlPct: lt.pnl_pct } : null;
      s.lastTrade = lt
        ? { mint: lt.mint, ticker: lt.ticker, decimals: 0, tokens: 0n, openedAt: lt.opened_at, closedAt: lt.closed_at,
            costUsd: lt.cost_usd, proceedsUsd: lt.proceeds_usd, markUsd: lt.proceeds_usd, entryPrice: lt.entry_price,
            exitPrice: lt.exit_price, entrySlipPct: lt.entry_slip_pct, exitSlipPct: lt.exit_slip_pct,
            sizePctOfEquity: lt.size_pct, pnlUsd: lt.pnl_usd, pnlPct: lt.pnl_pct, entryReason: lt.entry_reason, exitReason: lt.exit_reason }
        : null;
      s.lastEvent = "RESTARTED · SESSION RESUMED";
    });
    bus.emit("history");
    setAgent("equity", "UPDATE", `${usd(bal)} · ${state.closes} closes`, false);
    return bal;
  }

  if (mode === "paper") paperBalance = CONFIG.paperStartUsd;
  const bal = await readBalance(mode);
  const now = Date.now();
  newSession(mode, now, bal);
  update((s) => {
    s.startedAt = now;
    s.startBalance = s.balance = bal;
    s.trades = s.wins = s.losses = s.closes = s.filtered = s.skipped = s.sessionLines = 0;
    s.equityCurve = [{ t: now, v: bal }];
    s.log = [];
    s.lastClose = null;
    s.lastTrade = null;
  });
  bus.emit("history");
  setAgent("equity", "UPDATE", `${usd(bal)} · 0 closes`, false);
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
