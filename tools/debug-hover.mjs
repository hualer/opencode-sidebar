// Focused debug: strip hover -> TOC opens -> hover row0; dump hit-testing state.
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
  args: ["--lang=en-US", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.setExtraHTTPHeaders({ Authorization: authHeader(pass) });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/server/${SERVER_KEY}/session/${SID}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => {
  const el = document.getElementById("oc-rail-host");
  return !!el && el.style.left !== "" && JSON.parse(el.dataset.ocStatus || "{}").activeIndex >= 0;
}, null, { timeout: 15000 });

const dump = (label) =>
  page.evaluate((l) => {
    const host = document.getElementById("oc-rail-host");
    const sr = host.shadowRoot;
    const row = sr.querySelector(".toc .row");
    const hoverables = [...document.querySelectorAll(":hover")].map(
      (e) => e.tagName + (e.id ? "#" + e.id : ""),
    );
    return {
      label: l,
      tocOpen: sr.querySelector(".toc").classList.contains("open"),
      hoverIndex: JSON.parse(host.dataset.ocStatus).hoverIndex,
      row0Class: row.className,
      fullLen: (row.querySelector(".full").textContent || "").length,
      hoveredTicks: sr.querySelectorAll(".tick.hovered").length,
      hoverChain: hoverables.slice(-6),
    };
  }, label);

const strip = page.locator("#oc-rail-host .strip");
const sb = await strip.boundingBox();

// Install event probes inside the shadow tree.
await page.evaluate(() => {
  window.__ev = [];
  const sr = document.getElementById("oc-rail-host").shadowRoot;
  const targets = [
    ["strip", sr.querySelector(".strip")],
    ["toc", sr.querySelector(".toc")],
    ["list", sr.querySelector(".toc-list")],
  ];
  for (const [name, el] of targets) {
    for (const type of ["mouseenter", "mouseleave", "mouseover", "mouseout"]) {
      el.addEventListener(type, () =>
        window.__ev.push(
          `${performance.now().toFixed(0)}ms ${name} ${type}`,
        ),
      );
    }
  }
  window.__moves = [];
  const toc = sr.querySelector(".toc");
  document.addEventListener("mousemove", (e) => {
    const r = toc.getBoundingClientRect();
    window.__moves.push({
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      toc: [r.left, r.top, r.right, r.bottom].map(Math.round).join(","),
      open: toc.classList.contains("open"),
    });
  }, true);
});

await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.waitForTimeout(400);
console.log(await dump("after strip hover"));

const row0 = page.locator("#oc-rail-host .toc .row").first();
const rb = await row0.boundingBox();
console.log("row0 box:", rb);
const tx = rb.x + rb.width / 2;
const ty = rb.y + rb.height / 2;

// What is actually under the point?
const hit = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  const host = document.getElementById("oc-rail-host");
  const sr = host.shadowRoot;
  // walk shadow tree from the host using elementsFromPoint-like probing
  let deep = null;
  if (el === host && sr) {
    // probe: which shadow child contains the point?
    const hx = x - host.getBoundingClientRect().left;
    const hy = y - host.getBoundingClientRect().top;
    for (const child of sr.querySelectorAll(".toc, .strip")) {
      const r = child.getBoundingClientRect();
      if (hx >= r.left - host.getBoundingClientRect().left && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        deep = child.className;
      }
    }
  }
  return {
    tag: el?.tagName,
    id: el?.id,
    cls: String(el?.className).slice(0, 60),
    deep,
    ocHostAtPoint: el === host,
  };
}, [tx, ty]);
console.log("hit at row0 center:", hit);

await page.mouse.move(tx, ty, { steps: 5 });
await page.waitForTimeout(300);
console.log(await dump("after row0 hover (stepped move)"));
console.log("events:", await page.evaluate(() => window.__ev));
console.log("moves:", await page.evaluate(() => window.__moves));

// try locator.hover as alternative
await row0.hover().catch((e) => console.log("locator.hover error:", e.message));
await page.waitForTimeout(300);
console.log(await dump("after locator.hover"));

await ctx.close();
