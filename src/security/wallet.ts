// The ONLY place the private key exists in memory.
//
// - Read once from the SOLANA_PRIVATE_KEY env var, then the env var is deleted from
//   process.env so nothing (child processes, error dumps, dependencies) can read it later.
// - The Keypair never leaves this module. Callers get the public key and one function,
//   signGuarded(), which signs a transaction only after txGuard approves it.
// - There is deliberately no "sign arbitrary message" or "transfer" function anywhere.
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { assertSwapOnly } from "./txGuard.js";

let keypair: Keypair | null = null;
let secretFingerprints: string[] = [];

export function loadWallet(): PublicKey | null {
  const raw = process.env.SOLANA_PRIVATE_KEY?.trim();
  delete process.env.SOLANA_PRIVATE_KEY;
  if (!raw) return null;
  return useSecret(raw, "SOLANA_PRIVATE_KEY is set but");
}

/**
 * One-time setup from the dashboard: the key pasted there (from Phantom → Show Private Key)
 * is validated and loaded here, and server.ts saves it into .env, the same env var the
 * bot reads on every start. It is never echoed back, logged or sent anywhere else.
 */
export function connectWallet(raw: string): PublicKey {
  if (keypair) throw new Error("a wallet is already connected");
  return useSecret(raw.trim(), "the pasted key");
}

function useSecret(raw: string, what: string): PublicKey {
  try {
    const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
    keypair = Keypair.fromSecretKey(bytes);
  } catch {
    // Do not echo the value or the parser error (which may contain it).
    throw new Error(`${what} could not be read as a Solana private key`);
  }
  // Keep the encodings so redact() can scrub them if they ever appear in a string.
  secretFingerprints = [raw, bs58.encode(keypair.secretKey)];
  return keypair.publicKey;
}

export const walletPublicKey = (): PublicKey | null => keypair?.publicKey ?? null;

/** Other secrets (e.g. the Telegram bot token) that must never appear in output either. */
export function registerSecret(s: string) {
  if (s) secretFingerprints.push(s);
}

/** Last line of defence for anything written to disk, console or the dashboard. */
export function redact(s: string): string {
  let out = s;
  for (const f of secretFingerprints) if (f && out.includes(f)) out = out.split(f).join("[REDACTED]");
  return out;
}

/** Sign a Jupiter swap transaction. Throws if the transaction does anything but swap for us. */
export async function signGuarded(conn: Connection, tx: VersionedTransaction): Promise<VersionedTransaction> {
  if (!keypair) throw new Error("no wallet loaded");
  await assertSwapOnly(conn, tx, keypair.publicKey);
  tx.sign([keypair]);
  return tx;
}
