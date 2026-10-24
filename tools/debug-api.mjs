// Dump the raw shape of the user-message endpoint for a session so the
// parser in src/api.js can be checked against reality.
// Usage: node tools/debug-api.mjs [sessionID]
import { discoverServe, authHeader } from "./serve.mjs";

const { port, pass } = discoverServe();
const BASE = `http://127.0.0.1:${port}`;
const AUTH = authHeader(pass);
const SID = process.argv[2] || "ses_f06807046ffefXP7Ei4wyhfboz";

for (const path of [
  `/api/session/${SID}/message`,
  `/session/${SID}/message`,
]) {
  const res = await fetch(BASE + path, {
    headers: { Authorization: AUTH },
  });
  const ct = res.headers.get("content-type") || "";
  console.log(`\n=== ${path} -> ${res.status} ${ct}`);
  if (!ct.includes("json")) {
    const body = await res.text();
    console.log("non-JSON body (first 200):", body.slice(0, 200));
    continue;
  }
  const json = await res.json();
  const items = Array.isArray(json) ? json : json?.data;
  console.log(
    "top-level:",
    Array.isArray(json) ? `array(${json.length})` : Object.keys(json || {}),
  );
  if (!Array.isArray(items)) {
    console.log("payload:", JSON.stringify(json).slice(0, 500));
    continue;
  }
  console.log(`items: ${items.length}`);
  const roleCounts = {};
  for (const it of items) {
    const info = it.info || it;
    const key = `type=${it.type ?? "-"} role=${info.role ?? "-"}`;
    roleCounts[key] = (roleCounts[key] || 0) + 1;
  }
  console.log("role/type histogram:", roleCounts);
  const sample = items.find((it) => (it.info || it).role === "user" || it.type === "user") ?? items[0];
  if (sample) {
    const info = sample.info || sample;
    console.log(
      "sample keys:",
      Object.keys(sample),
      "\ninfo keys:",
      Object.keys(info),
      "\nsample:",
      JSON.stringify(sample).slice(0, 600),
    );
  }
}
