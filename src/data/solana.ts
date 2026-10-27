// Direct on-chain reads over RPC. Authority checks come from HERE, not from any API's opinion.
import { Connection, PublicKey, ParsedAccountData } from "@solana/web3.js";
import { CONFIG } from "../config.js";
import type { MintFacts } from "../types.js";

export const conn = new Connection(CONFIG.rpcUrl, "confirmed");

const DANGEROUS_EXTENSIONS = ["transferHook", "permanentDelegate", "nonTransferable", "pausableConfig"];
export const isDangerousExtension = (e: string) => DANGEROUS_EXTENSIONS.includes(e);

export async function mintFacts(mint: string): Promise<MintFacts> {
  const res = await conn.getParsedAccountInfo(new PublicKey(mint));
  const v = res.value;
  if (!v || !("parsed" in v.data)) throw new Error("mint account not found");
  const info = (v.data as ParsedAccountData).parsed.info;
  const exts: { extension: string; state?: any }[] = info.extensions ?? [];
  const fee = exts.find((e) => e.extension === "transferFeeConfig")?.state;
  const das = exts.find((e) => e.extension === "defaultAccountState")?.state;
  return {
    decimals: info.decimals,
    supply: BigInt(info.supply),
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    tokenProgram: v.owner.toBase58(),
    extensions: exts.map((e) => e.extension),
    transferFeeBps: Number(fee?.newerTransferFee?.transferFeeBasisPoints ?? 0),
    defaultFrozen: das?.accountState === "frozen",
  };
}

/** Sum of all token accounts `owner` holds for `mint` (works for Token and Token-2022). */
export async function tokenBalance(owner: PublicKey, mint: string): Promise<bigint> {
  const res = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
  return res.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

/**
 * Real wallets (on-curve keys with SOL for fees) holding the token, largest first.
 * Used by the honeypot test to simulate a sell from an actual holder.
 * Candidate owners come from getTokenLargestAccounts; the public RPC blocks that call, so
 * `fallbackOwners` (rugcheck's top holders) is used instead. Either way each holder's
 * balance and SOL are re-read on-chain before use.
 */
let largestAccountsBlocked = false;

export async function sellSimHolders(mint: string, fallbackOwners: string[], max = 2): Promise<{ owner: string; amount: bigint }[]> {
  let owners = fallbackOwners;
  if (!largestAccountsBlocked) try {
    const largest = await conn.getTokenLargestAccounts(new PublicKey(mint));
    const parsed = await conn.getMultipleParsedAccounts(largest.value.slice(0, 12).map((a) => a.address));
    owners = parsed.value.flatMap((p) => (p && "parsed" in p.data ? [String(p.data.parsed.info.owner)] : []));
  } catch {
    largestAccountsBlocked = true; // don't burn ~7s of 429 retries on every check
  }
  const out: { owner: string; amount: bigint }[] = [];
  for (const o of [...new Set(owners)].slice(0, 12)) {
    if (out.length >= max) break;
    const owner = new PublicKey(o);
    if (!PublicKey.isOnCurve(owner.toBytes())) continue; // pool vaults/PDAs can't sign
    if ((await conn.getBalance(owner)) < 10_000_000) continue; // needs ~0.01 SOL for fees + temp rent
    const amount = await tokenBalance(owner, mint);
    if (amount > 0n) out.push({ owner: o, amount });
  }
  return out;
}
