"use strict";
// Debug/status namespace. Loaded first; every later file shares this
// content-script global lexical scope (same rules as multiple <script> tags).
//
// Status is mirrored onto the host element's data-oc-status attribute so it is
// readable from the page's main world (CDP evaluate / dev loop) even though
// content scripts run in an isolated world.

const OC_RAIL_STATUS = {
  mounted: false,
  sessionID: null,
  tickCount: 0,
  activeIndex: -1,
  hoverIndex: -1,
  tocVisible: false,
  jumpCount: 0,
  lastError: null,
  errors: [],
};

window.__ocRailStatus = OC_RAIL_STATUS;

function ocLog(...args) {
  console.log("[oc-rail]", ...args);
}

function ocErr(where, err) {
  const msg = where + ": " + ((err && err.stack) || err);
  console.error("[oc-rail]", msg);
  OC_RAIL_STATUS.lastError = msg;
  OC_RAIL_STATUS.errors.push(msg);
  if (OC_RAIL_STATUS.errors.length > 50) OC_RAIL_STATUS.errors.shift();
}

function ocPublishStatus() {
  const host = document.getElementById("oc-rail-host");
  if (!host) return;
  try {
    host.dataset.ocStatus = JSON.stringify(OC_RAIL_STATUS);
  } catch {
    /* dataset must stay a string; ignore */
  }
}
