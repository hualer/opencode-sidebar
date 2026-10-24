"use strict";
// The rail itself: Shadow-DOM host fixed to the right edge of the timeline
// scroll container, evenly-pitched ticks (max 30 visible, windowed around the
// active turn), whole-strip hover maps mouse Y -> nearest tick, click jumps.
//
// Hovering the strip also opens a TOC flyout on the left: one row per user
// message for the *whole* session (not windowed), the hovered row expands to
// a multi-line preview (replacing the old native `title` tooltip).

const OC_MAX_VISIBLE_TICKS = 30;
const OC_TICK_PITCH_PX = 12;
const OC_STRIP_WIDTH_PX = 24;
const OC_STRIP_RIGHT_INSET_PX = 6;

const OC_TOC_SHOW_DELAY_MS = 200;
const OC_TOC_HIDE_GRACE_MS = 250;
const OC_TOC_WIDTH_PX = 320;
const OC_TOC_ROW_CHARS = 60; // one-line preview inside a list row
const OC_TOC_EXPANDED_CHARS = 600; // hovered row expansion cap
const OC_TOC_TIME_FLOOR_MS = 1e12; // below this, timestamps are seconds

function ocTruncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Formats an epoch value (ms, or seconds for older payloads) as "HH:MM" for
// today, "M-D HH:MM" otherwise. Empty string when unknown.
function ocFormatTime(ms) {
  if (ms == null) return "";
  if (typeof ms !== "number") return "";
  if (ms > 0 && ms < OC_TOC_TIME_FLOOR_MS) ms *= 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const hhmm =
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === new Date().toDateString()) return hhmm;
  return d.getMonth() + 1 + "-" + d.getDate() + " " + hhmm;
}

function ocFindScroller() {
  const candidates = [...document.querySelectorAll("[data-scrollable]")];
  const withRows = candidates.filter((el) =>
    el.querySelector("[data-timeline-row]"),
  );
  if (withRows.length) {
    // Prefer the largest such container (the timeline viewport).
    withRows.sort(
      (a, b) =>
        b.getBoundingClientRect().height -
        a.getBoundingClientRect().height,
    );
    return withRows[0];
  }
  return null;
}

// Height of the sticky header overlaying the top of the timeline viewport.
// Rows ending above its bottom edge are hidden behind it and must not count
// as "visible" when computing the active turn (adjacent rows can sit only
// a few px apart when consecutive user messages have no assistant reply between
// them).
function ocStickyInset(scroller, scrollerTop) {
  const stickyEls = scroller.querySelectorAll('[class*="sticky"]');
  for (const el of stickyEls) {
    const cs = getComputedStyle(el);
    if (cs.position !== "sticky") continue;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.top - scrollerTop) > 4) continue; // not pinned at the top
    if (r.height <= 0 || r.height > 200) continue;
    return r.height;
  }
  return 0;
}

// Mirrors the page's background luminance onto host[data-oc-theme] so the
// shadow styles can pick ink that is actually visible: the tick palette was
// designed for the opencode dark theme, where a white "active" tick reads
// clearly — on the light theme (body rgb(250,250,250)) that same tick is
// white-on-white and disappears entirely.
function ocSyncTheme(host) {
  let el = document.body || document.documentElement;
  let lum = 1;
  while (el) {
    const m = getComputedStyle(el).backgroundColor.match(
      /rgba?\(([^)]+)\)/,
    );
    if (m) {
      const [r, g, b, a = "1"] = m[1].split(/[,\s/]+/).filter(Boolean);
      if (Number(a) > 0.05) {
        lum = (0.2126 * Number(r) + 0.7152 * Number(g) + 0.0722 * Number(b)) / 255;
        break;
      }
    }
    el = el.parentElement;
  }
  const theme = lum > 0.5 ? "light" : "dark";
  if (host.dataset.ocTheme !== theme) host.dataset.ocTheme = theme;
}

function ocCreateRail() {
  const host = document.createElement("div");
  host.id = "oc-rail-host";
  host.style.cssText =
    "position:fixed;z-index:100;pointer-events:none;visibility:hidden;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .strip {
        position: absolute; top: 0; right: 0;
        width: ${OC_STRIP_WIDTH_PX}px; height: 100%;
        pointer-events: auto; cursor: pointer;
        -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 8%, #000 92%, transparent 100%);
        mask-image: linear-gradient(to bottom, transparent 0, #000 8%, #000 92%, transparent 100%);
      }
      .tape { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
      .tick {
        position: absolute; left: 50%;
        width: 10px; height: 2px; margin-left: -5px;
        background: rgba(140, 150, 162, 0.55);
        border-radius: 2px;
        transition: width 0.12s ease, height 0.12s ease,
          margin-left 0.12s ease, background 0.12s ease;
      }
      .tick.active {
        width: 14px; height: 3px; margin-left: -7px;
        background: rgba(255, 255, 255, 0.92);
      }
      .tick.hovered {
        width: 20px; height: 3px; margin-left: -10px;
        background: rgba(96, 165, 250, 0.95);
      }

      /* Light page background: the default palette (white active tick, 55%
         grey normal ticks) is nearly invisible on rgb(250,250,250). */
      :host([data-oc-theme="light"]) .tick {
        background: rgba(71, 85, 105, 0.8);
      }
      :host([data-oc-theme="light"]) .tick.active {
        background: rgba(15, 23, 42, 0.92);
      }
      :host([data-oc-theme="light"]) .tick.hovered {
        background: rgba(37, 99, 235, 0.95);
      }

      /* ---- TOC flyout (opens on strip hover, left of the rail) ---- */
      /* Top-anchored on purpose: a vertically centered box would shift every
         row up/down as hovered rows expand, making the panel jitter under the
         cursor. Top anchoring keeps row positions stable; growth goes down. */
      .toc {
        position: absolute; right: 100%; top: 0;
        margin-right: 8px;
        width: ${OC_TOC_WIDTH_PX}px;
        max-height: 100%;
        box-sizing: border-box;
        display: flex; flex-direction: column;
        pointer-events: auto;
        background: rgba(22, 24, 28, 0.97);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
        color: #d7dae0;
        font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        overflow: hidden;
        visibility: hidden; opacity: 0;
        transition: opacity 0.12s ease, visibility 0s linear 0.12s;
        -webkit-font-smoothing: antialiased;
      }
      .toc.open {
        visibility: visible; opacity: 1;
        transition: opacity 0.12s ease;
      }
      .toc-head {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 8px;
        padding: 8px 10px 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
        color: #9aa2ad; font-size: 11px; letter-spacing: 0.02em;
        flex: none;
      }
      .toc-head .toc-title { font-weight: 600; color: #b6bdc7; }
      .toc-list {
        overflow-y: auto; min-height: 0;
        padding: 4px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
      }
      .toc-list::-webkit-scrollbar { width: 6px; }
      .toc-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.18); border-radius: 3px;
      }
      .row {
        padding: 4px 6px; border-radius: 6px;
        cursor: pointer;
        border-left: 2px solid transparent;
      }
      .row-line {
        display: flex; align-items: baseline; gap: 6px;
        white-space: nowrap; overflow: hidden;
      }
      .row .n {
        flex: none; color: #6b727d; font-variant-numeric: tabular-nums;
        font-size: 10.5px; min-width: 3ch;
      }
      .row .t {
        flex: none; color: #6b727d; font-variant-numeric: tabular-nums;
        font-size: 10.5px;
      }
      .row .p { overflow: hidden; text-overflow: ellipsis; color: #c3c9d1; }
      .row.active {
        background: rgba(255, 255, 255, 0.07);
        border-left-color: rgba(255, 255, 255, 0.55);
      }
      .row.active .p { color: #eef1f5; }
      .row.hover {
        background: rgba(96, 165, 250, 0.14);
        border-left-color: rgba(96, 165, 250, 0.9);
      }
      .row .full {
        display: none;
        margin-top: 5px;
        white-space: pre-wrap; word-break: break-word;
        color: #aeb6c0; font-size: 11.5px; line-height: 1.5;
        max-height: calc(11.5px * 1.5 * 6 + 4px);
        overflow: hidden;
      }
      .row.hover .full { display: block; }
      .row.hover .full:empty { display: none; }
    </style>
    <div class="strip" part="strip"><div class="tape"></div></div>
    <div class="toc" part="toc">
      <div class="toc-head">
        <span class="toc-title">目录</span>
        <span class="toc-count"></span>
      </div>
      <div class="toc-list"></div>
    </div>
  `;
  document.documentElement.appendChild(host);

  const strip = shadow.querySelector(".strip");
  const tape = shadow.querySelector(".tape");
  const toc = shadow.querySelector(".toc");
  const tocList = shadow.querySelector(".toc-list");
  const tocCount = shadow.querySelector(".toc-count");

  const rail = {
    host,
    strip,
    tape,
    toc,
    tocList,
    tocCount,
    messages: [], // [{id, preview, time}]
    activeIndex: -1,
    hoverIndex: -1,
    tocVisible: false,
    showTimer: 0,
    hideTimer: 0,
    /** rendered tick viewport Y positions: [{index, y}] */
    tickY: [],
    /** false until the host has been placed on the timeline (updatePosition) */
    positioned: false,
    destroyed: false,
  };

  // ---------- TOC: visibility ----------
  const scrollRowIntoView = (row) => {
    if (!row) return;
    const lr = tocList.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    // Manual scroll instead of scrollIntoView: it must never touch page
    // scroll ancestors (the host is position:fixed).
    if (rr.top < lr.top) tocList.scrollTop -= lr.top - rr.top;
    else if (rr.bottom > lr.bottom) tocList.scrollTop += rr.bottom - lr.bottom;
  };

  rail.showToc = () => {
    if (rail.destroyed || rail.tocVisible || !rail.messages.length) return;
    rail.tocVisible = true;
    toc.classList.add("open");
    OC_RAIL_STATUS.tocVisible = true;
    rail.syncTocActive();
    ocPublishStatus();
  };

  rail.hideToc = () => {
    if (!rail.tocVisible) return;
    rail.tocVisible = false;
    toc.classList.remove("open");
    OC_RAIL_STATUS.tocVisible = false;
    ocPublishStatus();
  };

  const scheduleShow = () => {
    if (rail.showTimer) return;
    rail.showTimer = setTimeout(() => {
      rail.showTimer = 0;
      rail.showToc();
    }, OC_TOC_SHOW_DELAY_MS);
  };

  const scheduleHide = () => {
    if (rail.hideTimer) return;
    rail.hideTimer = setTimeout(() => {
      rail.hideTimer = 0;
      rail.hideToc();
    }, OC_TOC_HIDE_GRACE_MS);
  };

  const cancelHide = () => {
    if (!rail.hideTimer) return;
    clearTimeout(rail.hideTimer);
    rail.hideTimer = 0;
  };

  const cancelShow = () => {
    if (!rail.showTimer) return;
    clearTimeout(rail.showTimer);
    rail.showTimer = 0;
  };

  // ---------- TOC: row list ----------
  rail.renderToc = () => {
    tocList.innerHTML = "";
    const frag = document.createDocumentFragment();
    rail.messages.forEach((msg, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.index = String(i);

      const line = document.createElement("div");
      line.className = "row-line";
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = "#" + (i + 1);
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = ocFormatTime(msg.time);
      const p = document.createElement("span");
      p.className = "p";
      p.textContent = ocTruncate(msg.preview, OC_TOC_ROW_CHARS);
      line.append(n, t, p);

      const full = document.createElement("div");
      full.className = "full";

      row.append(line, full);
      frag.appendChild(row);
    });
    tocList.appendChild(frag);
    tocCount.textContent = rail.messages.length + " 条";
    rail.syncTocActive(false);
    rail.syncTocHover();
  };

  rail.syncTocActive = (scroll) => {
    const prev = tocList.querySelector(".row.active");
    if (prev) prev.classList.remove("active");
    if (rail.activeIndex < 0) return;
    const row = tocList.children[rail.activeIndex];
    if (!row) return;
    row.classList.add("active");
    if (scroll !== false && rail.tocVisible) scrollRowIntoView(row);
  };

  rail.syncTocHover = () => {
    const prev = tocList.querySelector(".row.hover");
    if (prev) prev.classList.remove("hover");
    if (rail.hoverIndex < 0) return;
    const row = tocList.children[rail.hoverIndex];
    if (!row) return;
    row.classList.add("hover");
    // Lazy-fill the expanded preview (up to 600 chars) on first hover.
    const full = row.querySelector(".full");
    const msg = rail.messages[rail.hoverIndex];
    if (full && msg && !full.textContent) {
      full.textContent = ocTruncate(msg.preview, OC_TOC_EXPANDED_CHARS);
    }
    scrollRowIntoView(row);
  };

  rail.destroy = () => {
    rail.destroyed = true;
    cancelShow();
    cancelHide();
    document.removeEventListener("keydown", onKeyDown);
    host.remove();
  };

  rail.updatePosition = (scrollerRect) => {
    if (rail.destroyed) return;
    ocSyncTheme(host);
    host.style.left =
      Math.round(
        scrollerRect.right - OC_STRIP_RIGHT_INSET_PX - OC_STRIP_WIDTH_PX,
      ) + "px";
    host.style.top = Math.round(scrollerRect.top) + "px";
    host.style.height = Math.round(scrollerRect.height) + "px";
    host.style.width = OC_STRIP_WIDTH_PX + "px";
    rail.stripRect = {
      top: scrollerRect.top,
      height: scrollerRect.height,
    };
    // First placement: the rail may already hold messages (render() ran at
    // mount) but must stay hidden until it sits on the timeline — a fixed
    // host without left/top renders at its static position, i.e. below the
    // fold, which looks exactly like "the ticks are gone".
    if (!rail.positioned) {
      rail.positioned = true;
      if (rail.messages.length) rail.setVisible(true);
    }
  };

  rail.setVisible = (visible) => {
    host.style.visibility = visible ? "visible" : "hidden";
    if (!visible) rail.hideToc();
  };

  rail.setMessages = (messages) => {
    rail.messages = messages;
    OC_RAIL_STATUS.tickCount = messages.length;
    rail.renderToc();
    // Active may have shifted if the list changed identity.
    if (rail.activeIndex >= messages.length) {
      rail.setActive(messages.length - 1);
    } else {
      rail.render();
      rail.syncTocActive(false);
      rail.syncTocHover();
    }
    if (!messages.length) rail.hideToc();
    ocPublishStatus();
  };

  rail.setActive = (index) => {
    if (index === rail.activeIndex) return;
    rail.activeIndex = index;
    OC_RAIL_STATUS.activeIndex = index;
    rail.render();
    rail.syncTocActive();
    ocPublishStatus();
  };

  rail.setHover = (index) => {
    if (index === rail.hoverIndex) return;
    rail.hoverIndex = index;
    OC_RAIL_STATUS.hoverIndex = index;
    rail.render();
    rail.syncTocHover();
    ocPublishStatus();
  };

  rail.render = () => {
    if (rail.destroyed) return;
    const total = rail.messages.length;
    tape.innerHTML = "";
    rail.tickY = [];
    if (total === 0) {
      rail.setVisible(false);
      return;
    }
    const visible = Math.min(OC_MAX_VISIBLE_TICKS, total);
    const half = Math.floor(visible / 2);
    // Window centers on the active turn, but must also contain the hovered
    // index (a TOC row can be far outside the active window). When both can't
    // fit, hover wins — it is transient, active returns on hover end.
    let start;
    if (rail.hoverIndex >= 0 && rail.hoverIndex < total) {
      start = rail.hoverIndex - half;
      if (rail.activeIndex >= 0) {
        if (rail.activeIndex < start) start = rail.activeIndex;
        if (rail.activeIndex >= start + visible) {
          start = rail.activeIndex - visible + 1;
        }
        if (rail.hoverIndex < start) start = rail.hoverIndex;
        if (rail.hoverIndex >= start + visible) {
          start = rail.hoverIndex - visible + 1;
        }
      }
    } else {
      start = rail.activeIndex - half;
    }
    start = Math.max(0, Math.min(start, total - visible));
    const tapeHeight = visible * OC_TICK_PITCH_PX;
    // The ticks are position:absolute, so the tape box would collapse to 0
    // height and CSS centering would break. Give it an explicit height so the
    // rendered positions match originY used by the Y->tick hit test.
    tape.style.height = tapeHeight + "px";
    const originY = (rail.stripRect?.height ?? 0) / 2 - tapeHeight / 2;

    const frag = document.createDocumentFragment();
    for (let i = start; i < start + visible; i++) {
      const tick = document.createElement("div");
      tick.className =
        "tick" +
        (i === rail.activeIndex ? " active" : "") +
        (i === rail.hoverIndex ? " hovered" : "");
      tick.style.top = (i - start) * OC_TICK_PITCH_PX + "px";
      tick.dataset.index = String(i);
      // No native `title` tooltip: the TOC flyout provides a richer preview.
      frag.appendChild(tick);
      rail.tickY.push({
        index: i,
        y: originY + (i - start) * OC_TICK_PITCH_PX + 1,
      });
    }
    tape.appendChild(frag);
    // Never show ticks before the first updatePosition placed the host.
    rail.setVisible(rail.positioned);
  };

  // ---- whole-strip hover mapping + click ----
  const nearestFromEvent = (clientY) => {
    if (!rail.tickY.length || !rail.stripRect) return -1;
    const localY = clientY - rail.stripRect.top;
    let best = -1;
    let bestDist = Infinity;
    for (const t of rail.tickY) {
      const d = Math.abs(t.y - localY);
      if (d < bestDist) {
        bestDist = d;
        best = t.index;
      }
    }
    return best;
  };

  strip.addEventListener("mousemove", (e) => {
    rail.setHover(nearestFromEvent(e.clientY));
  });
  strip.addEventListener("mouseenter", () => {
    cancelHide();
    scheduleShow();
  });
  strip.addEventListener("mouseleave", () => {
    cancelShow();
    rail.setHover(-1);
    if (rail.tocVisible) scheduleHide();
  });
  strip.addEventListener("click", (e) => {
    const idx = nearestFromEvent(e.clientY);
    if (idx < 0) return;
    const msg = rail.messages[idx];
    if (!msg) return;
    ocJumpTo(msg.id);
    rail.setHover(-1);
  });

  // ---- TOC: hover sync + click-to-jump ----
  toc.addEventListener("mouseenter", cancelHide);
  toc.addEventListener("mouseleave", scheduleHide);
  tocList.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    rail.setHover(Number(row.dataset.index));
  });
  tocList.addEventListener("mouseleave", () => rail.setHover(-1));
  tocList.addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    const idx = Number(row.dataset.index);
    const msg = rail.messages[idx];
    if (!msg) return;
    // Panel stays open so the user can chain jumps; active row follows.
    ocJumpTo(msg.id);
    rail.setHover(idx);
  });

  // ---- Esc closes the TOC ----
  const onKeyDown = (e) => {
    if (e.key !== "Escape") return;
    cancelShow();
    if (rail.tocVisible) rail.hideToc();
  };
  document.addEventListener("keydown", onKeyDown);

  rail.render();
  rail.renderToc();
  return rail;
}
