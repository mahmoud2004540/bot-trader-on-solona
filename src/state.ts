// Single in-memory state that agents write to and the dashboard renders.
// Every mutation goes through `update()`, which schedules one WebSocket broadcast.
import { EventEmitter } from "node:events";
import type { AgentId, Candidate, ClosedTrade, LogEntry, Mode, Position } from "./types.js";

export interface AgentView {
  status: string; // SCAN / PASS / SIZE / FLAT / WRITE / UPDATE ...
  last: string; // last action, monospace line on the card
}

export interface DashState {
  mode: Mode;
  liveAvailable: boolean;
  wallet: string | null;
  /** true when no wallet is connected yet: the dashboard shows the Phantom setup card. */
  needsSetup: boolean;
  /** running on a cloud host: setup is done in the host's Variables, not by pasting here */
  cloud: boolean;
  /** /pause from Telegram or the dashboard: no new entries; an open position is still managed. */
  paused: boolean;
  telegram: { enabled: boolean; paired: boolean; bot: string | null; code: string | null };
  /** what's in the bot wallet right now (live only), refreshed every ~30s while flat. */
  funding: { sol: number; usdc: number; at: number } | null;
  notice: string;
  startedAt: number;
  startBalance: number;
  balance: number;
  trades: number;
  wins: number;
  losses: number;
  lastEvent: string;
  activeAgent: AgentId | null;
  agents: Record<AgentId, AgentView>;
  candidates: Candidate[];
  flow: { ticker: string; stage: "idle" | "scan" | "check" | "size" | "exec"; filteredReason: string | null };
  checked: number;
  filtered: number;
  skipped: number;
  sizer: { pct: number | null; status: string };
  loggerLine: number;
  sessionLines: number;
  equityCurve: { t: number; v: number }[];
  closes: number;
  lastClose: { ticker: string; pnlUsd: number; pnlPct: number } | null;
  position: Position | null;
  lastTrade: ClosedTrade | null;
  log: LogEntry[];
}

const agent = (status: string, last: string): AgentView => ({ status, last });

export const state: DashState = {
  mode: "live",
  liveAvailable: false,
  wallet: null,
  needsSetup: false,
  cloud: false,
  paused: false,
  telegram: { enabled: false, paired: false, bot: null, code: null },
  funding: null,
  notice: "",
  startedAt: Date.now(),
  startBalance: 0,
  balance: 0,
  trades: 0,
  wins: 0,
  losses: 0,
  lastEvent: "BOOT · LOGGING ON",
  activeAgent: null,
  agents: {
    scanner: agent("SCAN", "warming up"),
    rug: agent("PASS", "waiting for a flag"),
    sizer: agent("SIZE", "waiting for a pass"),
    executor: agent("FLAT", "no position"),
    logger: agent("WRITE", "line #0"),
    equity: agent("UPDATE", "reading balance"),
  },
  candidates: [],
  flow: { ticker: "—", stage: "idle", filteredReason: null },
  checked: 0,
  filtered: 0,
  skipped: 0,
  sizer: { pct: null, status: "idle" },
  loggerLine: 0,
  sessionLines: 0,
  equityCurve: [],
  closes: 0,
  lastClose: null,
  position: null,
  lastTrade: null,
  log: [],
};

export const bus = new EventEmitter();
let scheduled = false;

export function update(mut: (s: DashState) => void) {
  mut(state);
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    bus.emit("state", state);
  }, 150);
}

export function setAgent(id: AgentId, status: string, last: string, active = true) {
  update((s) => {
    s.agents[id] = { status, last };
    if (active) s.activeAgent = id;
  });
}
