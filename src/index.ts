// Entry point: load wallet (key stays inside security/wallet.ts), pick market, start
// dashboard and the agent loop.
import { CONFIG, DEMO } from "./config.js";
import { loadWallet } from "./security/wallet.js";
import { update, state } from "./state.js";
import { liveMarket } from "./data/market.js";
import { simMarket } from "./data/sim.js";
import { resetSession } from "./agents/equity.js";
import { startServer } from "./server.js";
import { run } from "./orchestrator.js";
import { conn } from "./data/solana.js";

async function main() {
  const wallet = DEMO ? null : loadWallet();
  let mode = CONFIG.mode;
  let notice = mode === "live" ? "LIVE · real funds" : "paper · simulated fills";
  if (mode === "live" && !wallet) {
    mode = "paper";
    notice = DEMO ? "demo · synthetic market, paper only" : "no SOLANA_PRIVATE_KEY — fell back to paper";
  }
  update((s) => {
    s.mode = mode;
    s.liveAvailable = Boolean(wallet);
    s.wallet = wallet ? wallet.toBase58() : null;
    s.notice = notice;
  });

  if (wallet) {
    console.log(`wallet ${wallet.toBase58()}`); // public key only
    const sol = (await conn.getBalance(wallet).catch(() => 0)) / 1e9;
    if (sol < 0.02) console.warn(`warning: only ${sol.toFixed(4)} SOL for fees — keep ~0.05 SOL in the wallet`);
  }

  await resetSession(mode);
  console.log(`mode ${state.mode} · start balance $${state.balance.toFixed(2)}`);
  startServer();
  await run(DEMO ? simMarket : liveMarket);
}

main().catch((e) => {
  console.error("fatal:", (e as Error).message);
  process.exit(1);
});
