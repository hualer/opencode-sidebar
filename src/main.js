"use strict";
// Orchestration: URL/session watch, rail lifecycle, recompute triggers
// (scroll / ResizeObserver / MutationObserver), message list refresh.

(function ocMain() {
  if (window.__OC_RAIL_LOADED) return;
  window.__OC_RAIL_LOADED = true;

  let rail = null;
  let currentSession = null;
  let messages = []; // cached [{id, preview}]
  let userRowSig = ""; // joined visible user row ids, change -> refetch
  let activeRaf = 0;
  let refetchTimer = 0;
  let scrollerObserved = null;
  let resizeObs = null;
  let mutationObs = null;
  let scrollHandler = null;
  let readyWait = 0;

  // ---------- active turn detection ----------
  function recomputeActive() {
    activeRaf = 0;
    if (!rail) return;
    const scroller = ocFindScroller();
    if (!scroller || !scroller.isConnected) return;
    const sRect = scroller.getBoundingClientRect();
    const rows = [
      ...scroller.querySelectorAll('[data-timeline-row="UserMessage"]'),
    ];
    const atBottom =
      scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight) <
      24;
    let activeId = null;
    if (atBottom && messages.length) {
      // Match the app's own semantics: scrolled to the bottom means the
      // "active" message is the latest one.
      activeId = messages[messages.length - 1].id;
    } else if (rows.length) {
      // Topmost user row actually visible below the sticky header. Fallbacks:
      // (2) any row intersecting the viewport, (3) the first rendered row.
      const inset = ocStickyInset(scroller, sRect.top);
      const rowBottom = (row) => row.getBoundingClientRect().bottom;
      activeId =
        rows.find((row) => rowBottom(row) > sRect.top + inset)?.dataset
          .messageId ??
        rows.find((row) => rowBottom(row) > sRect.top + 8)?.dataset
          .messageId ??
        rows[0].dataset.messageId;
    }
    let idx = -1;
    if (activeId) {
      idx = messages.findIndex((m) => m.id === activeId);
      if (idx === -1) {
        // Cache is stale (e.g. history loaded that we never fetched).
        scheduleRefetch("unknown-active-row");
      }
    } else if (messages.length) {
      idx = messages.length - 1; // no rows rendered (blank?) -> last
    }
    if (idx !== rail.activeIndex) rail.setActive(idx);
  }

  function scheduleActive() {
    if (activeRaf) return;
    activeRaf = requestAnimationFrame(recomputeActive);
  }

  // ---------- geometry ----------
  function updateGeometry() {
    if (!rail) return;
    const scroller = ocFindScroller();
    if (!scroller || !scroller.isConnected) {
      rail.setVisible(false);
      return;
    }
    rail.updatePosition(scroller.getBoundingClientRect());
    // Restore visibility here: setVisible(false) (this branch and the
    // watchdog's "no scroller" branch) is only ever undone inside render(),
    // which runs on message / active / hover changes. A single 1s window in
    // which the timeline renders no [data-timeline-row] (remount, virtualizer
    // rebuild, resize) therefore used to leave the rail invisible for good —
    // no scroll or hover could bring it back while activeIndex stayed put.
    if (rail.messages.length) rail.setVisible(true);
    scheduleActive();
  }

  // ---------- message list ----------
  async function refetch(reason) {
    if (!currentSession || !rail) return;
    try {
      const list = await ocFetchUserMessages(currentSession);
      messages = list;
      rail.setMessages(list);
      ocLog("messages", list.length, "(" + reason + ")");
      scheduleActive();
    } catch (err) {
      ocErr("refetch:" + reason, err);
    }
  }

  function scheduleRefetch(reason) {
    if (refetchTimer) return;
    refetchTimer = setTimeout(() => {
      refetchTimer = 0;
      refetch(reason);
    }, 600);
  }

  function currentRowSignature() {
    const scroller = ocFindScroller();
    if (!scroller) return "";
    return [
      ...scroller.querySelectorAll('[data-timeline-row="UserMessage"]'),
    ]
      .map((r) => r.dataset.messageId)
      .join(",");
  }

  // ---------- observers ----------
  function attachScroller(scroller) {
    detachScroller();
    scrollerObserved = scroller;
    scrollHandler = () => scheduleActive();
    scroller.addEventListener("scroll", scrollHandler, { passive: true });

    resizeObs = new ResizeObserver(() => updateGeometry());
    resizeObs.observe(scroller);

    let sigTimer = 0;
    mutationObs = new MutationObserver(() => {
      scheduleActive();
      const sig = currentRowSignature();
      if (sig !== userRowSig) {
        userRowSig = sig;
        // Only refetch when a rendered user row carries an id the cache does
        // not know (i.e. a genuinely new message) — plain virtualizer window
        // shifts during scrolling re-use ids already in the cache.
        const known = new Set(messages.map((m) => m.id));
        const hasUnknown = sig
          .split(",")
          .some((id) => id && !known.has(id));
        if (hasUnknown) {
          clearTimeout(sigTimer);
          sigTimer = setTimeout(() => refetch("new-user-row"), 500);
        }
      }
    });
    mutationObs.observe(scroller, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }

  function detachScroller() {
    if (scrollerObserved && scrollHandler) {
      scrollerObserved.removeEventListener("scroll", scrollHandler);
    }
    if (resizeObs) resizeObs.disconnect();
    if (mutationObs) mutationObs.disconnect();
    scrollerObserved = null;
    resizeObs = null;
    mutationObs = null;
    scrollHandler = null;
  }

  // ---------- mount / teardown ----------
  async function mount(sessionID) {
    teardown(false);
    currentSession = sessionID;
    OC_RAIL_STATUS.sessionID = sessionID;
    ocLog("mount", sessionID);
    rail = ocCreateRail();
    OC_RAIL_STATUS.mounted = true;
    OC_RAIL_STATUS.errors = [];
    await refetch("mount");

    const scroller = ocFindScroller();
    if (scroller) {
      attachScroller(scroller);
      updateGeometry();
    } else {
      // Timeline not rendered yet (loading); retry via watchdog.
      readyWait = setTimeout(() => {
        const s = ocFindScroller();
        if (s && rail) {
          attachScroller(s);
          updateGeometry();
        }
      }, 800);
    }
    window.addEventListener("resize", updateGeometry);
    ocPublishStatus();
  }

  function teardown(clearSession) {
    clearTimeout(readyWait);
    clearTimeout(refetchTimer);
    refetchTimer = 0;
    detachScroller();
    if (rail) {
      rail.destroy();
      rail = null;
    }
    window.removeEventListener("resize", updateGeometry);
    OC_RAIL_STATUS.mounted = false;
    if (clearSession) {
      currentSession = null;
      messages = [];
      userRowSig = "";
      OC_RAIL_STATUS.sessionID = null;
      OC_RAIL_STATUS.tickCount = 0;
      OC_RAIL_STATUS.activeIndex = -1;
    }
    ocPublishStatus();
  }

  // ---------- watchdog: session switch / late-rendering timeline ----------
  const watchdog = setInterval(() => {
    try {
      const sid = ocSessionID();
      if (sid !== currentSession) {
        if (sid) mount(sid);
        else teardown(true);
        return;
      }
      if (!rail) return;
      // Re-attach if the timeline container was rebuilt (SPA remount).
      const scroller = ocFindScroller();
      if (scroller && scroller !== scrollerObserved) {
        attachScroller(scroller);
        updateGeometry();
      } else if (!scroller) {
        rail.setVisible(false);
      } else {
        updateGeometry();
      }
    } catch (err) {
      ocErr("watchdog", err);
    }
  }, 1000);

  // Initial attempt (page may already be on a session route).
  const initial = ocSessionID();
  if (initial) mount(initial);
  ocPublishStatus();
  ocLog("content script loaded, session:", initial);

  // Teardown handle for dev-loop re-injection (production loads once per
  // page load; the guard alone would otherwise keep stale code alive).
  window.__OC_RAIL_TEARDOWN = () => {
    teardown(true);
    clearInterval(watchdog);
  };
})();
