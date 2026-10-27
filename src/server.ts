// Local dashboard: serves public/ over HTTP and pushes state over WebSocket.
// Binds 127.0.0.1 by default. If you expose it (HOST=0.0.0.0 for your phone), set
// DASHBOARD_TOKEN and open http://<ip>:8787/?token=... — the mode toggle moves real money.
import { createServer } from "node:http";
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
const authorized = (url: string | undefined) =>
  !CONFIG.dashboardToken || new URL(url ?? "/", "http://x").searchParams.get("token") === CONFIG.dashboardToken;

export function startServer() {
  const http = createServer(async (req, res) => {
    if (!authorized(req.url)) return void res.writeHead(401).end("token required");
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
    ws.send(json({ type: "state", state }));
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

  bus.on("state", (s) => {
    const payload = json({ type: "state", state: s });
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(payload);
  });

  http.listen(CONFIG.port, CONFIG.host, () => console.log(`dashboard → http://${CONFIG.host}:${CONFIG.port}`));
}
