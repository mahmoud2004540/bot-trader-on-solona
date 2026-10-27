// Small helpers: HTTP with timeouts, untrusted-text sanitising, formatting.

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).host}${new URL(url).pathname}`);
  return (await res.json()) as T;
}

/**
 * Token names/symbols are written by whoever launched the token. They are treated as
 * opaque display strings: printable characters only, short, and never interpreted.
 * The bot never fetches token websites/socials and never acts on any text inside them.
 */
export function untrustedLabel(s: unknown, max = 12): string {
  const clean = String(s ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_.\-]/gu, "")
    .slice(0, max);
  return clean || "???";
}

export const ticker = (symbol: string) => "$" + untrustedLabel(symbol).toUpperCase();

export const usd = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);
export const signedUsd = (n: number) => (n >= 0 ? "+" : "-") + "$" + Math.abs(n).toFixed(2);
export const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const toUi = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;
export const fromUi = (ui: number, decimals: number) => BigInt(Math.floor(ui * 10 ** decimals));
