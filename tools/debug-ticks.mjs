// Probe why the rail ticks are not visible: rects, computed styles, mask and
// stacking at the tick positions.
// Usage: node tools/debug-ticks.mjs [sessionID]
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
page.on("console", (m) => console.log(`PAGE[${m.type()}]:`, m.text()));
await page.goto(`${BASE}/server/${SERVER_KEY}/session/${SID}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForTimeout(6000);

const report = await page.evaluate(() => {
  const host = document.getElementById("oc-rail-host");
  if (!host) return { error: "no host" };
  const sr = host.shadowRoot;
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      top: +r.top.toFixed(1),
      left: +r.left.toFixed(1),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
    };
  };
  const hostCS = getComputedStyle(host);
  const strip = sr.querySelector(".strip");
  const tape = sr.querySelector(".tape");
  const stripCS = getComputedStyle(strip);
  const ticks = [...sr.querySelectorAll(".tick")];
  const tickInfo = ticks.map((t) => {
    const cs = getComputedStyle(t);
    return {
      idx: t.dataset.index,
      cls: t.className,
      rect: rect(t),
      bg: cs.backgroundColor,
      opacity: cs.opacity,
      display: cs.display,
      vis: cs.visibility,
      w: cs.width,
      h: cs.height,
    };
  });
  const first = tickInfo[0]?.rect;
  let hit = null;
  if (first) {
    const el = document.elementFromPoint(
      first.left + first.w / 2,
      first.top + first.h / 2,
    );
    hit = el
      ? `${el.tagName}#${el.id}.${el.className}` +
        (el.shadowRoot ? " (shadow)" : "")
      : null;
  }
  return {
    hostRect: rect(host),
    hostVis: hostCS.visibility,
    hostOpacity: hostCS.opacity,
    hostDisplay: hostCS.display,
    hostZ: hostCS.zIndex,
    hostPos: hostCS.position,
    hostPointer: hostCS.pointerEvents,
    hostStyleAttr: host.getAttribute("style"),
    stripRect: rect(strip),
    stripMaskImage: stripCS.maskImage || stripCS.webkitMaskImage,
    stripMaskSize: stripCS.maskSize || stripCS.webkitMaskSize,
    stripRectProp: stripCS.maskRepeat,
    tapeRect: rect(tape),
    tapeHeightStyle: tape.style.height,
    stripRectStored: JSON.parse(JSON.stringify(tape.parentElement && host.__x ? {} : {})),
    tickCount: tickInfo.length,
    tickInfo,
    hitTest: hit,
    status: host.dataset.ocStatus,
  };
});
console.log(JSON.stringify(report, null, 2));

// Screenshot of the right edge region for a visual check.
await page.screenshot({
  path: "/tmp/oc-rail-right.png",
  clip: { x: 1100, y: 0, width: 340, height: 900 },
});
console.log("screenshot: /tmp/oc-rail-right.png");
await ctx.close();
