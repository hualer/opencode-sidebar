// DOM structure of the remote deployment's timeline: where the rows live and
// what the scroll container is (the local build uses [data-scrollable] +
// [data-timeline-row]; this build appears not to).
// Usage: node tools/probe-remote-dom.mjs [url]
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
await page.goto(URL_, { waitUntil: "domcontentloaded" });

// Wait until the conversation text actually shows up.
await page
  .waitForFunction(() => document.body.innerText.length > 1500, null, {
    timeout: 30000,
  })
  .catch(() => console.log("(timeout waiting for content)"));
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const desc = (e) => {
    if (!e) return null;
    return (
      e.tagName +
      " " +
      [...e.attributes]
        .map((a) => `${a.name}="${String(a.value).slice(0, 50)}"`)
        .join(" ")
    );
  };
  const chain = (e) => {
    const a = [];
    while (e && a.length < 14) {
      a.push(
        desc(e) +
          `  (box ${Math.round(e.getBoundingClientRect().width)}x${Math.round(
            e.getBoundingClientRect().height,
          )} sh=${e.scrollHeight})`,
      );
      e = e.parentElement;
    }
    return a;
  };
  // Anchor: an element whose own text mentions content we saw in the page.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = null;
  while ((node = walker.nextNode())) {
    if (/交付总结|实施完成|虚拟教练/.test(node.textContent || "")) break;
  }
  const anchor = node ? node.parentElement : null;

  const dataEls = [...document.querySelectorAll("*")].filter((e) =>
    [...e.attributes].some((a) => /^data-/.test(a.name)),
  );
  const dataAttrs = {};
  for (const e of dataEls)
    for (const a of e.attributes)
      if (/^data-/.test(a.name))
        dataAttrs[a.name] = (dataAttrs[a.name] || 0) + 1;

  const scrollers = [...document.querySelectorAll("*")]
    .filter((e) => {
      const s = getComputedStyle(e);
      return (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        e.scrollHeight > e.clientHeight + 40
      );
    })
    .slice(0, 10)
    .map((e) => desc(e) + ` sh=${e.scrollHeight} ch=${e.clientHeight}`);

  return {
    bodyLen: document.body.innerText.length,
    timelineRows: document.querySelectorAll("[data-timeline-row]").length,
    scrollables: document.querySelectorAll("[data-scrollable]").length,
    dataAttrs,
    anchorChain: chain(anchor),
    scrollers,
  };
});
console.log(JSON.stringify(out, null, 1));
await ctx.close();
