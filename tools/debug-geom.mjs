// Sample rail host geometry + scroller candidates over time after load.
// Usage: node tools/debug-geom.mjs [sessionID]
import { chromium } from "file:///Users/ganlu/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs";
import { discoverServe, authHeader } from "./serve.mjs";

const { port, pass } = discoverServe();
const BASE = `http://127.0.0.1:${port}`;
const SERVER_KEY = Buffer.from(BASE).toString("base64").replace(/=+$/, "");
const EXT = "/Users/ganlu/aitools/OpenChamber";
const PROFILE =
  "/private/var/folders/b1/g4qwv0rd11z_s0g92pv5byyr0000gp/T/opencode/oc-e2e-profile";
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
await page.goto(`${BASE}/server/${SERVER_KEY}/session/${SID}`, {
  waitUntil: "domcontentloaded",
});

for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => {
    const host = document.getElementById("oc-rail-host");
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return [r.top, r.left, r.width, r.height].map(Math.round).join(",");
    };
    const cands = [...document.querySelectorAll("[data-scrollable]")]
      .filter((el) => el.querySelector("[data-timeline-row]"))
      .map(rect);
    return {
      host: host
        ? `L${host.style.left} T${host.style.top} H${host.style.height}`
        : null,
      vis: host ? host.style.visibility : null,
      cands,
      st: host?.dataset.ocStatus
        ? JSON.parse(host.dataset.ocStatus).activeIndex
        : null,
    };
  });
  console.log(
    `${(i * 0.3).toFixed(1)}s  host=${s.host} vis=${s.vis} active=${s.st} withRowsRects=[${s.cands}]`,
  );
  await page.waitForTimeout(300);
}
await ctx.close();
