// End-to-end test for the OpenCode Prompt Rail extension (Phase 1: TOC).
//
// Requirements:
// - a live `opencode serve` (discovered via tools/serve.mjs)
// - Microsoft Edge (Chrome 137+ blocks --load-extension)
// - the opencode web UI must render session pages; it crashes under a zh
//   locale (Intl.ListFormat TypeError), hence locale en-US.
//
// Usage: node tools/e2e.mjs [sessionID]
import { chromium } from "file:///Users/ganlu/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs";
import { discoverServe, authHeader } from "./serve.mjs";

const { port, pass } = discoverServe();
const BASE = `http://127.0.0.1:${port}`;
const AUTH = authHeader(pass);
const SERVER_KEY = Buffer.from(BASE).toString("base64").replace(/=+$/, "");
const EXT = "/Users/ganlu/aitools/OpenChamber";
const PROFILE =
  "/private/var/folders/b1/g4qwv0rd11z_s0g92pv5byyr0000gp/T/opencode/oc-e2e-profile";
const SID = process.argv[2] || "ses_0f90e7674ffeEOToExMotNOqTI";
const TOC_SHOW_MS = 350; // > OC_TOC_SHOW_DELAY_MS (200) + transition
const TOC_HIDE_MS = 600; // > OC_TOC_HIDE_GRACE_MS (250) + transition

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  [${extra}]` : ""}`);
}

const ocConsoleErrors = [];

async function apiUserCount() {
  const res = await fetch(
    `${BASE}/api/session/${SID}/message`,
    { headers: { Authorization: AUTH } },
  );
  if (!res.ok) throw new Error("api HTTP " + res.status);
  const json = await res.json();
  const items = Array.isArray(json) ? json : json.data;
  return items.filter((m) => m.type === "user" || m.info?.role === "user")
    .length;
}

// Read the extension status mirror (cross-world readable).
async function status(page) {
  return page.evaluate(() => {
    const el = document.getElementById("oc-rail-host");
    return el ? JSON.parse(el.dataset.ocStatus) : null;
  });
}

const shadowEval = (page, fn) =>
  page.evaluate(fn, undefined).catch(() => null);

let ctx;
let page;
let failed = false;

try {
  const expected = await apiUserCount();
  console.log(`session ${SID}: ${expected} user messages`);

  ctx = await chromium.launchPersistentContext(PROFILE, {
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
  await ctx.setExtraHTTPHeaders({ Authorization: AUTH });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("[oc-rail]")) {
      ocConsoleErrors.push(m.text());
    }
  });
  page.on("pageerror", (e) => ocConsoleErrors.push("pageerror: " + e.message));

  await page.goto(`${BASE}/server/${SERVER_KEY}/session/${SID}`, {
    waitUntil: "domcontentloaded",
  });

  // ---- mount ----
  await page.waitForFunction(
    () => !!document.getElementById("oc-rail-host"),
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => {
      const el = document.getElementById("oc-rail-host");
      if (!el || !el.dataset.ocStatus) return false;
      return JSON.parse(el.dataset.ocStatus).tickCount > 0;
    },
    null,
    { timeout: 15000 },
  );
  // updatePosition only runs once the timeline scroller exists (attach at
  // mount, then the1s watchdog) — wait for the host to be placed, otherwise
  // boundingBox() returns the un-positioned default box (0-sized, bottom-left).
  await page.waitForFunction(
    () => {
      const el = document.getElementById("oc-rail-host");
      return !!el && el.style.left !== "" && el.style.height !== "";
    },
    null,
    { timeout: 15000 },
  );
  // Active turn needs rendered rows + a positioned scroller too.
  await page.waitForFunction(
    () => {
      const el = document.getElementById("oc-rail-host");
      if (!el || !el.dataset.ocStatus) return false;
      return JSON.parse(el.dataset.ocStatus).activeIndex >= 0;
    },
    null,
    { timeout: 15000 },
  );
  let st = await status(page);
  check("rail mounted", st?.mounted === true);
  check("tickCount == API user messages", st?.tickCount === expected, `got ${st?.tickCount}, want ${expected}`);

  // ---- structure ----
  const dom = await page.evaluate(() => {
    const host = document.getElementById("oc-rail-host");
    const sr = host.shadowRoot;
    const rows = [...sr.querySelectorAll(".toc .row")];
    const ticks = [...sr.querySelectorAll(".tick")];
    return {
      ticks: ticks.length,
      tickTitles: ticks.filter((t) => t.title).length,
      tocRows: rows.length,
      tocCount: sr.querySelector(".toc-count")?.textContent ?? "",
      tocOpen: sr.querySelector(".toc")?.classList.contains("open") ?? false,
      activeRows: sr.querySelectorAll(".row.active").length,
      withScroller: [...document.querySelectorAll("[data-scrollable]")].filter(
        (el) => el.querySelector("[data-timeline-row]"),
      ).length,
      userRows: document.querySelectorAll('[data-timeline-row="UserMessage"]')
        .length,
    };
  });
  check("timeline scroller found", dom.withScroller === 1, `got ${dom.withScroller}`);
  check("user rows rendered", dom.userRows >= 1, `got ${dom.userRows}`);
  check(
    "ticks rendered == min(30, expected)",
    dom.ticks === Math.min(30, expected),
    `got ${dom.ticks}`,
  );
  check("TOC rows == expected", dom.tocRows === expected, `got ${dom.tocRows}`);
  check("TOC count label", dom.tocCount.includes(String(expected)), dom.tocCount);
  check("TOC initially closed", dom.tocOpen === false);
  check("no native title tooltips on ticks", dom.tickTitles === 0, `${dom.tickTitles} titles`);
  check("active row highlighted", dom.activeRows === 1, `got ${dom.activeRows}`);
  check("activeIndex >= 0", st.activeIndex >= 0, `got ${st.activeIndex}`);

  // ---- hover strip -> TOC opens ----
  const strip = page.locator("#oc-rail-host .strip");
  const stripBox = await strip.boundingBox();
  check("strip has geometry", !!stripBox, JSON.stringify(stripBox));
  await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
  await page.waitForTimeout(TOC_SHOW_MS);
  st = await status(page);
  let open = await shadowEval(page, () =>
    document.getElementById("oc-rail-host").shadowRoot
      .querySelector(".toc")
      .classList.contains("open"),
  );
  check("TOC opens on strip hover", open === true && st.tocVisible === true, `open=${open} tocVisible=${st.tocVisible}`);

  // ---- hover first TOC row: expands + tick highlights ----
  const row0 = page.locator("#oc-rail-host .toc .row").first();
  const rowBox = await row0.boundingBox();
  check("TOC row0 visible", !!rowBox, JSON.stringify(rowBox));
  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
  await page.waitForTimeout(200);
  const hoverInfo = await page.evaluate(() => {
    const sr = document.getElementById("oc-rail-host").shadowRoot;
    const row = sr.querySelector(".toc .row");
    const full = row.querySelector(".full");
    return {
      hovered: row.classList.contains("hover"),
      fullLen: (full.textContent || "").length,
      fullShown: getComputedStyle(full).display !== "none",
      hoveredTicks: sr.querySelectorAll(".tick.hovered").length,
      hoverIndex: JSON.parse(document.getElementById("oc-rail-host").dataset.ocStatus)
        .hoverIndex,
    };
  });
  check("row0 hover class", hoverInfo.hovered === true);
  check(
    "row0 expanded preview non-empty",
    hoverInfo.fullShown && hoverInfo.fullLen > 0,
    `len=${hoverInfo.fullLen} shown=${hoverInfo.fullShown}`,
  );
  check("a tick is highlighted", hoverInfo.hoveredTicks === 1, `got ${hoverInfo.hoveredTicks}`);
  check("hoverIndex == 0", hoverInfo.hoverIndex === 0, `got ${hoverInfo.hoverIndex}`);

  // ---- far row (index 0 while active is last) still highlights a tick ----
  // (window-shift logic: window must contain hoverIndex)
  const windowInfo = await page.evaluate(() => {
    const sr = document.getElementById("oc-rail-host").shadowRoot;
    const idxs = [...sr.querySelectorAll(".tick")].map((t) => Number(t.dataset.index));
    return { min: Math.min(...idxs), max: Math.max(...idxs), count: idxs.length };
  });
  check(
    "tick window includes hovered index 0",
    windowInfo.min <= 0 && windowInfo.max >= 0,
    JSON.stringify(windowInfo),
  );

  // ---- click row0 -> jumps ----
  // Re-measure: hovering row0 may have expanded it and scrolled the list.
  const clickBox = await row0.boundingBox();
  const beforeJump = st.jumpCount;
  await page.mouse.click(clickBox.x + clickBox.width / 2, clickBox.y + Math.min(10, clickBox.height / 2));
  await page.waitForTimeout(500);
  st = await status(page);
  const hash = await page.evaluate(() => location.hash);
  check("click increments jumpCount", st.jumpCount > beforeJump, `got ${st.jumpCount} > ${beforeJump}`);
  check("click sets #message- hash", hash.startsWith("#message-"), hash || "(empty)");
  open = await shadowEval(page, () =>
    document.getElementById("oc-rail-host").shadowRoot
      .querySelector(".toc")
      .classList.contains("open"),
  );
  check("TOC stays open after jump click", open === true);

  // ---- active row visible in the TOC list viewport ----
  const activeVisible = await page.evaluate(() => {
    const sr = document.getElementById("oc-rail-host").shadowRoot;
    const list = sr.querySelector(".toc-list");
    const row = sr.querySelector(".toc .row.active");
    if (!row) return { ok: false, reason: "no active row" };
    const lr = list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    return {
      ok: rr.top >= lr.top - 1 && rr.bottom <= lr.bottom + 1,
      idx: Number(row.dataset.index),
      activeIndex: JSON.parse(document.getElementById("oc-rail-host").dataset.ocStatus)
        .activeIndex,
    };
  });
  check(
    "active row scrolled into TOC viewport",
    activeVisible.ok,
    JSON.stringify(activeVisible),
  );

  // ---- leave -> TOC closes ----
  await page.mouse.move(200, 400);
  await page.waitForTimeout(TOC_HIDE_MS);
  st = await status(page);
  open = await shadowEval(page, () =>
    document.getElementById("oc-rail-host").shadowRoot
      .querySelector(".toc")
      .classList.contains("open"),
  );
  check("TOC closes after leaving", open === false && st.tocVisible === false, `open=${open}`);

  // ---- reopen then Escape ----
  await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
  await page.waitForTimeout(TOC_SHOW_MS);
  open = await shadowEval(page, () =>
    document.getElementById("oc-rail-host").shadowRoot
      .querySelector(".toc")
      .classList.contains("open"),
  );
  check("TOC reopens on re-hover", open === true);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  st = await status(page);
  open = await shadowEval(page, () =>
    document.getElementById("oc-rail-host").shadowRoot
      .querySelector(".toc")
      .classList.contains("open"),
  );
  check("Escape closes TOC", open === false && st.tocVisible === false);

  // ---- clean state ----
  st = await status(page);
  check("no extension errors", (st.errors?.length ?? -1) === 0, JSON.stringify(st.errors?.slice(0, 2)));
  check("no [oc-rail] console errors", ocConsoleErrors.length === 0, ocConsoleErrors[0] || "");
} catch (err) {
  failed = true;
  console.error("E2E aborted:", err);
} finally {
  if (ctx) await ctx.close().catch(() => {});
}

const fails = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - fails.length}/${results.length} checks passed` +
    (fails.length ? ` — FAILURES: ${fails.map((f) => f.name).join(", ")}` : ""),
);
process.exit(failed || fails.length ? 1 : 0);
