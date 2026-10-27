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
import { bus, setAgent, update, state } from "../state.js";
import { redact } from "../security/wallet.js";
import type { ClosedTrade, LogEntry, LogKind, Mode, Position } from "../types.js";

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
  CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER, start_balance REAL, mode TEXT);
  CREATE TABLE IF NOT EXISTS open_position (id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT, json TEXT);
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
  printToTerminal(e);
  bus.emit("log", e);
  update((s) => {
    s.log.push(e);
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

// ---- terminal: the same numbered lines, coloured, on stdout ----
const ANSI = { reset: "\x1b[0m", dim: "\x1b[2m", teal: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m", orange: "\x1b[33m" };
function printToTerminal(e: LogEntry) {
  const c = e.kind === "ENTER" ? ANSI.teal : e.kind === "EXIT" ? ((e.pnlUsd ?? 0) >= 0 ? ANSI.green : ANSI.red) : ANSI.red;
  console.log(
    `${ANSI.dim}#${String(e.line).padStart(4, "0")}  ${hhmmss(e.ts)}${ANSI.reset}  ${c}${e.kind.padEnd(8)}${ANSI.reset}  ${e.ticker.padEnd(11)}  ${c}${e.detail}${ANSI.reset}\n` +
      `       ${ANSI.orange}${e.reason}${ANSI.reset}`,
  );
}

// ---- persistence so a crash/restart mid-night resumes instead of forgetting ----
export function savePosition(mode: Mode, p: Position | null) {
  if (!p) return void db.prepare("DELETE FROM open_position").run();
  const json = JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v));
  db.prepare("INSERT OR REPLACE INTO open_position VALUES (1, ?, ?)").run(mode, json);
}

export function loadPosition(mode: Mode): Position | null {
  const row = db.prepare("SELECT mode, json FROM open_position WHERE id = 1").get() as { mode: string; json: string } | undefined;
  if (!row || row.mode !== mode) return null;
  return JSON.parse(row.json, (_k, v) => (v && typeof v === "object" && "$big" in v ? BigInt(v.$big) : v));
}

export interface SessionRow { id: number; started_at: number; start_balance: number; mode: string }
export const lastSession = () => db.prepare("SELECT * FROM sessions ORDER BY id DESC LIMIT 1").get() as SessionRow | undefined;
export function newSession(mode: Mode, startedAt: number, startBalance: number) {
  db.prepare("INSERT INTO sessions (started_at, start_balance, mode) VALUES (?,?,?)").run(startedAt, startBalance, mode);
}

/** Everything the dashboard needs to pick a session back up after a restart. */
export function sessionHistory(mode: Mode, since: number) {
  const trades = db.prepare("SELECT * FROM trades WHERE mode = ? AND closed_at >= ? ORDER BY closed_at").all(mode, since) as any[];
  const curve = db.prepare("SELECT ts, balance FROM equity WHERE mode = ? AND ts >= ? ORDER BY ts").all(mode, since) as { ts: number; balance: number }[];
  const rows = db.prepare("SELECT * FROM decisions WHERE mode = ? AND ts >= ? ORDER BY line").all(mode, since) as any[];
  const log: LogEntry[] = rows.map((r) => ({ line: r.line, ts: r.ts, kind: r.kind, ticker: r.ticker, detail: r.detail, reason: r.reason, pnlUsd: r.pnl_usd ?? undefined }));
  return { trades, curve, log };
}
