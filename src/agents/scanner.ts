// AGENT 1 — SCANNER (yellow). One job: flag tokens. It never trades.
//
// Flag when:  (spike >= 3x vs previous 5 min  OR  vol >= 7x with 500+ holders)
//        AND  LP >= 85% locked
//
// spikeX = current 5m volume / previous 5m volume. The previous window comes from our own
//          snapshot taken ~5 minutes ago; on first sight we estimate it as (h1 - m5) / 11.
// volX   = current 5m volume / average 5m volume over the last 6 hours (h6 / 72).
import { CONFIG } from "../config.js";
import { setAgent, update } from "../state.js";
import { ticker } from "../util.js";
import type { Market } from "../data/market.js";
import type { Candidate, PairSnapshot } from "../types.js";

const C = CONFIG.scanner;
const history = new Map<string, { at: number; m5: number }[]>();

function previousWindow(p: PairSnapshot): number {
  const h = history.get(p.mint) ?? [];
  const old = h.find((x) => Date.now() - x.at >= 4.5 * 60_000 && Date.now() - x.at <= 7 * 60_000);
  return old ? old.m5 : Math.max(0, p.volH1 - p.volM5) / 11;
}

function remember(p: PairSnapshot) {
  const h = (history.get(p.mint) ?? []).filter((x) => Date.now() - x.at < 10 * 60_000);
  h.push({ at: Date.now(), m5: p.volM5 });
  history.set(p.mint, h);
}

export async function scan(market: Market, skip: (mint: string) => boolean): Promise<Candidate[]> {
  setAgent("scanner", "SCAN", "scanning new pairs…");
  const pairs = await market.discover().catch(() => [] as PairSnapshot[]);
  update((s) => (s.checked += pairs.length));
  const flagged: Candidate[] = [];

  for (const p of pairs) {
    const prev = previousWindow(p);
    remember(p);
    if (skip(p.mint) || p.volM5 < C.minM5VolumeUsd) continue;
    const spikeX = prev > 0 ? p.volM5 / prev : p.volM5 > 0 ? 99 : 0;
    const avg5m = p.volH6 / 72;
    const volX = avg5m > 0 ? p.volM5 / avg5m : 0;
    const spikeOk = spikeX >= C.minSpikeX;
    const volOk = volX >= C.minVolX;
    if (!spikeOk && !volOk) continue;

    const [lp, holders] = await Promise.all([market.lpLockedPct(p.mint), market.holders(p.mint)]);
    if (lp === null || lp < C.minLpLockedPct) continue;
    if (!spikeOk && (holders ?? 0) < C.minHoldersForVolX) continue;

    const c: Candidate = {
      mint: p.mint,
      ticker: ticker(p.symbol),
      lpLockedPct: lp,
      spikeX,
      volX,
      holders,
      flaggedAt: Date.now(),
      status: "pending",
    };
    flagged.push(c);
    setAgent("scanner", "SCAN", `next ${c.ticker} · LP ${lp.toFixed(0)}% locked`);
  }

  // strongest signal first
  flagged.sort((a, b) => b.spikeX - a.spikeX);
  update((s) => {
    s.candidates = [...flagged, ...s.candidates.filter((c) => !flagged.some((f) => f.mint === c.mint))].slice(0, 8);
    if (!flagged.length) s.agents.scanner.last = `${pairs.length} pairs · nothing flagged`;
  });
  return flagged;
}
