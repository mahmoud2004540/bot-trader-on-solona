// Shared shapes passed between agents and pushed to the dashboard.

export type AgentId = "scanner" | "rug" | "sizer" | "executor" | "logger" | "equity";
export type Mode = "live" | "paper";

/** One pair as seen by the scanner. `symbol`/`name` are UNTRUSTED (set by the token creator). */
export interface PairSnapshot {
  mint: string;
  symbol: string;
  name: string;
  pairAddress: string;
  priceUsd: number;
  liquidityUsd: number;
  volM5: number;
  volH1: number;
  volH6: number;
}

/** A token the scanner flagged. */
export interface Candidate {
  mint: string;
  ticker: string;
  lpLockedPct: number;
  spikeX: number;
  volX: number;
  holders: number | null;
  flaggedAt: number;
  status: "pending" | "pass" | "filtered" | "traded" | "skipped";
  reason?: string;
}

/** On-chain facts about a mint, read directly from RPC (never from third-party claims). */
export interface MintFacts {
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  tokenProgram: string;
  /** Token-2022 extension names present on the mint, e.g. "transferHook". */
  extensions: string[];
  transferFeeBps: number;
  defaultFrozen: boolean;
}

export interface RugResult {
  pass: boolean;
  reason: string; // exact failing reason, or a short pass summary
  devWalletPct: number;
  lpLockedPct: number;
  decimals: number;
}

export interface Quote {
  inAmount: bigint;
  outAmount: bigint;
  priceImpactPct: number;
  raw: unknown; // Jupiter's quoteResponse, passed back verbatim to /swap
}

export interface Position {
  mint: string;
  ticker: string;
  decimals: number;
  openedAt: number;
  costUsd: number;
  tokens: bigint;
  entryPrice: number;
  entrySlipPct: number;
  sizePctOfEquity: number;
  entryReason: string;
  markUsd: number;
}

export interface ClosedTrade extends Position {
  closedAt: number;
  exitPrice: number;
  exitSlipPct: number;
  proceedsUsd: number;
  pnlUsd: number;
  pnlPct: number;
  exitReason: string;
}

export type LogKind = "ENTER" | "EXIT" | "FILTERED" | "INFO";

export interface LogEntry {
  line: number;
  ts: number;
  kind: LogKind;
  ticker: string;
  detail: string; // size or PnL column
  reason: string;
  pnlUsd?: number;
}
