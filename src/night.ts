// `npm run night`: keeps the bot alive overnight. If the bot process dies for any reason it
// is restarted with backoff (5s → 60s) and resumes the same session + open position from
// SQLite. The first launch starts a fresh session; restarts resume it.
import { spawn } from "node:child_process";

const extra = process.argv.slice(2);
let first = true;
let backoff = 5_000;
let stopping = false;
let child: ReturnType<typeof spawn> | null = null;

function launch() {
  const args = ["--import", "tsx", "src/index.ts", ...extra, ...(first ? ["--new-session"] : [])];
  first = false;
  const startedAt = Date.now();
  child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (stopping) return process.exit(0);
    if (Date.now() - startedAt > 10 * 60_000) backoff = 5_000; // it ran fine for a while
    console.error(`[night] bot exited (${signal ?? code}); restarting in ${backoff / 1000}s`);
    setTimeout(launch, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  });
}

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    stopping = true;
    child?.kill(sig);
  });

launch();
