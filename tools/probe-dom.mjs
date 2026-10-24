// Phase-1 probe: launch Edge with the extension, open a real session page,
// and report the DOM facts the extension depends on.
//
// Notes:
// - The opencode web UI crashes on session routes with a zh locale
//   (Intl.ListFormat TypeError), so we force en-US.
// - Session URLs are /server/<base64(serverURL)>/session/<id>.
//
// Usage: node tools/probe-dom.mjs [sessionID]
import { chromium } from "file:///Users/ganlu/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs";
import { discoverServe, authHeader } from "./serve.mjs";

const { port, pass } = discoverServe();
const BASE = `http://127.0.0.1:${port}`;
const AUTH = authHeader(pass);
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
    ...(process.env.NO_EXT
      ? []
      : [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]),
  ],
});
await ctx.setExtraHTTPHeaders(
  process.env.NO_HEADERS ? {} : { Authorization: AUTH },
);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.addInitScript(() => {
  window.__errs = [];
  window.addEventListener("error", (e) =>
    window.__errs.push(`err: ${e.message} @${e.filename}:${e.lineno}`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    window.__errs.push("rej: " + String(e.reason?.stack || e.reason)),
  );
});
page.on("console", (m) => console.log(`PAGE[${m.type()}]:`, m.text()));
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("response", (r) => {
  if (r.status() >= 400) console.log("HTTP", r.status(), r.url().slice(0, 120));
});

await page.goto(
  process.env.TARGET_PATH
    ? BASE + process.env.TARGET_PATH
    : `${BASE}/server/${SERVER_KEY}/session/${SID}`,
  { waitUntil: "domcontentloaded" },
);
await page.waitForTimeout(6000);

const report = await page.evaluate(() => {
  const scrollables = [...document.querySelectorAll("[data-scrollable]")];
  const withRows = scrollables.filter((el) =>
    el.querySelector("[data-timeline-row]"),
  );
  const host = document.getElementById("oc-rail-host");
  let shadowInfo = null;
  if (host && host.shadowRoot) {
    const sr = host.shadowRoot;
    shadowInfo = {
      strip: !!sr.querySelector(".strip"),
      ticks: sr.querySelectorAll(".tick").length,
      toc: !!sr.querySelector(".toc"),
      tocOpen: sr.querySelector(".toc")?.classList.contains("open") ?? null,
      tocRows: sr.querySelectorAll(".toc .row").length,
      count: sr.querySelector(".toc-count")?.textContent ?? null,
    };
  }
  return {
    href: location.href,
    scrollables: scrollables.length,
    withRows: withRows.length,
    userRows: document.querySelectorAll('[data-timeline-row="UserMessage"]')
      .length,
    rowTags: [
      ...new Set(
        [...document.querySelectorAll("[data-timeline-row]")].map(
          (e) => e.dataset.timelineRow,
        ),
      ),
    ],
    hostExists: !!host,
    ocStatus: host?.dataset.ocStatus ?? null,
    shadow: shadowInfo,
    bodyHead: document.body.innerText.slice(0, 300),
    windowErrors: window.__errs ?? null,
    textareas: [...document.querySelectorAll("textarea")].map((t) =>
      (t.value || "").slice(0, 600),
    ),
  };
});
console.log(JSON.stringify(report, null, 2));
await ctx.close();
