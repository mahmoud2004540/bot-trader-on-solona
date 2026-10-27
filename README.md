# Grok Bot Terminal

Six-agent Solana memecoin trader with a local live dashboard. Each agent has exactly one job:

```
SCANNER ──flag──▶ RUG CHECK ──pass──▶ SIZER ──size──▶ EXECUTOR ──fill──▶ LOGGER ──close──▶ EQUITY
 (yellow)          (red)               (purple)        (teal)             (orange)          (blue)
```

> ⚠️ **Real money.** By default this runs in **LIVE** mode and signs real Jupiter swaps with the
> wallet in `SOLANA_PRIVATE_KEY`. Memecoins can go to zero in seconds, and rug checks lower the
> risk but can't remove it. A position can also get stuck if exit liquidity disappears (the 2%
> slippage cap is never loosened). Use a **dedicated hot wallet** that holds only what you can
> afford to lose. Run `npm run demo` first to see how it behaves.

## Try it free first (Render free plan, paper mode)

No card, no wallet, no real money: the real bot on the real market with simulated fills.
On Render: **New → Blueprint** → this repo → branch `main` → **Blueprint Path: `render-free.yaml`** →
set `DASHBOARD_TOKEN` (a password) → Deploy. Then open `https://<address>/?token=<password>`.

Free instances have no disk and sleep after about 15 minutes with nobody on the site (it wakes up
when you open it again, starting a fresh paper session). Good for watching it work; for overnight
live trading use `render.yaml` below.

### جرّبه ببلاش الأول (بالعربي)
من غير كارت ومن غير فلوس، تداول وهمي على السوق الحقيقي:
Render ← New ← Blueprint ← الريبو ده ← Branch: `main` ← **Blueprint Path: `render-free.yaml`** ←
اكتب `DASHBOARD_TOKEN` (كلمة سر) ← Deploy. وبعدين افتح `https://العنوان/?token=كلمة-السر`.
النسخة المجانية بتنام بعد حوالي 15 دقيقة لو محدش فاتح الموقع، وبتصحى لما تفتحه تاني.

## Website on your phone (Render, one button)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mahmoud2004540/bot-trader-on-solona/tree/claude/grok-bot-terminal-solana-fbkj8n)

The bot runs 24/7 on a Render server, and the dashboard is a website you open on your phone with a
password. Everything is done from the phone's browser:

1. **Phantom:** Add / Connect Wallet → **Create New Account** named "Grok Bot" → Settings → Manage
   Accounts → Grok Bot → **Show Private Key** → copy it.
2. Tap the **Deploy to Render** button above → sign in to Render with GitHub.
3. Render shows the settings from `render.yaml` and asks for two values:
   - `DASHBOARD_TOKEN`: a long password of your choice (you'll use it to open the site);
   - `SOLANA_PRIVATE_KEY`: the key from step 1.

   Then **Apply / Deploy**.
4. When it's live, Render shows the address (`https://grok-bot-terminal-xxxx.onrender.com`). Open
   `https://<that address>/?token=<your password>` on the phone and bookmark it.
5. In Phantom, send USDC to Grok Bot plus about 0.05 SOL for fees.

`render.yaml` sets up exactly 1 instance (two copies never trade the same wallet), a 1 GB disk at
`/data` (open position, log and database survive restarts), a `/healthz` health check, and no
auto-redeploy on git pushes. Render needs a paid instance for a disk; check render.com/pricing. If the
deploy page picks the wrong branch, set it to `claude/grok-bot-terminal-solana-fbkj8n`.

### موقع على الموبايل بزرار واحد (Render)
1. في فانتوم اعمل حساب جديد اسمه Grok Bot ← Show Private Key ← انسخ المفتاح.
2. دوس زرار **Deploy to Render** اللي فوق ← سجّل دخول بـ GitHub.
3. هيطلب منك حاجتين: `DASHBOARD_TOKEN` (كلمة سر من عندك) و`SOLANA_PRIVATE_KEY` (المفتاح) ← Deploy.
4. لما يخلص هيديك عنوان. افتح `https://العنوان/?token=كلمة-السر` على الموبايل واعمله bookmark.
5. ابعت USDC لحساب Grok Bot و0.05 SOL للرسوم.

## Website on your phone (server on Railway)

The bot runs on a small cloud server 24/7, and its dashboard is a website you open on your phone
with a password. No computer needed; everything below is done in the phone's browser. The repo is
ready for Railway: `railway.json` runs `npm start` with exactly **1 replica** (two copies never trade
the same wallet) and always restarts.

1. Phantom → Add / Connect Wallet → **Create New Account** named "Grok Bot" → Settings → Manage
   Accounts → Grok Bot → **Show Private Key** → copy it.
2. **railway.com** → sign in with GitHub → **New Project → Deploy from GitHub repo** → this repo.
   Service **Settings → Source → Branch** → `claude/grok-bot-terminal-solana-fbkj8n`.
3. Add a **Volume** to the service, mount path `/data`. Live trading stays off without it, because
   the open position, log and database must survive restarts.
4. **Variables**:
   - `DASHBOARD_TOKEN` = a long password of your choice;
   - `SOLANA_PRIVATE_KEY` = the key from step 1;
   - optionally `SOLANA_RPC_URL` = a free Helius/QuickNode URL (the public RPC rate-limits shared server IPs).
5. **Settings → Networking → Generate Domain**, then open `https://<domain>/?token=<password>` on the
   phone and bookmark it.
6. In Phantom, send USDC to Grok Bot plus about 0.05 SOL for fees. You see every trade in Phantom too,
   and you withdraw from there.

On the server the website is public, so every visitor needs the token, including the server itself.
Without `DASHBOARD_TOKEN` it shows only a "locked" page. Railway is paid (about $5/month); check their
current pricing.

### موقع على الموبايل (بالعربي)
1. في فانتوم اعمل حساب جديد اسمه Grok Bot ← Show Private Key ← انسخ المفتاح.
2. **railway.com** ← سجّل دخول بـ GitHub ← New Project ← Deploy from GitHub repo ← الريبو ده.
   من Settings ← Source ← Branch اختار `claude/grok-bot-terminal-solana-fbkj8n`.
3. ضيف **Volume** والـ mount path يكون `/data`. من غيره مش هيشغّل LIVE.
4. في **Variables** ضيف `DASHBOARD_TOKEN` (كلمة سر طويلة) و`SOLANA_PRIVATE_KEY` (المفتاح).
5. Settings ← Networking ← **Generate Domain**، وافتح `https://الدومين/?token=كلمة-السر` واعمله bookmark.
6. ابعت USDC لحساب Grok Bot و0.05 SOL للرسوم.

## Quick start

```bash
npm install
cp .env.example .env        # set SOLANA_PRIVATE_KEY and ideally a paid SOLANA_RPC_URL
npm run night               # LIVE, overnight: auto-restarts and resumes → http://127.0.0.1:8787
npm start                   # LIVE, single run (resumes tonight's session if one exists)
npm start -- --new-session  # force a fresh START balance / counters
npm run demo                # synthetic market, paper only, no wallet / no network needed
npm run typecheck
```

Fund the wallet with **USDC** (the trading balance) plus about **0.05 SOL** for fees. Equity, sizing
and PnL are all in USDC. If no key is set, the bot starts in paper mode and says so in the header.

### Running overnight

`npm run night` is the way to run it while you sleep. It launches the bot and restarts it
with backoff (5 s → 60 s) if the bot process dies for any reason. Everything needed to carry on
is in SQLite, so a restart at 3am:

- **resumes the open position:** it is saved *before* the ENTER is logged; in live mode it is only
  restored if the tokens are still in the wallet;
- **keeps the session:** START balance and time, trades/wins/losses, the equity curve and the full
  log feed all carry over. A session resumes if it started less than 16 h ago in the same mode;
- **keeps the line numbers in `night.log`.**

Stray API errors are logged and skipped and do not stop the loop. Every decision is also printed,
coloured, to the terminal. While `npm run night` runs, it also keeps the computer from going to sleep.

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`, so nothing native to compile).

## Trading rules

| Agent | Rule |
|---|---|
| **Scanner** | Flag when (`spike ≥ 3x` vs. the previous 5 min **or** `vol ≥ 7x` with `500+ holders`) **and** `LP ≥ 85% locked`. Flags only, never trades. |
| **Rug check** | FILTERED (not traded) if: freeze authority on · mint authority not revoked · LP locked < 85% · dev wallet > 5% · sell simulation fails. Also rejects dangerous Token‑2022 extensions (transfer hook, permanent delegate, non‑transferable, frozen by default, fee > 1%) and a Jupiter round trip that loses > 10%. Any error or unknown value is a reject. |
| **Sizer** | `size% = 25% + 15% × strength`, where strength averages a spike score (3x→0 … 10x+→1) and a dev score (5%→0 … 0%→1). Based on current equity. One position at a time. |
| **Executor** | Jupiter swaps with a 2.0% slippage cap. Skips entries whose quoted price impact is above 2%. Stop‑loss −12%, take‑profit +36% (3R). Records entry, exit, and actual slippage (quoted vs. received). |
| **Logger** | Every decision goes to SQLite (`data/grok.db`) and `data/night.log`, numbered. Refuses to write a decision without a reason. |
| **Equity** | Re-reads the balance (on-chain USDC in live mode) on every close, extends the equity curve, and counts closes. |

**How the metrics are defined.**
`spikeX` = current 5 m volume ÷ the 5 m volume the scanner recorded about 5 min earlier. On a
token's first sighting, the earlier window is estimated as `(h1 − m5) / 11`.
`volX` = current 5 m volume ÷ the 6 h average per 5 m (`h6 / 72`).

**Honeypot test.** A true sell simulation needs a wallet that holds the token, so the rug check:
1. finds real holders (on-curve wallets with SOL for fees). The candidates come from
   `getTokenLargestAccounts`; the free public RPC blocks that call, so it falls back to
   rugcheck's top-holder list. Each holder's balance is re-read on-chain either way,
2. asks Jupiter to build a sell transaction for them,
3. runs it through `simulateTransaction` without signature verification.

If an existing holder can't sell, neither could we. Nothing in this test is signed or sent.

`night.log` looks like this:

```
#0031  03:12:44  ENTER     $TOKEN       31% · $24.63
       spike 4.2x · dev wallet 2%
#0032  03:41:07  EXIT      $TOKEN       +$19.45
       take-profit 3R
#0033  03:41:30  FILTERED  $OTHER       not traded
       freeze authority on
```

## Security model (protects the wallet; these are not trading limits)

- **The key comes only from the env var.** `security/wallet.ts` reads `SOLANA_PRIVATE_KEY` once and
  deletes it from `process.env`. The `Keypair` never leaves that module. Every string written to the
  log, SQLite, the console or the WebSocket passes through `redact()`. Only the public key is printed.
- **Funds only move through Jupiter swaps.** The only signing function is `signGuarded()`, and it calls
  `security/txGuard.ts` first, which:
  1. requires our wallet to be the fee payer;
  2. allows only ComputeBudget, Jupiter v6, ATA creation *for us*, a SOL wrap *into our own* wSOL
     account, and SyncNative or CloseAccount *refunding us*. Any System or Token transfer to another
     address is rejected;
  3. simulates the transaction and rejects it if SOL drops by more than 0.05 SOL, or USDC drops by
     more than the amount the executor declared for this swap (0 for sells).

  There is no transfer or withdraw code anywhere. These checks were run against a real Jupiter swap
  transaction (allowed), a USDC overspend (blocked) and a SOL transfer to a foreign address (blocked).
- **Token metadata is untrusted.** Names and symbols are reduced to short alphanumeric labels
  (`untrustedLabel`). Descriptions, websites and socials are never fetched or read. The dashboard
  inserts every data value with `textContent`, never `innerHTML`.
- **The dashboard binds to `127.0.0.1`.** To watch it from your phone on the same Wi-Fi, set
  `HOST=0.0.0.0` **and** `DASHBOARD_TOKEN=<a long password>`, then open
  `http://<pc-ip>:8787/?token=<password>`. The computer itself never needs the token; every other
  device does, because the live/paper toggle is on that page. The token guards the WebSocket, which
  carries all live data and the toggle; the static HTML/CSS/JS hold no data.

## Every file explained

| File | What it does |
|---|---|
| `package.json` | Scripts (`start`, `demo`, `typecheck`) and dependencies: `@solana/web3.js`, `ws`, `bs58`, `dotenv`; `tsx` runs TypeScript directly. |
| `render-free.yaml` | Free Render trial: free plan, paper mode only, no disk, no wallet; asks only for `DASHBOARD_TOKEN`. |
| `render.yaml` | One-click Render Blueprint: 1 instance, 1 GB disk at `/data`, `/healthz`, no auto-deploy; asks for `DASHBOARD_TOKEN` and `SOLANA_PRIVATE_KEY` on the deploy page. |
| `railway.json` / `.nvmrc` | Server deploy config for Railway (start command, exactly 1 replica, always restart) and the Node version (22). |
| `tsconfig.json` | Strict TypeScript, NodeNext modules, type-check only (`tsx` runs the code). |
| `.env.example` | Every setting, documented. Copy it to `.env`. |
| `.gitignore` | Keeps `.env`, `data/` (DB + log) and `node_modules` out of git. |
| **src/** | |
| `src/night.ts` | Overnight supervisor (`npm run night`): restarts the bot with backoff when it exits (the first launch starts a new session, restarts resume it), and keeps the computer awake (caffeinate / SetThreadExecutionState / systemd-inhibit). |
| `src/index.ts` | Entry point. Loads the wallet, falls back to paper if there's no key, warns on low SOL, reads the starting balance, and starts the dashboard and the agent loop. |
| `src/config.ts` | Every rule and threshold from the spec as constants (3x/7x/500/85%, 5% dev, 25–40%, 2% slippage, −12%/+36%), plus env settings. Detects a cloud server (`CLOUD`) and its volume. |
| `src/types.ts` | Shared data shapes: `PairSnapshot`, `Candidate`, `MintFacts`, `RugResult`, `Quote`, `Position`, `ClosedTrade`, `LogEntry`. |
| `src/util.ts` | Fetch with timeout, untrusted-label sanitising, money and percent formatting, bigint/UI unit conversion. |
| `src/state.ts` | The single in-memory dashboard state plus `update()`/`setAgent()`. Changes are batched into one WebSocket broadcast every 150 ms. |
| `src/orchestrator.ts` | The pipeline. `restorePosition()` picks a saved position back up at boot. While flat: scan → rug check → size → enter → log. While in a position: monitor every 4 s → exit → log → equity. Mode switches are refused while a position is open, and are queued and applied between scans, so a token checked in paper can never be bought live. |
| `src/server.ts` | HTTP server for `public/` (with path-traversal guard) and WebSocket `/ws`. It sends a state snapshot, the session log once (`history`), then one `log` message per decision, so the feed can hold the whole night. Also handles the `setMode` toggle and the optional `DASHBOARD_TOKEN` for other devices. |
| **src/agents/** | |
| `src/agents/scanner.ts` | **Scanner.** Computes spikeX/volX from snapshots, applies the flag rule and LP ≥ 85%, and outputs candidate cards. Never trades. |
| `src/agents/rugCheck.ts` | **Rug check.** Authorities, extensions, LP, dev wallet, holder sell simulation and round-trip tax check. Returns the exact failing reason. |
| `src/agents/sizer.ts` | **Sizer.** 25–40% of current equity, scaled by spike and dev-wallet strength. |
| `src/agents/executor.ts` | **Executor.** Buys and sells through Jupiter, measures actual slippage from balance deltas, and marks the position with a live sell quote. Stop −12% / TP 3R. If a swap's confirmation times out but the swap landed, it still tracks the position. |
| `src/agents/logger.ts` | **Logger.** SQLite tables `decisions`, `trades`, `equity`, `sessions`, `open_position` plus numbered `night.log` and coloured terminal output. Refuses reasonless entries. Also saves and loads the open position and session history used for crash recovery. |
| `src/agents/equity.ts` | **Equity.** Balance (on-chain USDC in live, ledger in paper), equity curve, closes / wins / losses. Starts the session, or resumes it after a restart. |
| **src/data/** | |
| `src/data/market.ts` | The `Market` interface agents use, and `liveMarket`, which wires the real sources together. |
| `src/data/dexscreener.ts` | New Solana tokens from DexScreener's latest profiles and boosts, plus per-pair m5/h1/h6 volume and liquidity. |
| `src/data/birdeye.ts` | Optional (`BIRDEYE_API_KEY`): new listings and holder counts. |
| `src/data/rugcheck.ts` | rugcheck.xyz report: LP lock %, creator address, holder count, top holders (fallback for the sell simulation). Cached for 60 s. Authorities are **not** taken from here. |
| `src/data/solana.ts` | RPC reads: mint authorities and Token-2022 extensions, token balances, real holder wallets for the honeypot test, and the mint's creator (the payer of its first transaction). The dev-wallet check uses whichever of rugcheck's creator and this on-chain creator holds more. |
| `src/data/jupiter.ts` | Quotes (2% slippage, response validated against the request, no platform fee), swap-transaction building (no fee account, no custom destination), and holder sell simulation. |
| `src/data/sim.ts` | Synthetic market for `npm run demo`: random tokens, some deliberately rugged, plus a random-walk price. Paper only; uses its own `data/demo/` so it never mixes with real sessions. |
| **src/security/** | |
| `src/security/wallet.ts` | The only holder of the private key. Exposes the public key, `redact()` and `signGuarded()`. |
| `src/security/txGuard.ts` | Pre-sign inspection: program allowlist, destination checks and simulated balance-delta limits. |
| **public/** | |
| `public/index.html` | Dashboard markup: window bar + toggle, header stats, agent sidebar, live flow graph, stat cards, trade card, log tail, result, log feed. |
| `public/styles.css` | Near-black theme, one neon colour per agent, monospace numbers, glow and animations, responsive breakpoints at 1200 px and 820 px (phone). |
| `public/app.js` | WebSocket client that renders each state snapshot, appends tail/feed rows incrementally (feed = every decision of the session, oldest first, newest highlighted), runs the uptime timer and the paper/live toggle (asks for confirmation before going live), and auto-reconnects. |

## Data written

- `data/night.log`: plain-text, numbered; what you read in the morning.
- `data/grok.db`: SQLite with `decisions` (every ENTER/EXIT/FILTERED), `trades` (entry/exit/slippage/PnL/reasons) and `equity`.
