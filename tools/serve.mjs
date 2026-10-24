"use strict";
// Locate the live `opencode serve` instance started by OpenChamber.
// It binds a random port and sets a fresh password in its environment, so
// both must be discovered from the process table at runtime.
import { execSync } from "node:child_process";

export function discoverServe() {
  // pgrep -f fails to match this process on macOS; filter `ps` output instead.
  const lines = execSync("ps ax -o pid=,command=").toString().split("\n");
  const line = lines.find(
    (l) => l.includes("opencode serve") && !l.includes("ps ax"),
  );
  if (!line) throw new Error("no `opencode serve` process found");
  const pid = line.trim().split(/\s+/)[0];
  const raw = execSync(`ps eww ${pid}`).toString();
  const port = raw.match(/--port (\d+)/)?.[1];
  const pass =
    raw.match(/OPENCODE_SERVER_PASSWORD=(\S+)/)?.[1] ??
    raw.match(/OPENCODE_PASSWORD=(\S+)/)?.[1];
  if (!port || !pass) throw new Error("could not discover port/password");
  return { pid: Number(pid), port: Number(port), pass };
}

export function authHeader(pass) {
  return "Basic " + Buffer.from("opencode:" + pass).toString("base64");
}
