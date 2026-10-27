// Local dashboard: serves public/ over HTTP and pushes state over WebSocket.
// Binds 127.0.0.1 by default. If you expose it (HOST=0.0.0.0 for your phone), set
// DASHBOARD_TOKEN and open http://<ip>:8787/?token=... — the mode toggle moves real money.
import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { CONFIG } from "./config.js";
import { bus, state } from "./state.js";
import { redact } from "./security/wallet.js";
import { setMode } from "./orchestrator.js";

const PUBLIC = join(process.cwd(), "public");
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

const json = (v: unknown) => redact(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// The computer running the bot is trusted; DASHBOARD_TOKEN is asked of other devices (your
// phone when HOST=0.0.0.0). A request relayed by a proxy carries X-Forwarded-For and is never
// treated as local, even if the proxy itself connects over loopback.
const isLocal = (req: IncomingMessage) => LOOPBACK.has(req.socket.remoteAddress ?? "") && !req.headers["x-forwarded-for"];
const authorized = (req: IncomingMessage) =>
  !CONFIG.dashboardToken || isLocal(req) || new URL(req.url ?? "/", "http://x").searchParams.get("token") === CONFIG.dashboardToken;

export function startServer() {
  // The page's HTML/CSS/JS are static and hold no data; everything live (state, log, the
  // mode toggle) goes over the WebSocket, which is where the token is enforced.
  const http = createServer(async (req, res) => {
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
    if (!authorized(req)) return ws.close(4001, "token required");
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
