// Grok Bot Terminal dashboard. Renders the server's state snapshot pushed over WebSocket.
// Every value that may come from a token creator (tickers, reasons) is inserted with
// textContent — never innerHTML — so token names can't inject markup or script.
"use strict";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const usd = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);
const sUsd = (n) => (n >= 0 ? "+$" : "-$") + Math.abs(n).toFixed(2);
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
const hhmmss = (t) => new Date(t).toTimeString().slice(0, 8);
const price = (p) => (!p ? "—" : p >= 1 ? "$" + p.toFixed(4) : "$" + p.toPrecision(4));

const ICONS = {
  scanner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v3l2 2"/></svg>',
  rug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  sizer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></svg>',
  executor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  logger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/></svg>',
  equity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M4 16l5-5 4 3 7-8"/></svg>',
  you: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

const AGENTS = [
  ["scanner", "SCANNER", "watches new pairs + volume spikes", "flags only, never trades"],
  ["rug", "RUG CHECK", "freeze · mint · LP · dev wallet · honeypot", "nothing executes before a pass"],
  ["sizer", "SIZER", "25–40% of equity by signal strength", "never trades a fixed ticket"],
  ["executor", "EXECUTOR", "Jupiter in/out · stop −12% · target 3R", "slippage cap 2.0%"],
  ["logger", "LOGGER", "SQLite + night.log, numbered lines", "no trade without a reason"],
  ["equity", "EQUITY", "balance + equity curve", "updates on every close"],
];

// ---------- build static agent cards once ----------
const agentEls = {};
for (const [id, name, desc, rule] of [...AGENTS, ["you", "YOU", "reads the log in the morning", "stopped asking, started reading"]]) {
  const card = el("div", `agent a-${id}`);
  const top = el("div", "a-top");
  const ico = el("div", "a-ico");
  ico.innerHTML = ICONS[id]; // constant markup, not data
  const badge = el("span", "a-badge", id === "you" ? "READING" : "…");
  top.append(ico, el("span", "a-name", name), badge);
  const last = el("div", "a-last", "—");
  card.append(top, el("div", "a-desc", desc), el("div", "a-rule", rule), last);
  $("agentList").append(card);
  agentEls[id] = { card, badge, last };
}

let S = null;
let lastEvent = "";
const seenCands = new Set();

// ---------- render ----------
function render() {
  if (!S) return;
  // header
  $("sBalance").textContent = usd(S.balance);
  $("sTrades").textContent = S.trades;
  $("sWins").textContent = S.wins;
  $("sLosses").textContent = S.losses;
  if (S.lastEvent !== lastEvent) {
    lastEvent = S.lastEvent;
    const b = $("lastEvent");
    b.textContent = S.lastEvent;
    b.classList.remove("flash");
    void b.offsetWidth;
    b.classList.add("flash");
  }
  const t = $("modeToggle");
  t.className = "pill " + S.mode;
  $("paperState").textContent = S.mode === "paper" ? "on" : "off";
  t.querySelector(".seg-live").lastChild.textContent = S.mode === "live" ? "live" : "live off";
  renderWallet();
  renderTelegram();
  const n = $("notice");
  n.textContent = S.notice ? "· " + S.notice : "";
  n.className = "notice" + (S.mode === "live" ? " live" : "");

  // agents
  for (const [id] of AGENTS) {
    const a = S.agents[id], e = agentEls[id];
    e.badge.textContent = a.status;
    e.last.textContent = a.last;
    e.card.classList.toggle("active", S.activeAgent === id);
  }
  agentEls.you.last.textContent = `${S.sessionLines} line${S.sessionLines === 1 ? "" : "s"} to read`;

  renderCandidates();
  renderGraph();
  renderMini();

  // stat cards
  $("checked").textContent = S.checked;
  $("stFiltered").textContent = S.filtered;
  $("stSkipped").textContent = `${S.skipped} skipped`;
  $("stSizer").textContent = S.sizer.pct == null ? "—" : `${S.sizer.pct.toFixed(0)}% eq`;
  $("stSizerS").textContent = S.sizer.status;
  $("stLogger").textContent = `line #${S.loggerLine}`;
  const lc = S.lastClose;
  $("stEquity").textContent = lc ? sUsd(lc.pnlUsd) : "$0.00";
  $("stEquity").className = "stat-v mono " + (lc ? (lc.pnlUsd >= 0 ? "green" : "red") : "");

  renderTrade();
  renderResult();
}

let setupDismissed = false;
let justConnected = false; // keep the card open after connecting so step 4 (fund it) is seen
function renderWallet() {
  $("stepsLocal").classList.toggle("hidden", !!S.cloud);
  $("stepsCloud").classList.toggle("hidden", !S.cloud);
  $("setup").classList.toggle("hidden", !((S.needsSetup && !setupDismissed) || justConnected));
  $("openSetup").classList.toggle("hidden", !S.needsSetup || !setupDismissed);
  $("walletBar").classList.toggle("hidden", !S.wallet);
  if (!S.wallet) return;
  if (!$("wbAddr").classList.contains("copied")) $("wbAddr").textContent = S.wallet.slice(0, 4) + "…" + S.wallet.slice(-4);
  const f = S.funding;
  $("wbBal").textContent = f ? `◎${f.sol.toFixed(3)} · ${usd(f.usdc)} USDC` : "";
  $("wbWarn").classList.toggle("hidden", !f || f.usdc >= 5 || S.mode !== "live");
}

function renderTelegram() {
  const tg = S.telegram;
  $("tgStepPaste").classList.toggle("hidden", !!S.cloud);
  $("tgStepCloud").classList.toggle("hidden", !S.cloud);
  $("tgOpen").classList.toggle("hidden", tg.enabled);
  const pair = $("tgPair");
  pair.classList.toggle("hidden", !(tg.enabled && !tg.paired && tg.code && tg.bot));
  if (tg.enabled && !tg.paired && tg.bot && tg.code) {
    pair.href = `https://t.me/${encodeURIComponent(tg.bot)}?start=${encodeURIComponent(tg.code)}`;
    pair.textContent = `tap to pair @${tg.bot} →`;
  }
  $("tgBadge").textContent = !tg.enabled ? "OFF" : tg.paired ? "ON" : "PAIR";
  $("tgLast").textContent = !tg.enabled ? "off" : tg.paired ? `@${tg.bot} · alerts on` : `or send: /start ${tg.code}`;
  $("tgCard").classList.toggle("active", tg.enabled && !tg.paired);
}

function renderCandidates() {
  const box = $("candidates");
  box.replaceChildren();
  if (!S.candidates.length) return box.append(el("div", "cand-empty", "scanning… no flags yet"));
  for (const c of S.candidates) {
    const card = el("div", `cand ${c.status}` + (seenCands.has(c.mint) ? "" : " new"));
    seenCands.add(c.mint);
    const head = el("div", "cand-t");
    head.append(el("span", "sd"), el("span", "", c.ticker));
    const kv = el("div", "cand-kv");
    const row = (k, v) => kv.append(el("span", "", k), el("b", "", v));
    row("LP", `${c.lpLockedPct.toFixed(0)}%`);
    row("spike", `${c.spikeX.toFixed(1)}x`);
    row("vol", `${c.volX.toFixed(1)}x`);
    row("holders", c.holders == null ? "—" : String(c.holders));
    card.append(head, kv);
    if (c.reason && c.status === "filtered") card.title = c.reason;
    box.append(card);
  }
}

function renderGraph() {
  const f = S.flow, pos = S.position;
  const ticker = pos ? pos.ticker : f.ticker;
  $("gTicker").textContent = ticker.length > 10 ? ticker.slice(0, 10) + "…" : ticker;
  let stage = f.stage;
  if (pos) {
    const pnl = (pos.markUsd / pos.costUsd - 1) * 100;
    $("gStage").textContent = `long ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`;
    stage = "exec";
  } else {
    $("gStage").textContent = f.filteredReason ? "filtered" : f.stage;
  }
  const filtered = !pos && !!f.filteredReason;
  $("nodeRug").classList.toggle("on", stage === "check" || stage === "size" || stage === "exec");
  $("nodeExec").classList.toggle("on", stage === "exec");
  $("nodeExec").classList.toggle("dim", filtered);
  $("link1").setAttribute("class", "link" + (filtered ? " bad" : stage !== "idle" ? " hot" : ""));
  $("link2").setAttribute("class", "link" + (!filtered && (stage === "size" || stage === "exec") ? " hot" : ""));
  $("stamp").classList.toggle("hidden", !filtered);
  if (filtered) $("stampReason").textContent = `${f.ticker} · ${f.filteredReason}`;
}

function renderMini() {
  const pts = S.equityCurve;
  const W = 600, H = 90, pad = 8;
  if (!pts.length) return;
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x = (i) => (pts.length === 1 ? W : (i / (pts.length - 1)) * W);
  const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const flat = pts.length === 1 ? `M0 ${y(vs[0])} L${W} ${y(vs[0])}` : d;
  $("eqLine").setAttribute("d", flat);
  $("eqArea").setAttribute("d", `${flat} L${W} ${H} L0 ${H} Z`);
  $("eqDot").setAttribute("cx", W - 4);
  $("eqDot").setAttribute("cy", y(vs[vs.length - 1]));
  const lc = S.lastClose, lab = $("miniLabel");
  if (lc) {
    lab.textContent = `last close ${lc.ticker} ${lc.pnlPct >= 0 ? "+" : ""}${lc.pnlPct.toFixed(1)}%`;
    lab.className = "mono " + (lc.pnlPct >= 0 ? "up" : "down");
  } else {
    lab.textContent = `${usd(vs[vs.length - 1])} · no closes yet`;
    lab.className = "mono";
  }
}

function renderTrade() {
  const open = S.position, t = open || S.lastTrade;
  const badge = $("tBadge");
  if (!t) return;
  badge.textContent = open ? "OPEN" : "CLOSED";
  badge.className = "badge " + (open ? "open" : "closed");
  $("tTicker").textContent = t.ticker;
  const pnl = open ? t.markUsd - t.costUsd : t.pnlUsd;
  const pnlPct = open ? (t.markUsd / t.costUsd - 1) * 100 : t.pnlPct;
  $("tPnl").textContent = `${sUsd(pnl)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`;
  $("tPnl").className = "t-pnl mono " + (pnl >= 0 ? "green" : "red");
  $("tEntry").textContent = price(t.entryPrice);
  $("tExit").textContent = open ? "open" : price(t.exitPrice);
  $("tSlip").textContent = open ? `${t.entrySlipPct.toFixed(2)}%` : `${t.entrySlipPct.toFixed(2)}% / ${t.exitSlipPct.toFixed(2)}%`;
  $("tSize").textContent = `${t.sizePctOfEquity.toFixed(0)}% · ${usd(t.costUsd)}`;
  $("tReason").textContent = open ? `in: ${t.entryReason}` : `in: ${t.entryReason}\nout: ${t.exitReason}`;
  $("tReason").style.whiteSpace = "pre-line";
}

// ---------- log: tail + feed are append-only so a full night stays fast ----------
const TAIL_MAX = 400; // the tail is a live window; the feed below keeps the whole session
let logCount = 0;

function tailLine(e) {
  const win = e.kind === "EXIT" && (e.pnlUsd ?? 0) >= 0;
  const ln = el("div", `tl ${e.kind}${e.kind === "EXIT" ? (win ? " win" : " loss") : ""}`);
  ln.append(
    el("span", "ln", `#${String(e.line).padStart(4, "0")} `),
    el("span", "tm", `${hhmmss(e.ts)} `),
    el("span", "kd", e.kind.padEnd(9)),
    el("span", "", e.ticker.padEnd(11) + " "),
    el("span", "dt", e.detail),
  );
  const wrap = el("div");
  wrap.append(ln, el("div", "tl-r", e.reason));
  return wrap;
}

function feedRow(e) {
  const win = (e.pnlUsd ?? 0) >= 0;
  const r = el("div", `fr k-${e.kind}${e.kind === "EXIT" ? (win ? " win" : " loss") : ""}`);
  const main = el("div", "fr-main");
  main.append(el("div", "fr-tk", e.ticker), el("div", "fr-rs", e.reason));
  let right;
  if (e.kind === "EXIT") right = el("div", "fr-right " + (win ? "green" : "red"), e.detail);
  else if (e.kind === "FILTERED") right = el("div", "fr-right nt", "not traded");
  else right = el("div", "fr-right", e.detail);
  r.append(el("div", "fr-time", hhmm(e.ts)), el("div", "fr-badge", e.kind), main, right);
  return r;
}

const nearBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 40;

function appendLog(entries, reset) {
  const tail = $("tail"), feed = $("feed");
  const stickTail = reset || nearBottom(tail), stickFeed = reset || nearBottom(feed);
  if (reset) {
    tail.replaceChildren();
    feed.replaceChildren();
    logCount = 0;
  }
  $("tailCursor")?.remove();
  feed.querySelector(".feed-empty")?.remove();
  feed.querySelector(".newest")?.classList.remove("newest");
  const tf = document.createDocumentFragment(), ff = document.createDocumentFragment();
  for (const e of entries) { tf.append(tailLine(e)); ff.append(feedRow(e)); }
  tail.append(tf);
  feed.append(ff);
  logCount += entries.length;
  while (tail.childElementCount > TAIL_MAX) tail.firstElementChild.remove();
  const cur = el("div");
  cur.id = "tailCursor";
  cur.append(el("span", "cursor"));
  tail.append(cur);
  if (logCount) feed.lastElementChild.classList.add("newest");
  else feed.append(el("div", "feed-empty", "no decisions yet — every one will land here, in order, with its reason"));
  $("feedCount").textContent = `${logCount} in order · oldest first`;
  $("tailCount").textContent = `${logCount} line${logCount === 1 ? "" : "s"}`;
  if (stickTail) tail.scrollTop = tail.scrollHeight;
  if (stickFeed) feed.scrollTop = feed.scrollHeight;
}

function renderResult() {
  $("range").textContent = `${hhmm(S.startedAt)} → ${hhmm(Date.now())}`;
  const max = Math.max(S.startBalance, S.balance, 0.01);
  $("barStart").style.width = `${(S.startBalance / max) * 100}%`;
  $("barNow").style.width = `${(S.balance / max) * 100}%`;
  $("barNow").parentElement.classList.toggle("down", S.balance < S.startBalance);
  $("resStart").textContent = usd(S.startBalance);
  $("resNow").textContent = usd(S.balance);
  $("resWL").textContent = `${S.wins}W / ${S.losses}L`;
  const d = S.startBalance ? (S.balance / S.startBalance - 1) * 100 : 0;
  $("resDelta").textContent = `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
  $("resDelta").className = d >= 0 ? "green" : "red";
}

// ---------- uptime ----------
setInterval(() => {
  if (!S) return;
  const s = Math.max(0, Math.floor((Date.now() - S.startedAt) / 1000));
  $("uptime").textContent = [s / 3600, (s / 60) % 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, "0")).join(":");
}, 1000);

// ---------- websocket ----------
let ws;
function connect() {
  const token = new URLSearchParams(location.search).get("token");
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${token ? "?token=" + encodeURIComponent(token) : ""}`);
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === "state") { S = msg.state; render(); }
    if (msg.type === "history") appendLog(msg.entries, true);
    if (msg.type === "log") appendLog([msg.entry], false);
    if (msg.type === "notice") { $("notice").textContent = "· " + msg.text; }
  };
  ws.onclose = (ev) => {
    if (ev.code === 4001) {
      $("lastEvent").textContent = "LOCKED · OPEN WITH ?token=YOUR-PASSWORD";
      $("notice").textContent = "· wrong or missing password in the address";
      return; // retrying won't help until the address has the right token
    }
    $("lastEvent").textContent = "DISCONNECTED · RETRYING";
    setTimeout(connect, 2000);
  };
}
connect();

// ---------- setup + wallet ----------
$("setupLater").addEventListener("click", () => { setupDismissed = true; justConnected = false; renderWallet(); });
$("openSetup").addEventListener("click", () => { setupDismissed = false; renderWallet(); });
$("wbAddr").addEventListener("click", async () => {
  if (!S?.wallet) return;
  try { await navigator.clipboard.writeText(S.wallet); } catch { return; }
  const b = $("wbAddr");
  b.textContent = "copied ✓";
  b.classList.add("copied");
  setTimeout(() => { b.classList.remove("copied"); renderWallet(); }, 1200);
});
$("setupForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("setupKey"), msg = $("setupMsg"), go = $("setupGo");
  if (!input.value.trim()) return;
  go.disabled = true;
  msg.className = "setup-msg";
  msg.textContent = "connecting…";
  try {
    const r = await fetch("/api/setup" + location.search, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: input.value }) });
    const j = await r.json();
    input.value = ""; // never keep the key in the page
    if (!r.ok) throw new Error(j.error || "setup failed");
    justConnected = true;
    $("setupLater").textContent = "done · close";
    $("setupForm").classList.add("hidden");
    msg.className = "setup-msg ok";
    msg.textContent = `connected ✓ ${j.address.slice(0, 4)}…${j.address.slice(-4)} · now send USDC or SOL to it (step 4)`;
  } catch (e) {
    msg.className = "setup-msg err";
    msg.textContent = e.message;
  } finally {
    go.disabled = false;
  }
});

$("tgOpen").addEventListener("click", () => $("tgSetup").classList.remove("hidden"));
$("tgLater").addEventListener("click", () => $("tgSetup").classList.add("hidden"));
$("tgForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("tgToken"), msg = $("tgMsg"), go = $("tgGo");
  if (!input.value.trim()) return;
  go.disabled = true;
  msg.className = "setup-msg";
  msg.textContent = "checking with Telegram…";
  try {
    const r = await fetch("/api/telegram" + location.search, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: input.value }) });
    const j = await r.json();
    input.value = "";
    if (!r.ok) throw new Error(j.error || "failed");
    msg.className = "setup-msg ok";
    msg.textContent = `connected ✓ @${j.bot} · now tap "tap to pair" on the Telegram card`;
    $("tgForm").classList.add("hidden");
  } catch (e) {
    msg.className = "setup-msg err";
    msg.textContent = e.message;
  } finally {
    go.disabled = false;
  }
});

$("modeToggle").addEventListener("click", () => {
  if (!S || !ws || ws.readyState !== 1) return;
  if (S.needsSetup && S.mode === "paper") { setupDismissed = false; return renderWallet(); }
  const next = S.mode === "live" ? "paper" : "live";
  if (next === "live" && !confirm("Switch to LIVE? The bot will trade real funds from this wallet.")) return;
  ws.send(JSON.stringify({ type: "setMode", mode: next }));
});
