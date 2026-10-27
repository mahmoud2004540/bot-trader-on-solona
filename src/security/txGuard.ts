// Enforces "never send funds anywhere except Jupiter swaps".
//
// Every transaction is inspected BEFORE it is signed:
//   1. Fee payer must be our wallet.
//   2. Top-level instructions may only call: ComputeBudget, Jupiter v6, Associated Token
//      Account (create for ourselves), System (SOL wrap into OUR wSOL account only),
//      SPL Token (SyncNative, or CloseAccount paying rent back to US only).
//      Any System/Token transfer to another address => rejected.
//   3. The transaction is simulated and the wallet's SOL and USDC balances after the
//      simulation are compared with before: SOL may only drop by fees/rent, USDC may
//      only drop by at most the amount we intended to swap in.
// If any check fails, the transaction is never signed.
import { Connection, PublicKey, VersionedTransaction, AddressLookupTableAccount } from "@solana/web3.js";
import { CONFIG } from "../config.js";

export const PROGRAMS = {
  computeBudget: "ComputeBudget111111111111111111111111111111",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  system: "11111111111111111111111111111111",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
} as const;

const MAX_SOL_SPEND_LAMPORTS = 50_000_000n; // 0.05 SOL: fees + priority + temporary rent

export function ataAddress(owner: PublicKey, mint: PublicKey, tokenProgram = PROGRAMS.token): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey(tokenProgram).toBuffer(), mint.toBuffer()],
    new PublicKey(PROGRAMS.ata),
  )[0];
}

let pendingSpend = 0n;
/** Executor declares how much USDC (raw units) the next transaction is allowed to spend. */
export function allowQuoteSpend(raw: bigint) {
  pendingSpend = raw;
}

export async function assertSwapOnly(conn: Connection, tx: VersionedTransaction, wallet: PublicKey) {
  const maxQuoteSpend = pendingSpend;
  pendingSpend = 0n;
  const msg = tx.message;
  const luts: AddressLookupTableAccount[] = [];
  for (const l of msg.addressTableLookups) {
    const res = await conn.getAddressLookupTable(l.accountKey);
    if (!res.value) throw new Error("txGuard: lookup table not found");
    luts.push(res.value);
  }
  const keys = msg.getAccountKeys({ addressLookupTableAccounts: luts });
  const key = (i: number) => keys.get(i)?.toBase58() ?? "?";
  const me = wallet.toBase58();
  const myWsol = ataAddress(wallet, new PublicKey(CONFIG.wsolMint)).toBase58();

  if (msg.staticAccountKeys[0].toBase58() !== me) throw new Error("txGuard: fee payer is not our wallet");

  for (const ix of msg.compiledInstructions) {
    const program = key(ix.programIdIndex);
    const acc = (n: number) => key(ix.accountKeyIndexes[n]);
    const data = Buffer.from(ix.data);
    switch (program) {
      case PROGRAMS.computeBudget:
      case PROGRAMS.jupiter:
        break;
      case PROGRAMS.ata:
        // create / createIdempotent: [payer, ata, owner, mint, system, tokenProgram]
        if (data.length > 1 || (data.length === 1 && data[0] > 1)) throw new Error("txGuard: unexpected ATA instruction");
        if (acc(0) !== me || acc(2) !== me) throw new Error("txGuard: ATA created for someone else");
        break;
      case PROGRAMS.system: {
        const kind = data.readUInt32LE(0);
        if (kind !== 2) throw new Error(`txGuard: system instruction ${kind} not allowed`);
        if (acc(1) !== myWsol) throw new Error("txGuard: SOL transfer to foreign address blocked");
        break;
      }
      case PROGRAMS.token:
      case PROGRAMS.token2022: {
        const kind = data[0];
        if (kind === 17) break; // SyncNative
        if (kind === 9 && acc(1) === me && acc(2) === me) break; // CloseAccount -> rent back to us
        throw new Error(`txGuard: token instruction ${kind} not allowed`);
      }
      default:
        throw new Error(`txGuard: program ${program} not allowed`);
    }
  }

  // Balance-delta check via simulation (no signature needed for simulation).
  const usdcAta = ataAddress(wallet, new PublicKey(CONFIG.quoteMint));
  const [preLamports, preUsdc] = await Promise.all([
    conn.getBalance(wallet).then(BigInt),
    conn.getTokenAccountBalance(usdcAta).then((b) => BigInt(b.value.amount)).catch(() => 0n),
  ]);
  const sim = await conn.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { encoding: "base64", addresses: [wallet.toBase58(), usdcAta.toBase58()] },
  });
  if (sim.value.err) throw new Error(`txGuard: simulation failed ${JSON.stringify(sim.value.err)}`);
  const [w, u] = sim.value.accounts ?? [];
  const postLamports = BigInt(w?.lamports ?? 0);
  const postUsdc = u?.data?.[0] ? Buffer.from(u.data[0], "base64").readBigUInt64LE(64) : 0n;
  if (preLamports - postLamports > MAX_SOL_SPEND_LAMPORTS) throw new Error("txGuard: SOL outflow exceeds fee budget");
  if (preUsdc - postUsdc > maxQuoteSpend) throw new Error("txGuard: USDC outflow exceeds intended swap amount");
}
