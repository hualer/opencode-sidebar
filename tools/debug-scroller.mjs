// Dump every [data-scrollable] candidate + rail host geometry for debugging.
// Usage: node tools/debug-scroller.mjs [sessionID]
import { chromium } from "file:///Users/ganlu/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs";
import { discoverServe, authHeader } from "./serve.mjs";

const { port, pass } = discoverServe();
const BASE = `http://127.0.0.1:${port}`;
const SERVER_KEY = Buffer.from(BASE).toString("base64").replace(/=+$/, "");
const EXT = "/Users/ganlu/aitools/OpenChamber";
const PROFILE =
  "/private/var/folders/b1/g4qwv0rd11z_s0g92pv5byyr0000gp/T/opencode/oc-profile";
const SID = process.argv[2] || "ses_0f90e7674ffeEOToExMotNOqTI";

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "msedge",
  headless: true,
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  args: [
    "--lang=en-US",
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
  ],
});
await ctx.setExtraHTTPHeaders({ Authorization: authHeader(pass) });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("console", (m) => {
  if (m.text().includes("[oc-rail]")) console.log("PAGE:", m.text());
});
await page.goto(`${BASE}/server/${SERVER_KEY}/session/${SID}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(6000);

const report = await page.evaluate(() => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      t: Math.round(r.top),
      l: Math.round(r.left),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  const cands = [...document.querySelectorAll("[data-scrollable]")].map((el) => ({
    cls: String(el.className).slice(0, 80),
    comp: el.getAttribute("data-component"),
    rect: rect(el),
    rows: el.querySelectorAll("[data-timeline-row]").length,
    userRows: el.querySelectorAll('[data-timeline-row="UserMessage"]').length,
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
  }));
  const withRows = cands.filter((c) => c.rows > 0);
  const host = document.getElementById("oc-rail-host");
  const st = host?.dataset.ocStatus;
  return {
    cands,
    withRowsCount: withRows.length,
    hostStyle: host
      ? { left: host.style.left, top: host.style.top, height: host.style.height, width: host.style.width }
      : null,
    hostRect: host ? rect(host) : null,
    status: st,
    viewport: { w: innerWidth, h: innerHeight },
    scrollersChain: (() => {
      // walk up from the first user row to see the ancestor chain
      const row = document.querySelector('[data-timeline-row="UserMessage"]');
      const out = [];
      let el = row;
      while (el && out.length < 8) {
        const cs = getComputedStyle(el);
        out.push({
          tag: el.tagName,
          cls: String(el.className).slice(0, 60),
          pos: cs.position,
          overflow: cs.overflowY,
          rect: rect(el),
          attrs: ["data-scrollable", "data-timeline-row", "data-virtual"]
            .filter((a) => el.hasAttribute(a))
            .join(","),
        });
        el = el.parentElement;
      }
      return out;
    })(),
  };
});
console.log(JSON.stringify(report, null, 2));
await ctx.close();
