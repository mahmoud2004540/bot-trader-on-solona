// Wires the six agents into one pipeline:  SCAN → CHECK → SIZE → EXEC → LOG → EQUITY.
// One position at a time: while a position is open the loop only monitors it.
import { CONFIG } from "./config.js";
import { state, update, setAgent } from "./state.js";
import { redact, walletPublicKey } from "./security/wallet.js";
import { scan } from "./agents/scanner.js";
import { rugCheck } from "./agents/rugCheck.js";
import { size } from "./agents/sizer.js";
import * as executor from "./agents/executor.js";
import { logDecision, logTrade } from "./agents/logger.js";
import * as equity from "./agents/equity.js";
import { signedUsd, sleep, usd } from "./util.js";
import type { Market } from "./data/market.js";
import type { Mode } from "./types.js";

const seen = new Map<string, number>(); // mint -> last time we decided on it
const recentlyDecided = (mint: string) => Date.now() - (seen.get(mint) ?? 0) < CONFIG.recheckFilteredAfterMs;
let busy = false; // true while a swap is in flight; blocks mode switches

export function setMode(mode: Mode): string | null {
  if (mode === state.mode) return null;
  if (state.position || busy) return "close the open position before switching mode";
  if (mode === "live" && !walletPublicKey()) return "live needs SOLANA_PRIVATE_KEY in .env";
  update((s) => {
    s.mode = mode;
    s.notice = mode === "live" ? "LIVE · real funds" : "paper · simulated fills";
  });
  void equity.resetSession(mode);
  return null;
}

async function manageOpenPosition(market: Market) {
  const pos = state.position!;
  const exitReason = await executor.monitor(market, pos);
  if (!exitReason) return;
  busy = true;
  try {
    const t = await executor.close(market, state.mode, pos, exitReason);
    logTrade(t);
    logDecision("EXIT", t.ticker, t.mint, signedUsd(t.pnlUsd), exitReason, t.pnlUsd);
    update((s) => {
      s.position = null;
      s.lastTrade = t;
      s.lastEvent = `TRADE CLOSED · LOGGED ${t.ticker}`;
      s.flow = { ticker: t.ticker, stage: "idle", filteredReason: null };
    });
    await equity.onClose(state.mode, t);
  } catch (e) {
    // Stay in the position and retry with a fresh quote next tick (cap stays 2%).
    setAgent("executor", "LONG", `exit retry · ${redact((e as Error).message).slice(0, 50)}`);
  } finally {
    busy = false;
  }
}

async function hunt(market: Market) {
  const flagged = await scan(market, recentlyDecided);
  for (const c of flagged) {
    if (state.position) {
      update((s) => {
        s.skipped++;
        const card = s.candidates.find((x) => x.mint === c.mint);
        if (card) card.status = "skipped";
      });
      continue;
    }
    seen.set(c.mint, Date.now());
    const rug = await rugCheck(market, c);
    if (!rug.pass) {
      logDecision("FILTERED", c.ticker, c.mint, "not traded", rug.reason);
      update((s) => (s.lastEvent = `FILTERED · ${c.ticker}`));
      continue;
    }

    const eq = await equity.readBalance(state.mode);
    const { sizePct, sizeUsd } = size(c, rug, eq);
    if (sizeUsd < 1) {
      logDecision("FILTERED", c.ticker, c.mint, "not traded", `equity ${usd(eq)} too small to size`);
      continue;
    }
    const entryReason = `spike ${c.spikeX.toFixed(1)}x · dev wallet ${rug.devWalletPct.toFixed(0)}%`;
    busy = true;
    try {
      const res = await executor.open(market, state.mode, c, rug.decimals, sizeUsd, sizePct, entryReason);
      if ("error" in res) {
        logDecision("FILTERED", c.ticker, c.mint, "not traded", res.error);
        setAgent("executor", "FLAT", `skipped ${c.ticker} · ${res.error}`);
        continue;
      }
      logDecision("ENTER", c.ticker, c.mint, `${sizePct.toFixed(0)}% · ${usd(sizeUsd)}`, entryReason);
      update((s) => {
        s.position = res;
        s.lastEvent = `TRADE OPENED · LOGGED ${c.ticker}`;
        const card = s.candidates.find((x) => x.mint === c.mint);
        if (card) card.status = "traded";
      });
    } catch (e) {
      const msg = redact((e as Error).message).slice(0, 80);
      logDecision("FILTERED", c.ticker, c.mint, "not traded", `entry failed: ${msg}`);
      setAgent("executor", "FLAT", `entry failed · ${msg.slice(0, 40)}`);
    } finally {
      busy = false;
    }
  }
  if (!state.position) setAgent("executor", "FLAT", state.agents.executor.last, false);
}

export async function run(market: Market) {
  for (;;) {
    try {
      if (state.position) await manageOpenPosition(market);
      else await hunt(market);
    } catch (e) {
      console.error("[loop]", redact(String((e as Error)?.message ?? e)));
    }
    await sleep(state.position ? CONFIG.monitorEveryMs : CONFIG.scanEveryMs);
  }
}
