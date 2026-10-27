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

## Zero-setup start (with Phantom)

1. Install **Node.js 22+** from nodejs.org (once).
2. Double-click **`Start Grok Bot.command`** (Mac) or **`Start Grok Bot.bat`** (Windows); on Linux run `./start.sh`.
   It installs everything the first time, opens the dashboard and keeps running all night (auto-restart, computer kept awake).
3. The dashboard shows a **Connect Phantom** card:
   - in Phantom create a new account called **Grok Bot**,
   - Settings → Manage Accounts → Grok Bot → **Show Private Key**, then copy it and paste it into the card,
   - from your main Phantom account send **USDC or SOL** to Grok Bot, keeping at least 0.05 SOL in it for fees.

That's it. The bot switches to LIVE by itself, waits until the money arrives, converts extra SOL to
USDC, and starts trading. Every later start goes straight to live with no questions. You see the bot's
balance in Phantom, and you **withdraw from Phantom** whenever you want; the bot itself never sends
money anywhere.

> Why not sign with Phantom directly? Phantom shows an approval pop-up for every transaction, so it
> can't trade while you sleep. A separate Phantom account gives the bot its own key and keeps your
> main wallet out of reach.

### تشغيل سريع (بالعربي)

1. نزّل **Node.js 22** أو أحدث من nodejs.org (مرة واحدة بس).
2. دوس مرتين على **`Start Grok Bot.command`** (ماك) أو **`Start Grok Bot.bat`** (ويندوز).
   هيسطّب كل حاجة أول مرة، ويفتح الداشبورد، ويفضل شغال طول الليل.
3. في الداشبورد هتلاقي كارت **Connect Phantom**:
   - في فانتوم اعمل حساب جديد اسمه **Grok Bot**،
   - Settings ← Manage Accounts ← Grok Bot ← **Show Private Key**، انسخه والصقه في الكارت،
   - من حسابك الأساسي في فانتوم ابعت **USDC أو SOL** لحساب Grok Bot، وخلّي فيه 0.05 SOL على الأقل للرسوم.

خلاص كده. البوت بيتحول لـ LIVE لوحده، وبيستنى لحد ما الفلوس توصل، وبعدين يبدأ يتداول. تقدر تشوف
الرصيد وتسحب من فانتوم في أي وقت، والبوت نفسه عمره ما بيبعت فلوس لأي حد.
**استخدم فلوس تقدر تستغنى عنها بس.**

## Quick start (manual)

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
coloured, to the terminal. Keep the machine from sleeping (macOS: `caffeinate -i npm run night`).

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
- **One-time wallet setup from the dashboard** (`POST /api/setup`) works only from this computer
  (loopback address and a localhost Host header, so DNS rebinding can't reach it). It is same-origin
  and JSON-only, so other websites can't trigger it. It only works while no wallet is connected, so a
  connected key can't be replaced. The pasted key is written to `.env` (mode 600) as
  `SOLANA_PRIVATE_KEY`, the same env var the bot reads on every start. It is never sent back, logged or
  stored anywhere else, and the page clears the field immediately.
- **Deposited SOL is converted with a normal Jupiter swap** inside the bot's own wallet. The guard is
  told the exact SOL amount for that one swap; an undeclared or reused amount is blocked.
- **Token metadata is untrusted.** Names and symbols are reduced to short alphanumeric labels
  (`untrustedLabel`). Descriptions, websites and socials are never fetched or read. The dashboard
  inserts every data value with `textContent`, never `innerHTML`.
- **The dashboard binds to `127.0.0.1`.** To watch it from your phone on the home Wi-Fi, add
  `HOST=0.0.0.0` **and** `DASHBOARD_TOKEN=<a long password>` to `.env`, then open
  `http://<pc-ip>:8787/?token=<password>` on the phone. The computer itself never needs the token;
  every other device does, because the live/paper toggle is on that page. Wallet setup stays
  computer-only.

## Every file explained

| File | What it does |
|---|---|
| `package.json` | Scripts (`start`, `demo`, `typecheck`) and dependencies: `@solana/web3.js`, `ws`, `bs58`, `dotenv`; `tsx` runs TypeScript directly. |
| `tsconfig.json` | Strict TypeScript, NodeNext modules, type-check only (`tsx` runs the code). |
| `.env.example` | Every setting, documented. Copy it to `.env`. |
| `.gitignore` | Keeps `.env`, `data/` (DB + log) and `node_modules` out of git. |
| **src/** | |
| `src/night.ts` | Overnight supervisor (`npm run night`): restarts the bot with backoff when it exits (the first launch starts a new session, restarts resume it), and keeps the computer from sleeping (caffeinate / SetThreadExecutionState / systemd-inhibit). |
| `src/funding.ts` | Wallet watcher (live only). Shows SOL/USDC on the dashboard, holds trading quietly until there is at least $5 USDC, converts deposited SOL to USDC (keeping 0.05 SOL for fees), and moves START to the deposited amount before the first trade. |
| `Start Grok Bot.command` / `Start Grok Bot.bat` / `start.sh` | Double-click launchers (Mac / Windows / Linux). They check Node, run `npm install` the first time, open the dashboard and run `npm run night`. |
| `.gitattributes` | Keeps Windows line endings for the `.bat` and Unix line endings for the shell launchers. |
| `src/index.ts` | Entry point. Loads the wallet, falls back to paper if there's no key, warns on low SOL, reads the starting balance, and starts the dashboard and the agent loop. |
| `src/config.ts` | Every rule and threshold from the spec as constants (3x/7x/500/85%, 5% dev, 25–40%, 2% slippage, −12%/+36%), plus env settings. |
| `src/types.ts` | Shared data shapes: `PairSnapshot`, `Candidate`, `MintFacts`, `RugResult`, `Quote`, `Position`, `ClosedTrade`, `LogEntry`. |
| `src/util.ts` | Fetch with timeout, untrusted-label sanitising, money and percent formatting, bigint/UI unit conversion. |
| `src/state.ts` | The single in-memory dashboard state plus `update()`/`setAgent()`. Changes are batched into one WebSocket broadcast every 150 ms. |
| `src/orchestrator.ts` | The pipeline. Mode changes are queued and applied between scans, so a token checked in paper can never be bought live. `restorePosition()` picks a saved position back up at boot. While flat: scan → rug check → size → enter → log. While in a position: monitor every 4 s → exit → log → equity. Also handles the mode switch (refused while a position is open or a swap is in flight). |
| `src/server.ts` | HTTP server for `public/` (with path-traversal guard), the locked-down `/api/setup` wallet connection, and WebSocket `/ws`. It sends a state snapshot, the session log once (`history`), then one `log` message per decision, so the feed can hold the whole night. Also handles the `setMode` toggle and the optional token check. |
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
