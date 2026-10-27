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
 */
export async function sellSimHolders(mint: string, max = 4): Promise<{ owner: string; amount: bigint }[]> {
  const largest = await conn.getTokenLargestAccounts(new PublicKey(mint));
  const accs = largest.value.slice(0, 12);
  const parsed = await conn.getMultipleParsedAccounts(accs.map((a) => a.address));
  const out: { owner: string; amount: bigint }[] = [];
  for (let i = 0; i < accs.length && out.length < max; i++) {
    const p = parsed.value[i];
    if (!p || !("parsed" in p.data)) continue;
    const owner = new PublicKey(p.data.parsed.info.owner);
    if (!PublicKey.isOnCurve(owner.toBytes())) continue; // pool vaults/PDAs can't sign
    const lamports = await conn.getBalance(owner);
    if (lamports < 10_000_000) continue; // needs ~0.01 SOL for fees + temp rent
    out.push({ owner: owner.toBase58(), amount: BigInt(accs[i].amount) });
  }
  return out;
}
