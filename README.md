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

## Quick start

```bash
npm install
cp .env.example .env        # set SOLANA_PRIVATE_KEY and ideally a paid SOLANA_RPC_URL
npm start                   # LIVE: http://127.0.0.1:8787
npm run demo                # synthetic market, paper only, no wallet / no network needed
npm run typecheck
```

Fund the wallet with **USDC** (the trading balance) plus about **0.05 SOL** for fees. Equity, sizing
and PnL are all in USDC. If no key is set, the bot starts in paper mode and says so in the header.

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
1. finds real holders (on-curve wallets with SOL for fees),
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
- **The dashboard binds to `127.0.0.1`.** To use it from your phone, set `HOST=0.0.0.0` **and**
  `DASHBOARD_TOKEN`, then open `http://<pc-ip>:8787/?token=…`. The live/paper toggle can be
  reached by anyone who can open the page.

## Every file explained

| File | What it does |
|---|---|
| `package.json` | Scripts (`start`, `demo`, `typecheck`) and dependencies: `@solana/web3.js`, `ws`, `bs58`, `dotenv`; `tsx` runs TypeScript directly. |
| `tsconfig.json` | Strict TypeScript, NodeNext modules, type-check only (`tsx` runs the code). |
| `.env.example` | Every setting, documented. Copy it to `.env`. |
| `.gitignore` | Keeps `.env`, `data/` (DB + log) and `node_modules` out of git. |
| **src/** | |
| `src/index.ts` | Entry point. Loads the wallet, falls back to paper if there's no key, warns on low SOL, reads the starting balance, and starts the dashboard and the agent loop. |
| `src/config.ts` | Every rule and threshold from the spec as constants (3x/7x/500/85%, 5% dev, 25–40%, 2% slippage, −12%/+36%), plus env settings. |
| `src/types.ts` | Shared data shapes: `PairSnapshot`, `Candidate`, `MintFacts`, `RugResult`, `Quote`, `Position`, `ClosedTrade`, `LogEntry`. |
| `src/util.ts` | Fetch with timeout, untrusted-label sanitising, money and percent formatting, bigint/UI unit conversion. |
| `src/state.ts` | The single in-memory dashboard state plus `update()`/`setAgent()`. Changes are batched into one WebSocket broadcast every 150 ms. |
| `src/orchestrator.ts` | The pipeline. While flat: scan → rug check → size → enter → log. While in a position: monitor every 4 s → exit → log → equity. Also handles the mode switch (refused while a position is open or a swap is in flight). |
| `src/server.ts` | HTTP server for `public/` (with path-traversal guard), WebSocket `/ws` for state pushes and the `setMode` toggle, and the optional token check. |
| **src/agents/** | |
| `src/agents/scanner.ts` | **Scanner.** Computes spikeX/volX from snapshots, applies the flag rule and LP ≥ 85%, and outputs candidate cards. Never trades. |
| `src/agents/rugCheck.ts` | **Rug check.** Authorities, extensions, LP, dev wallet, holder sell simulation and round-trip tax check. Returns the exact failing reason. |
| `src/agents/sizer.ts` | **Sizer.** 25–40% of current equity, scaled by spike and dev-wallet strength. |
| `src/agents/executor.ts` | **Executor.** Buys and sells through Jupiter, measures actual slippage from balance deltas, and marks the position with a live sell quote. Stop −12% / TP 3R. If a swap's confirmation times out but the swap landed, it still tracks the position. |
| `src/agents/logger.ts` | **Logger.** SQLite tables `decisions`, `trades`, `equity` plus numbered `night.log`. Refuses reasonless entries. |
| `src/agents/equity.ts` | **Equity.** Balance (on-chain USDC in live, ledger in paper), equity curve, closes / wins / losses. |
| **src/data/** | |
| `src/data/market.ts` | The `Market` interface agents use, and `liveMarket`, which wires the real sources together. |
| `src/data/dexscreener.ts` | New Solana tokens from DexScreener's latest profiles and boosts, plus per-pair m5/h1/h6 volume and liquidity. |
| `src/data/birdeye.ts` | Optional (`BIRDEYE_API_KEY`): new listings and holder counts. |
| `src/data/rugcheck.ts` | rugcheck.xyz report: LP lock %, creator address, holder count. Cached for 60 s. Authorities are **not** taken from here. |
| `src/data/solana.ts` | RPC reads: mint authorities and Token-2022 extensions, token balances, and real holder wallets for the honeypot test. |
| `src/data/jupiter.ts` | Quotes (2% slippage, response validated against the request, no platform fee), swap-transaction building (no fee account, no custom destination), and holder sell simulation. |
| `src/data/sim.ts` | Synthetic market for `npm run demo`: random tokens, some deliberately rugged, plus a random-walk price. Paper only. |
| **src/security/** | |
| `src/security/wallet.ts` | The only holder of the private key. Exposes the public key, `redact()` and `signGuarded()`. |
| `src/security/txGuard.ts` | Pre-sign inspection: program allowlist, destination checks and simulated balance-delta limits. |
| **public/** | |
| `public/index.html` | Dashboard markup: window bar + toggle, header stats, agent sidebar, live flow graph, stat cards, trade card, log tail, result, log feed. |
| `public/styles.css` | Near-black theme, one neon colour per agent, monospace numbers, glow and animations, responsive breakpoints at 1200 px and 820 px (phone). |
| `public/app.js` | WebSocket client that renders each state snapshot, runs the uptime timer and the paper/live toggle (asks for confirmation before going live), and auto-reconnects. |

## Data written

- `data/night.log`: plain-text, numbered; what you read in the morning.
- `data/grok.db`: SQLite with `decisions` (every ENTER/EXIT/FILTERED), `trades` (entry/exit/slippage/PnL/reasons) and `equity`.
