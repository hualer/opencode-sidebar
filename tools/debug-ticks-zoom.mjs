// Zoomed visual check of the rail ticks: high-DPI clip around the strip plus
// a DOM-side contrast report (computed background vs page background).
// Usage: node tools/debug-ticks-zoom.mjs [sessionID]
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
  deviceScaleFactor: 6,
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
await page.waitForFunction(
  () => {
    const el = document.getElementById("oc-rail-host");
    return !!el && el.style.left !== "" && el.dataset.ocStatus?.includes("tickCount");
  },
  null,
  { timeout: 15000 },
);
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const host = document.getElementById("oc-rail-host");
  const sr = host.shadowRoot;
  const strip = sr.querySelector(".strip");
  const ticks = [...sr.querySelectorAll(".tick")].map((t) => {
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    return {
      idx: t.dataset.index,
      cls: t.className,
      rect: [r.top, r.left, r.width, r.height].map((v) => +v.toFixed(1)),
      bg: cs.backgroundColor,
    };
  });
  // Page background right behind the rail (sample an ancestor chain bg).
  const bgs = [];
  let el = document.elementFromPoint(1413, 500);
  while (el && bgs.length < 6) {
    bgs.push(
      `${el.tagName}.${String(el.className).slice(0, 30)} => ${getComputedStyle(el).backgroundColor}`,
    );
    el = el.parentElement;
  }
  return {
    theme: host.dataset.ocTheme ?? null,
    ticks,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    behindRail: bgs,
    stripMask: getComputedStyle(strip).maskImage || getComputedStyle(strip).webkitMaskImage,
    stripRect: (() => {
      const r = strip.getBoundingClientRect();
      return [r.top, r.left, r.width, r.height].map((v) => +v.toFixed(1));
    })(),
    status: host.dataset.ocStatus,
  };
});
console.log(JSON.stringify(info, null, 2));

const hostRect = info.stripRect;
await page.screenshot({
  path: "/tmp/oc-rail-zoom.png",
  clip: {
    x: hostRect[1] - 4,
    y: hostRect[0] + hostRect[3] / 2 - 40,
    width: 32,
    height: 80,
  },
});
console.log("zoom: /tmp/oc-rail-zoom.png");
await ctx.close();
