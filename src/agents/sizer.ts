// AGENT 3 — SIZER (purple). One job: size from current equity, never a fixed ticket.
//
// size% = 25% + 15% * strength, strength in [0,1] =
//         average of  spike score  (3x -> 0 … 10x+ -> 1)
//                and  dev score    (5% dev wallet -> 0 … 0% -> 1)
// So a 10x spike with a 0% dev wallet gets 40%, a bare 3x spike with a 5% dev gets 25%.
import { CONFIG } from "../config.js";
import { setAgent, update } from "../state.js";
import { clamp, usd } from "../util.js";
import type { Candidate, RugResult } from "../types.js";

const S = CONFIG.sizer;

export function size(c: Candidate, rug: RugResult, equityUsd: number) {
  const spikeScore = clamp((c.spikeX - CONFIG.scanner.minSpikeX) / (S.fullStrengthSpikeX - CONFIG.scanner.minSpikeX), 0, 1);
  const devScore = clamp(1 - rug.devWalletPct / CONFIG.rug.maxDevWalletPct, 0, 1);
  const strength = (spikeScore + devScore) / 2;
  const sizePct = S.minPct + (S.maxPct - S.minPct) * strength;
  const sizeUsd = Math.floor(equityUsd * sizePct) / 100;
  setAgent("sizer", "SIZE", `${sizePct.toFixed(0)}% of ${usd(equityUsd)}`);
  update((s) => {
    s.sizer = { pct: sizePct, status: `${c.ticker} · ${usd(sizeUsd)}` };
    s.flow.stage = "size";
  });
  return { sizePct, sizeUsd };
}
