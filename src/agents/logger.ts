// AGENT 5 — LOGGER (orange). One job: write every decision, with a reason, to SQLite AND
// a plain-text night.log with line numbers. A decision without a reason throws.
//
// night.log format (one numbered entry, reason indented underneath):
//   #0032  03:41:07  EXIT      $TOKEN       +$19.45
//          take-profit 3R
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONFIG } from "../config.js";
import { setAgent, update, state } from "../state.js";
import { redact } from "../security/wallet.js";
import type { ClosedTrade, LogEntry, LogKind } from "../types.js";

mkdirSync(CONFIG.dataDir, { recursive: true });
const LOG_PATH = join(CONFIG.dataDir, "night.log");
export const db = new DatabaseSync(join(CONFIG.dataDir, "grok.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS decisions (
    line INTEGER PRIMARY KEY, ts INTEGER, kind TEXT, ticker TEXT, mint TEXT,
    detail TEXT, reason TEXT NOT NULL, pnl_usd REAL, mode TEXT);
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, ticker TEXT, mode TEXT,
    opened_at INTEGER, closed_at INTEGER, cost_usd REAL, proceeds_usd REAL,
    entry_price REAL, exit_price REAL, entry_slip_pct REAL, exit_slip_pct REAL,
    size_pct REAL, pnl_usd REAL, pnl_pct REAL, entry_reason TEXT, exit_reason TEXT);
  CREATE TABLE IF NOT EXISTS equity (ts INTEGER, balance REAL, closes INTEGER, mode TEXT);
`);

let line = Number((db.prepare("SELECT MAX(line) AS m FROM decisions").get() as { m: number | null }).m ?? 0);

const hhmmss = (ts: number) => new Date(ts).toTimeString().slice(0, 8);

export function logDecision(kind: LogKind, ticker: string, mint: string, detail: string, reason: string, pnlUsd?: number) {
  if (!reason.trim()) throw new Error(`logger: refusing ${kind} ${ticker} without a reason`);
  const e: LogEntry = { line: ++line, ts: Date.now(), kind, ticker, detail: redact(detail), reason: redact(reason), pnlUsd };
  db.prepare("INSERT INTO decisions VALUES (?,?,?,?,?,?,?,?,?)").run(
    e.line, e.ts, kind, ticker, mint, e.detail, e.reason, pnlUsd ?? null, state.mode);
  appendFileSync(
    LOG_PATH,
    `#${String(e.line).padStart(4, "0")}  ${hhmmss(e.ts)}  ${kind.padEnd(8)}  ${ticker.padEnd(11)}  ${e.detail}\n` +
      `       ${e.reason}\n`,
  );
  update((s) => {
    s.log = [...s.log, e].slice(-300);
    s.loggerLine = e.line;
    s.sessionLines++;
  });
  setAgent("logger", "WRITE", `line #${e.line} · ${kind.toLowerCase()} ${ticker}`, false);
  return e;
}

export function logTrade(t: ClosedTrade) {
  db.prepare(
    `INSERT INTO trades (mint,ticker,mode,opened_at,closed_at,cost_usd,proceeds_usd,entry_price,exit_price,
      entry_slip_pct,exit_slip_pct,size_pct,pnl_usd,pnl_pct,entry_reason,exit_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(t.mint, t.ticker, state.mode, t.openedAt, t.closedAt, t.costUsd, t.proceedsUsd, t.entryPrice, t.exitPrice,
    t.entrySlipPct, t.exitSlipPct, t.sizePctOfEquity, t.pnlUsd, t.pnlPct, t.entryReason, t.exitReason);
}
