// Telegram remote control: alerts on every entry/exit and commands from your phone.
// Telegram is only the remote control; trading still runs wherever this process runs.
//
// Safety:
//  - Only ONE Telegram account controls the bot: the one that sends `/start <code>`, where
//    <code> is shown on the dashboard. Every other chat is ignored silently.
//  - The wallet key is never accepted here. A message that looks like a private key is
//    deleted at once and you're told to use the dashboard instead.
//  - Messages are sent as plain text (no Markdown/HTML), so token names can't inject links
//    or formatting. Nothing a token or a message says is ever executed; only the fixed
//    commands below exist.
//  - The bot token is registered with redact() and never appears in logs or errors.
import { randomInt } from "node:crypto";
import { CONFIG } from "./config.js";
import { bus, state, update } from "./state.js";
import { getSetting, setSetting } from "./agents/logger.js";
import { registerSecret, walletPublicKey } from "./security/wallet.js";
import { setMode, setPaused } from "./orchestrator.js";
import { signedUsd, sleep, usd } from "./util.js";
import type { ClosedTrade, LogEntry } from "./types.js";

let token = "";
let owner: number | null = null;
let liveConfirmUntil = 0;
let started = false;

const HELP = [
  "Grok Bot Terminal",
  "/status – mode, balance, open position",
  "/report – tonight: start vs now, wins/losses",
  "/log – last 10 decisions",
  "/pause – no new trades (open position still managed)",
  "/resume – trade again",
  "/paper – switch to paper",
  "/live – switch to live (asks to confirm)",
  "/filtered on|off – also alert on rejected tokens",
].join("\n");

async function api<T = any>(method: string, body: object, timeoutMs = 15_000): Promise<T> {
  // Own tiny client: generic errors only, because the URL contains the bot token.
  let res: Response;
  try {
    res = await fetch(`${CONFIG.telegramApi}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`telegram ${method}: network error`);
  }
  const j = (await res.json().catch(() => null)) as { ok: boolean; result: T; description?: string } | null;
  if (!j?.ok) throw new Error(`telegram ${method}: ${res.status}`);
  return j.result;
}

// One message at a time, ~1/s, so a busy night never hits Telegram's rate limit.
let queue = Promise.resolve();
function send(text: string, chatId = owner) {
  if (!chatId || !token) return;
  queue = queue.then(async () => {
    await api("sendMessage", { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }).catch(() => {});
    await sleep(1_000);
  });
}

const looksLikeKey = (t: string) =>
  /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(t.trim()) || /^\[\s*\d{1,3}(\s*,\s*\d{1,3}){63}\s*\]$/.test(t.trim());

const hhmm = (ts: number) => new Date(ts).toTimeString().slice(0, 5);

function statusText() {
  const p = state.position;
  const lines = [
    `${state.mode === "live" ? "🔴 LIVE" : "📝 paper"}${state.paused ? " · ⏸ paused" : ""} · running since ${hhmm(state.startedAt)}`,
    `balance ${usd(state.balance)} · trades ${state.trades} (${state.wins}W / ${state.losses}L)`,
  ];
  if (state.funding && state.mode === "live") lines.push(`wallet ◎${state.funding.sol.toFixed(3)} SOL · ${usd(state.funding.usdc)} USDC`);
  if (p) {
    const pnl = p.markUsd - p.costUsd;
    lines.push(`open: ${p.ticker} ${usd(p.costUsd)} in · now ${signedUsd(pnl)} (${((p.markUsd / p.costUsd - 1) * 100).toFixed(1)}%)`);
  } else lines.push("no open position");
  if (state.notice) lines.push(state.notice);
  return lines.join("\n");
}

function reportText() {
  const d = state.startBalance ? (state.balance / state.startBalance - 1) * 100 : 0;
  return [
    `🌙 ${hhmm(state.startedAt)} → ${hhmm(Date.now())}`,
    `START ${usd(state.startBalance)}  →  NOW ${usd(state.balance)} (${d >= 0 ? "+" : ""}${d.toFixed(1)}%)`,
    `${state.wins}W / ${state.losses}L · ${state.filtered} filtered · ${state.sessionLines} log lines`,
  ].join("\n");
}

function entryText(e: LogEntry) {
  if (e.kind === "ENTER") return `🟢 ENTER ${e.ticker}\nsize ${e.detail}\nreason: ${e.reason}\nline #${e.line} · ${hhmm(e.ts)}`;
  if (e.kind === "FILTERED") return `🚫 FILTERED ${e.ticker} · not traded\nreason: ${e.reason}`;
  if (e.kind === "INFO") return `ℹ️ ${e.detail}\n${e.reason}`;
  return `${e.kind} ${e.ticker} ${e.detail}\n${e.reason}`;
}

function exitText(t: ClosedTrade) {
  const win = t.pnlUsd >= 0;
  return [
    `${win ? "✅" : "🔻"} EXIT ${t.ticker} ${signedUsd(t.pnlUsd)} (${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%)`,
    `reason: ${t.exitReason}`,
    `in: ${t.entryReason}`,
    `slip ${t.entrySlipPct.toFixed(2)}% / ${t.exitSlipPct.toFixed(2)}%`,
    `balance ${usd(state.balance)} · ${state.wins}W / ${state.losses}L`,
  ].join("\n");
}

async function handle(msg: any) {
  const chatId: number | undefined = msg?.chat?.id;
  const text: string = typeof msg?.text === "string" ? msg.text.trim() : "";
  if (!chatId || msg.chat.type !== "private" || !text) return;

  // Never let a private key sit in a Telegram chat, whoever sent it.
  if (looksLikeKey(text)) {
    await api("deleteMessage", { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
    send("⚠️ That looked like a private key, so I deleted it. Never send keys here: paste it only in the dashboard on the device running the bot.", chatId);
    return;
  }

  if (owner === null) {
    const code = state.telegram.code;
    if (code && text === `/start ${code}`) {
      owner = chatId;
      setSetting("telegram_owner", String(chatId));
      update((s) => (s.telegram = { ...s.telegram, paired: true, code: null }));
      send(`✅ Paired. Only this Telegram account controls the bot now.\n\n${HELP}\n\n${statusText()}`);
    } else send("Send /start followed by the 6-digit code shown on your Grok Bot dashboard.", chatId);
    return;
  }
  if (chatId !== owner) return; // strangers get nothing, not even an error

  const [cmd, arg] = text.toLowerCase().split(/\s+/);
  switch (cmd.replace(/@\w+$/, "")) {
    case "/start":
    case "/help":
      return send(HELP);
    case "/status":
      return send(statusText());
    case "/report":
      return send(reportText());
    case "/log": {
      const last = state.log.slice(-10);
      return send(last.length ? last.map((e) => `#${e.line} ${hhmm(e.ts)} ${e.kind} ${e.ticker} ${e.detail}\n   ${e.reason}`).join("\n") : "no decisions yet");
    }
    case "/pause":
      setPaused(true);
      return send("⏸ Paused. No new trades. An open position is still watched and closed at its stop or target.");
    case "/resume":
      setPaused(false);
      return send("▶️ Resumed. Scanning for new trades.");
    case "/paper": {
      const err = setMode("paper");
      return send(err ? `can't: ${err}` : "📝 Switching to paper (simulated fills).");
    }
    case "/live": {
      if (!walletPublicKey()) return send("No wallet connected yet. Connect Phantom on the dashboard first.");
      if (arg === "yes" && Date.now() < liveConfirmUntil) {
        liveConfirmUntil = 0;
        const err = setMode("live");
        return send(err ? `can't: ${err}` : "🔴 Switching to LIVE. Real funds from the Grok Bot wallet.");
      }
      liveConfirmUntil = Date.now() + 60_000;
      return send("This trades REAL money. Send /live yes within 60 seconds to confirm.");
    }
    case "/filtered":
      setSetting("telegram_filtered", arg === "on" ? "1" : null);
      return send(arg === "on" ? "You'll also get rejected tokens." : "Only entries, exits and warnings now.");
    default:
      return send(HELP);
  }
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await api<any[]>("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] }, 65_000);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handle(u.message).catch(() => {});
      }
    } catch {
      await sleep(5_000); // offline or Telegram hiccup: keep trying all night
    }
  }
}

/** Start the Telegram bot. Returns the bot's @username, or throws if the token is wrong. */
export async function startTelegram(botToken: string): Promise<string> {
  if (started) throw new Error("telegram already running");
  token = botToken.trim();
  registerSecret(token);
  const me = await api<{ username: string }>("getMe", {});
  started = true;
  const saved = getSetting("telegram_owner");
  owner = saved ? Number(saved) : null;
  update((s) => (s.telegram = { enabled: true, paired: owner !== null, bot: me.username, code: owner === null ? String(randomInt(100000, 1000000)) : null }));

  bus.on("log", (e: LogEntry) => {
    if (e.kind === "EXIT") return; // sent from "closed" with the new balance
    if (e.kind === "FILTERED" && !getSetting("telegram_filtered")) return;
    send(entryText(e));
  });
  bus.on("closed", (t: ClosedTrade) => send(exitText(t)));
  bus.on("alert", (text: string) => send(text));
  void poll();
  if (owner !== null) send(`🤖 Grok Bot started\n${statusText()}`);
  return me.username;
}

export const isValidBotToken = (t: string) => /^\d{5,15}:[A-Za-z0-9_-]{30,50}$/.test(t.trim());
