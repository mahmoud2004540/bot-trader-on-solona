// Wallet watcher (live only), so you never have to touch the bot after sending it money:
//  - reads the bot wallet's SOL + USDC every ~30s while flat and shows it on the dashboard
//  - holds trading (quietly, no log spam) until there is at least $5 of USDC to trade
//  - converts SOL you deposit into USDC via Jupiter, always keeping 0.05 SOL for fees
//  - until the first trade, moves START to the deposited balance so START vs NOW is honest
// Money only ever moves through a Jupiter swap inside the bot's own wallet.
import { CONFIG } from "./config.js";
import { state, update, setAgent } from "./state.js";
import { conn, tokenBalance } from "./data/solana.js";
import { walletPublicKey } from "./security/wallet.js";
import { convertSol } from "./agents/executor.js";
import { logDecision, setSessionStartBalance } from "./agents/logger.js";
import { redact } from "./security/wallet.js";
import { toUi, usd } from "./util.js";

const KEEP_LAMPORTS = 50_000_000n; // 0.05 SOL stays for fees
const MIN_CONVERT_LAMPORTS = 30_000_000n; // don't churn dust
export const MIN_TRADING_USD = 5;
let lastCheck = 0;

/** Returns true when the wallet is funded enough to trade. Live mode only. */
export async function fundingTick(): Promise<boolean> {
  const me = walletPublicKey();
  if (state.mode !== "live" || !me) return true;
  if (Date.now() - lastCheck < 30_000 && state.funding) return state.funding.usdc >= MIN_TRADING_USD;
  lastCheck = Date.now();

  let lamports = BigInt(await conn.getBalance(me));
  let usdc = toUi(await tokenBalance(me, CONFIG.quoteMint), CONFIG.quoteDecimals);

  const spare = lamports - KEEP_LAMPORTS;
  if (spare >= MIN_CONVERT_LAMPORTS) {
    setAgent("executor", "EXEC", `converting ${(Number(spare) / 1e9).toFixed(3)} SOL → USDC`);
    try {
      const got = await convertSol(spare);
      logDecision("INFO", "$SOL", CONFIG.wsolMint, `${(Number(spare) / 1e9).toFixed(3)} SOL → ${usd(got)}`,
        "deposit converted to USDC for trading · kept 0.05 SOL for fees");
      lamports = BigInt(await conn.getBalance(me));
      usdc = toUi(await tokenBalance(me, CONFIG.quoteMint), CONFIG.quoteDecimals);
    } catch (e) {
      setAgent("executor", "FLAT", `SOL convert retry · ${redact((e as Error).message).slice(0, 40)}`);
    }
  }

  update((s) => {
    s.funding = { sol: Number(lamports) / 1e9, usdc, at: Date.now() };
    s.balance = usdc;
    if (s.trades === 0 && !s.position && Math.abs(usdc - s.startBalance) > 0.01) {
      s.startBalance = usdc;
      s.equityCurve = [{ t: Date.now(), v: usdc }];
      setSessionStartBalance(usdc);
    }
  });

  const funded = usdc >= MIN_TRADING_USD;
  if (!funded) {
    const low = Number(lamports) < 20_000_000 ? " + ~0.05 SOL" : "";
    setAgent("scanner", "WAIT", `waiting for funds · send USDC or SOL${low}`, false);
    setAgent("executor", "FLAT", `wallet ${usd(usdc)} · needs ≥ ${usd(MIN_TRADING_USD)}`, false);
  }
  return funded;
}
