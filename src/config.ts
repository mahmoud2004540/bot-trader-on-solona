// Every tunable number in one place. Trading rules are constants on purpose:
// they are the spec, not knobs to fiddle with at 3am.
import "dotenv/config";

const env = (k: string, d = "") => process.env[k]?.trim() || d;

export const DEMO = process.argv.includes("--demo");

/**
 * Running on a cloud host (Railway sets RAILWAY_*; CLOUD=1 for any other host).
 * Then the dashboard is on the public internet: it binds 0.0.0.0, requires DASHBOARD_TOKEN,
 * the wallet key comes from the host's Variables, and data lives on the attached volume.
 */
export const CLOUD = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID || process.env.CLOUD === "1");
/** Persistent disk on the host. Without one, a redeploy would forget an open position. */
const VOLUME = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || (process.env.CLOUD === "1" ? process.env.DATA_DIR?.trim() : "") || "";

export const CONFIG = {
  // ---- runtime ----
  mode: (env("MODE", "live") === "paper" ? "paper" : "live") as "live" | "paper",
  rpcUrl: env("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
  jupiterBase: env("JUPITER_BASE_URL", "https://lite-api.jup.ag/swap/v1"),
  jupiterApiKey: env("JUPITER_API_KEY"),
  birdeyeApiKey: env("BIRDEYE_API_KEY"),
  host: env("HOST", CLOUD ? "0.0.0.0" : "127.0.0.1"),
  port: Number(env("PORT", "8787")),
  dashboardToken: env("DASHBOARD_TOKEN"),
  dataDir: env("DATA_DIR", VOLUME || (DEMO ? "data/demo" : "data")),
  /** live trading in the cloud needs a persistent volume (see VOLUME above) */
  cloudVolume: Boolean(VOLUME),
  paperStartUsd: Number(env("PAPER_START_USD", "100")),

  // Equity is held in USDC; every trade is USDC -> token -> USDC.
  quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  quoteDecimals: 6,
  wsolMint: "So11111111111111111111111111111111111111112",

  // ---- loop timing ----
  scanEveryMs: Number(env("SCAN_EVERY_MS", "20000")),
  monitorEveryMs: 4_000,
  recheckFilteredAfterMs: 30 * 60_000,

  // ---- 1. SCANNER ----
  scanner: {
    minSpikeX: 3, // m5 volume >= 3x the previous 5 minutes
    minVolX: 7, // OR m5 volume >= 7x the 6h average 5m volume...
    minHoldersForVolX: 500, // ...with 500+ holders
    minLpLockedPct: 85, // AND LP >= 85% locked
    minM5VolumeUsd: 1_000, // ignore dust pairs where "3x" of $10 is noise
  },

  // ---- 2. RUG CHECK ----
  rug: {
    minLpLockedPct: 85,
    maxDevWalletPct: 5,
    maxRoundTripLossPct: 10, // buy->sell quote loss above this smells like a tax/honeypot
    maxTransferFeeBps: 100,
  },

  // ---- 3. SIZER ----
  sizer: { minPct: 25, maxPct: 40, fullStrengthSpikeX: 10 },

  // ---- 4. EXECUTOR ----
  executor: { slippageBps: 200, stopLossPct: -12, takeProfitPct: 36 }, // 3R with R = 12%
} as const;
