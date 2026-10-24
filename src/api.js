"use strict";
// Session id parsing + user-message list fetch (same-origin HTTP API).

function ocSessionID() {
  const m = location.pathname.match(/\/session\/(ses_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// Returns ordered [{ id, preview, time }] for every user message in the
// session. `preview` is generous (1000 chars) because the TOC panel shows an
// expanded multi-line preview on hover; list rows truncate further themselves.
//
// Endpoint shape differs across opencode versions:
//   - current (>= ~1.17): GET /api/session/{id}/message -> { data: [...] }
//   - legacy:             GET /session/{id}/message      -> [...]
// On a SPA-routed server the legacy path silently answers index.html with
// HTTP 200, so a non-JSON content type is treated as "path not supported"
// and the fallback path is tried instead.
async function ocFetchUserMessages(sessionID) {
  const paths = [
    "/api/session/" + sessionID + "/message",
    "/session/" + sessionID + "/message",
  ];
  let lastErr = null;
  // A well-formed response carrying no user message is NOT authoritative:
  // some deployments answer /api/session/<id>/message with {"data":[]}
  // (cursor-paginated stub) while the legacy path returns the whole
  // conversation as a bare array. Stopping on the first empty `data` array
  // made the rail render zero ticks for sessions with hundreds of messages.
  let sawWellFormedEmpty = false;
  for (const path of paths) {
    let data;
    try {
      const res = await fetch(path, { credentials: "include" });
      if (!res.ok) {
        lastErr = new Error("messages HTTP " + res.status + " for " + path);
        continue;
      }
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) {
        lastErr = new Error("non-JSON response for " + path);
        continue;
      }
      data = await res.json();
    } catch (err) {
      lastErr = err;
      continue;
    }
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data && data.data)
        ? data.data
        : null;
    if (!items) {
      lastErr = new Error("unexpected response shape for " + path);
      continue;
    }
    const out = [];
    for (const item of items) {
      const info = item.info || item;
      // Legacy shape: info.role === "user"; current shape: type === "user".
      const isUser = info.role === "user" || item.type === "user";
      if (!isUser) continue;
      let text = "";
      if (typeof item.text === "string" && item.text) {
        text = item.text;
      } else if (Array.isArray(item.parts)) {
        text = item.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text || "")
          .join(" ");
      } else if (typeof info.text === "string") {
        text = info.text;
      }
      text = text.replace(/\s+/g, " ").trim();
      out.push({
        id: info.id || item.id,
        preview: (text || info.id || item.id).slice(0, 1000),
        // Defensive: ms epoch in current builds, seconds in some older ones.
        time: info.time?.createdMs ?? info.time?.created ?? item.time?.created ?? null,
      });
    }
    if (out.length) return out;
    sawWellFormedEmpty = true;
  }
  // No path had messages, but at least one answered correctly with none —
  // that is a genuinely empty session, not a transport failure.
  if (sawWellFormedEmpty) return [];
  throw lastErr || new Error("messages fetch failed");
}
