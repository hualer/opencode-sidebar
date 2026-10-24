"use strict";
// Jump-to-message. Relies on the app's own #message-<id> hash mechanism:
// assigning location.hash fires hashchange, which drives the app's
// useSessionHashScroll -> scrollToMessage -> revealMessage (virtualizer
// scrollToIndex, centering) and, when the target is older than the loaded
// history window, the app's chained loadMore until the message exists.
//
// If the app never moved the (already rendered) target into view within
// OC_JUMP_FALLBACK_MS, fall back to a manual scrollIntoView.

const OC_JUMP_FALLBACK_MS = 1500;

function ocJumpTo(messageID) {
  const anchor = "message-" + messageID;
  const current = location.hash.replace(/^#/, "");
  try {
    if (current === anchor) {
      // Same-hash: a plain assignment fires no hashchange, and a synchronous
      // clear+set can be coalesced by the router (net value unchanged, effect
      // never re-runs). Clear now and set after a delay so the app observes
      // a real empty -> target transition.
      history.replaceState(null, "", location.pathname + location.search);
      setTimeout(() => {
        // Only if no newer jump took over meanwhile.
        if (!location.hash) location.hash = anchor;
      }, 60);
    } else {
      location.hash = anchor;
    }
    OC_RAIL_STATUS.jumpCount++;
  } catch (err) {
    ocErr("jump.setHash", err);
  }

  setTimeout(() => {
    try {
      const el = document.getElementById(anchor);
      if (!el) return;
      const scroller = ocFindScroller();
      if (!scroller) return;
      const s = scroller.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const visible = r.top >= s.top - 2 && r.bottom <= s.bottom + 2;
      if (!visible) {
        el.scrollIntoView({ block: "center" });
        ocLog("jump fallback scrollIntoView for", anchor);
      }
    } catch (err) {
      ocErr("jump.fallback", err);
    }
  }, OC_JUMP_FALLBACK_MS);

  ocPublishStatus();
}
