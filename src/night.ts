// `npm run night`: keeps the bot alive overnight. If the bot process dies for any reason it
// is restarted with backoff (5s → 60s) and resumes the same session + open position from
// SQLite. The first launch starts a fresh session; restarts resume it.
// It also stops the computer from going to sleep while it runs (Mac, Windows, Linux).
import { spawn, type ChildProcess } from "node:child_process";

function keepAwake(): ChildProcess | null {
  const opts = { stdio: "ignore" as const };
  let p: ChildProcess | null = null;
  if (process.platform === "android") {
    // Termux: a wake lock keeps Android from pausing the bot when the screen turns off.
    p = spawn("termux-wake-lock", [], opts);
    process.on("exit", () => spawn("termux-wake-unlock", [], opts));
    p.on("error", () => console.warn("[night] couldn't take a wake lock — keep Termux open and the phone charging"));
    return p;
  }
  if (process.platform === "darwin") p = spawn("caffeinate", ["-i", "-w", String(process.pid)], opts);
  else if (process.platform === "win32") {
    const ps =
      `$s = Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' -Name Awake -Namespace Grok -PassThru; ` +
      `while ($true) { [void]$s::SetThreadExecutionState([uint32]"0x80000001"); Start-Sleep -Seconds 50 }`;
    p = spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], opts);
  } else p = spawn("systemd-inhibit", ["--what=sleep:idle", "--why=Grok Bot overnight", "sleep", "infinity"], opts);
  p.on("error", () => console.warn("[night] couldn't block sleep — set your computer to never sleep"));
  return p;
}
const awake = keepAwake();
process.on("exit", () => awake?.kill());

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
    if (stopping) {
      awake?.kill();
      return process.exit(0);
    }
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
