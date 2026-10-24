"use strict";
// Remote opencode web deployment (nginx basic auth) credentials.
//
// Never hardcode them: the password is read from the running OpenChamber
// process environment (same technique as serve.mjs), or from OC_REMOTE_* env
// overrides. Username defaults to the local macOS account.
import { execSync } from "node:child_process";
import os from "node:os";

// No hardcoded default: set OC_REMOTE_BASE to your own deployment,
// e.g. OC_REMOTE_BASE=https://your-host:3443 node tools/probe-remote.mjs
export const REMOTE_BASE = process.env.OC_REMOTE_BASE;
if (!REMOTE_BASE) {
  throw new Error(
    "OC_REMOTE_BASE is not set — e.g. OC_REMOTE_BASE=https://your-host:3443 node tools/probe-remote.mjs",
  );
}

export function remoteAuth() {
  if (process.env.OC_REMOTE_USER && process.env.OC_REMOTE_PASS) {
    return { user: process.env.OC_REMOTE_USER, pass: process.env.OC_REMOTE_PASS };
  }
  let pass = null;
  try {
    const lines = execSync("ps ax -o pid=,command=").toString().split("\n");
    const line = lines.find(
      (l) => /OpenChamber|opencode/i.test(l) && !l.includes("ps ax"),
    );
    if (line) {
      const pid = line.trim().split(/\s+/)[0];
      pass =
        execSync(`ps eww ${pid}`)
          .toString()
          .match(/OPENCHAMBER_UI_PASSWORD=(\S+)/)?.[1] ?? null;
    }
  } catch {
    /* fall through */
  }
  if (!pass) {
    throw new Error(
      "remote password not found: set OC_REMOTE_USER / OC_REMOTE_PASS",
    );
  }
  return { user: os.userInfo().username, pass };
}

export function remoteHeader() {
  const { user, pass } = remoteAuth();
  return {
    Authorization:
      "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
  };
}
