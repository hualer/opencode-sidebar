// Open the real remote session page (nginx basic auth) with the extension
// loaded, and record: (1) what the web UI itself requests to render the
// conversation, (2) what the extension's fetch sees, (3) rail status.
// Usage: node tools/probe-remote.mjs [sessionURL]
import { chromium } from "file:///Users/ganlu/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs";
import { REMOTE_BASE, remoteAuth } from "./remote.mjs";

const EXT = "/Users/ganlu/aitools/OpenChamber";
const PROFILE =
  "/private/var/folders/b1/g4qwv0rd11z_s0g92pv5byyr0000gp/T/opencode/oc-remote-profile";
const SERVER_KEY = Buffer.from(REMOTE_BASE)
  .toString("base64")
  .replace(/=+$/, "");
const URL_ =
  process.argv[2] ||
  `${REMOTE_BASE}/server/${SERVER_KEY}/session/ses_f06807046ffefXP7Ei4wyhfboz`;
const AUTH = remoteAuth();

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "msedge",
  headless: true,
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  httpCredentials: { username: AUTH.user, password: AUTH.pass },
  args: [
    "--lang=en-US",
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
  ],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

const seen = new Map(); // url -> {status, ct, head}
page.on("response", async (r) => {
  const u = r.url();
  if (!/message|\/api\/session|event/.test(u)) return;
  const key = u.replace(/\?.*$/, "");
  if (seen.has(key)) return;
  let head = "";
  try {
    const ct = r.headers()["content-type"] || "";
    if (ct.includes("json")) head = (await r.text()).slice(0, 300);
  } catch {}
  seen.set(key, { status: r.status(), head });
  console.log(`HTTP ${r.status()}  ${key}\n     ${head}`);
});
page.on("console", (m) => {
  if (m.text().includes("[oc-rail]")) console.log(`CONSOLE: ${m.text()}`);
});

await page.goto(URL_, { waitUntil: "domcontentloaded" });
await page
  .waitForFunction(() => document.body.innerText.length > 1500, null, {
    timeout: 30000,
  })
  .catch(() => console.log("(timeout waiting for content)"));
await page.waitForTimeout(6000);

const report = await page.evaluate(async () => {
  const host = document.getElementById("oc-rail-host");
  const scroller = [...document.querySelectorAll("[data-scrollable]")].filter(
    (el) => el.querySelector("[data-timeline-row]"),
  );
  let apiProbe = null;
  try {
    const sid = location.pathname.match(/\/session\/(ses_[A-Za-z0-9]+)/)?.[1];
    const res = await fetch("/api/session/" + sid + "/message", {
      credentials: "include",
    });
    const ct = res.headers.get("content-type") || "";
    apiProbe = {
      status: res.status,
      ct,
      body: ct.includes("json")
        ? JSON.stringify(await res.json()).slice(0, 400)
        : "(non-json)",
    };
  } catch (e) {
    apiProbe = String(e);
  }
  const sr = host?.shadowRoot;
  const ticks = sr ? [...sr.querySelectorAll(".tick")] : [];
  return {
    href: location.href,
    host: !!host,
    status: host?.dataset.ocStatus ?? null,
    theme: host?.dataset.ocTheme ?? null,
    visibility: host?.style.visibility || "(unset)",
    computedVis: host ? getComputedStyle(host).visibility : null,
    left: host?.style.left || "(unset)",
    hostBox: host
      ? (() => {
          const r = host.getBoundingClientRect();
          return [r.left, r.top, r.width, r.height].map(Math.round).join(",");
        })()
      : null,
    tickCount: ticks.length,
    tickBoxes: ticks.slice(0, 4).map((t) => {
      const r = t.getBoundingClientRect();
      return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} ${getComputedStyle(t).backgroundColor}`;
    }),
    withRows: scroller.length,
    userRows: document.querySelectorAll('[data-timeline-row="UserMessage"]')
      .length,
    renderedText: document.body.innerText.slice(0, 200),
    apiProbe,
  };
});
console.log(JSON.stringify(report, null, 2));
await page.screenshot({
  path: "/tmp/oc-remote-rail.png",
  clip: { x: 900, y: 0, width: 540, height: 900 },
});
console.log("screenshot: /tmp/oc-remote-rail.png");
await ctx.close();
