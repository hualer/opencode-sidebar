// Reproduce: any 1s window where the timeline renders no [data-timeline-row]
// makes ocFindScroller() return null -> rail.setVisible(false), and check
// whether the rail ever comes back on its own once rows exist again.
// Usage: node tools/debug-hidden.mjs [sessionID]
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
page.on("console", (m) => {
  if (m.text().includes("[oc-rail]")) console.log(`PAGE: ${m.text()}`);
});
await page.goto(`${BASE}/server/${SERVER_KEY}/session/${SID}`, {
  waitUntil: "domcontentloaded",
});

const probe = () =>
  page.evaluate(() => {
    const host = document.getElementById("oc-rail-host");
    if (!host) return { host: false };
    const sr = host.shadowRoot;
    const ticks = [...sr.querySelectorAll(".tick")];
    const rects = ticks.map((t) => {
      const r = t.getBoundingClientRect();
      return `${Math.round(r.top)}:${Math.round(r.width)}x${Math.round(r.height)}`;
    });
    const visibleTicks = ticks.filter((t) => {
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
    const scroller = [...document.querySelectorAll("[data-scrollable]")].filter(
      (el) => el.querySelector("[data-timeline-row]"),
    ).length;
    const st = host.dataset.ocStatus ? JSON.parse(host.dataset.ocStatus) : null;
    return {
      host: true,
      visibility: host.style.visibility,
      computedVis: getComputedStyle(host).visibility,
      rects,
      ticks: ticks.length,
      tickVis: ticks[0] ? getComputedStyle(ticks[0]).visibility : null,
      visibleTicks,
      rowsInScroller: scroller,
      allRows: document.querySelectorAll("[data-timeline-row]").length,
      activeIndex: st?.activeIndex,
      tickCount: st?.tickCount,
      errors: st?.errors?.length,
    };
  });

await page.waitForFunction(
  () => {
    const el = document.getElementById("oc-rail-host");
    return !!el && el.style.visibility === "visible";
  },
  null,
  { timeout: 15000 },
);
await page.waitForTimeout(500);
await page.waitForFunction(
  () => {
    const el = document.getElementById("oc-rail-host");
    if (!el?.dataset.ocStatus) return false;
    return JSON.parse(el.dataset.ocStatus).activeIndex >= 0;
  },
  null,
  { timeout: 15000 },
);
console.log("BEFORE      ", JSON.stringify(await probe()));

// --- simulate the timeline briefly rendering no rows (loading / remount) ---
await page.evaluate(() => {
  window.__ocSavedRows = [];
  for (const el of document.querySelectorAll("[data-timeline-row]")) {
    window.__ocSavedRows.push([el, el.getAttribute("data-timeline-row")]);
    el.setAttribute("data-timeline-row-off", el.getAttribute("data-timeline-row"));
    el.removeAttribute("data-timeline-row");
  }
  return window.__ocSavedRows.length;
});
await page.waitForTimeout(1600); // > 1s watchdog tick
const hidden = await probe();
console.log("ROWS GONE   ", JSON.stringify(hidden));

// --- rows come back ---
await page.evaluate(() => {
  for (const [el, v] of window.__ocSavedRows || []) {
    el.setAttribute("data-timeline-row", v);
    el.removeAttribute("data-timeline-row-off");
  }
});
await page.waitForTimeout(2500); // > 2 watchdog ticks
const restored = await probe();
console.log("ROWS BACK   ", JSON.stringify(restored));

// --- does a scroll (activeIndex change) bring it back? ---
const before = restored.activeIndex;
await page.mouse.move(700, 400);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(300);
await page.mouse.wheel(0, 600);
await page.waitForTimeout(800);
const afterScroll = await probe();
console.log(
  `AFTER SCROLL active ${before} -> ${afterScroll.activeIndex}  visibility=${afterScroll.visibility}`,
);

// --- and does the strip take hover / open the TOC? ---
const box = await page.locator("#oc-rail-host .strip").boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  const tocOpen = await page.evaluate(
    () =>
      document.getElementById("oc-rail-host").shadowRoot.querySelector(".toc")
        .classList.contains("open"),
  );
  console.log("TOC opens while hidden?", tocOpen, "visibility=", (await probe()).visibility);
}

await ctx.close();
