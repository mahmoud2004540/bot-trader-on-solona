// Local dashboard: serves public/ over HTTP and pushes state over WebSocket.
// Binds 127.0.0.1 by default. If you expose it (HOST=0.0.0.0 for your phone), set
// DASHBOARD_TOKEN and open http://<ip>:8787/?token=... — the mode toggle moves real money.
import { createServer } from "node:http";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { CONFIG } from "./config.js";
import { bus, state } from "./state.js";
import { connectWallet, redact, walletPublicKey } from "./security/wallet.js";
import { goLiveWhenFlat, setMode } from "./orchestrator.js";
import { update } from "./state.js";

const PUBLIC = join(process.cwd(), "public");
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

const json = (v: unknown) => redact(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const authorized = (url: string | undefined) =>
  !CONFIG.dashboardToken || new URL(url ?? "/", "http://x").searchParams.get("token") === CONFIG.dashboardToken;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const ENV_PATH = join(process.cwd(), ".env");

/**
 * POST /api/setup {secret}: one-time wallet connection from the dashboard.
 * Locked down because whoever sets the key decides which wallet you fund:
 *  - only from this computer (loopback socket), with a localhost Host header (no DNS rebinding)
 *  - same-origin only and JSON-only, so other websites can't POST here (CSRF)
 *  - only while no wallet is connected; it can't replace an existing key
 * The key is saved into .env (SOLANA_PRIVATE_KEY, file mode 600) and never sent back.
 */
async function handleSetup(req: IncomingMessage): Promise<[number, object]> {
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
  const origin = req.headers.origin;
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "") || !["127.0.0.1", "localhost", "[::1]"].includes(host))
    return [403, { error: "setup only works on this computer: open http://127.0.0.1:" + CONFIG.port }];
  if (origin && origin !== `http://${req.headers.host}`) return [403, { error: "cross-site request refused" }];
  if (!String(req.headers["content-type"]).startsWith("application/json")) return [415, { error: "json only" }];
  if (walletPublicKey()) return [409, { error: "a wallet is already connected" }];

  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) return [413, { error: "too large" }];
  }
  let secret = "";
  try {
    secret = String(JSON.parse(body).secret ?? "").trim();
  } catch {}
  let pub;
  try {
    pub = connectWallet(secret);
  } catch {
    return [400, { error: "that doesn't look like a Solana private key — copy it again from Phantom" }];
  }
  const prev = existsSync(ENV_PATH) ? await readFile(ENV_PATH, "utf8") : "";
  const kept = prev.split("\n").filter((l) => l.trim() && !/^\s*SOLANA_PRIVATE_KEY\s*=/.test(l));
  await writeFile(ENV_PATH, [...kept, `SOLANA_PRIVATE_KEY=${secret}`].join("\n") + "\n", { mode: 0o600 });
  await chmod(ENV_PATH, 0o600).catch(() => {});
  secret = "";
  update((s) => {
    s.liveAvailable = true;
    s.needsSetup = false;
    s.wallet = pub.toBase58();
  });
  console.log(`wallet connected ${pub.toBase58()}`); // public key only
  goLiveWhenFlat();
  return [200, { ok: true, address: pub.toBase58() }];
}

export function startServer() {
  const http = createServer(async (req, res) => {
    if (!authorized(req.url)) return void res.writeHead(401).end("token required");
    if (req.url?.startsWith("/api/setup")) {
      if (req.method !== "POST") return void res.writeHead(405).end();
      const [code, body] = await handleSetup(req).catch(() => [500, { error: "setup failed" }] as [number, object]);
      return void res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
    }
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
    if (!file.startsWith(PUBLIC)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });

  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws, req) => {
    if (!authorized(req.url)) return ws.close(4001, "token required");
    ws.send(json({ type: "state", state: { ...state, log: undefined } }));
    ws.send(json({ type: "history", entries: state.log }));
    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.type === "setMode" && (msg.mode === "live" || msg.mode === "paper")) {
        const err = setMode(msg.mode);
        ws.send(json({ type: "notice", text: err ?? `mode → ${msg.mode}` }));
      }
    });
  });

  // The full night's log can be thousands of entries, so it is not part of the state
  // snapshot: clients get it once ("history") and then one "log" message per decision.
  const broadcast = (msg: unknown) => {
    const payload = json(msg);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
  };
  bus.on("state", (s) => broadcast({ type: "state", state: { ...s, log: undefined } }));
  bus.on("log", (e) => broadcast({ type: "log", entry: e }));
  bus.on("history", () => broadcast({ type: "history", entries: state.log }));

  http.listen(CONFIG.port, CONFIG.host, () => console.log(`dashboard → http://${CONFIG.host}:${CONFIG.port}`));
}
