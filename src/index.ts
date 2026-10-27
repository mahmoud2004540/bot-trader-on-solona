// Entry point: load wallet (key stays inside security/wallet.ts), pick market, start
// dashboard and the agent loop.
import { CLOUD, CONFIG, DEMO } from "./config.js";
import { loadWallet, redact } from "./security/wallet.js";
import { update, state } from "./state.js";
import { liveMarket } from "./data/market.js";
import { simMarket } from "./data/sim.js";
import { startSession } from "./agents/equity.js";
import { startServer } from "./server.js";
import { savePosition } from "./agents/logger.js";
import { liveBlockedReason, restorePosition, run } from "./orchestrator.js";
import { conn } from "./data/solana.js";
import { startTelegram } from "./telegram.js";

async function main() {
  const wallet = DEMO ? null : loadWallet();
  let mode = CONFIG.mode;
  let notice = mode === "live" ? "LIVE · real funds" : "paper · simulated fills";
  if (mode === "live" && !wallet) {
    mode = "paper";
    notice = DEMO ? "demo · synthetic market, paper only" : "connect Phantom to go live · paper until then";
  } else if (mode === "live" && liveBlockedReason()) {
    mode = "paper";
    notice = `${liveBlockedReason()} · paper until then`;
  }
  update((s) => {
    s.mode = mode;
    s.liveAvailable = Boolean(wallet);
    s.needsSetup = !wallet && !DEMO;
    s.cloud = CLOUD;
    s.wallet = wallet ? wallet.toBase58() : null;
    s.notice = notice;
  });

  if (wallet) {
    console.log(`wallet ${wallet.toBase58()}`); // public key only
    const sol = (await conn.getBalance(wallet).catch(() => 0)) / 1e9;
    if (sol < 0.02) console.warn(`warning: only ${sol.toFixed(4)} SOL for fees — keep ~0.05 SOL in the wallet`);
  }

  await startSession(mode, { resume: !process.argv.includes("--new-session") });
  // demo tokens only exist in memory, so a saved demo position can never be exited
  if (DEMO) savePosition(mode, null);
  else await restorePosition();
  console.log(`mode ${state.mode} · start $${state.startBalance.toFixed(2)} · now $${state.balance.toFixed(2)}`);
  startServer();
  if (CONFIG.telegramToken)
    startTelegram(CONFIG.telegramToken)
      .then((bot) => console.log(`telegram @${bot}${state.telegram.paired ? " · paired" : ` · send /start ${state.telegram.code} to pair`}`))
      .catch(() => console.warn("telegram: TELEGRAM_BOT_TOKEN was rejected by Telegram; alerts are off"));
  await run(DEMO ? simMarket : liveMarket);
}

// A stray rejection (flaky API) must not end the night; a real crash exits so the
// `npm run night` supervisor restarts and resumes from SQLite.
process.on("unhandledRejection", (e) => console.error("[unhandled]", redact(String((e as Error)?.message ?? e))));
process.on("uncaughtException", (e) => {
  console.error("[crash]", redact(e.message));
  process.exit(1);
});

main().catch((e) => {
  console.error("fatal:", redact((e as Error).message));
  process.exit(1);
});
