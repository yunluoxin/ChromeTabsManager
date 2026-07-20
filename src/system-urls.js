// Pure helper: which URLs belong to the browser/extension itself and must be
// excluded from bookmarks, snapshots, and bulk moves.
//
// Kept Chrome-free so it stays unit-testable; both bookmark-planner.js and
// tab-snapshot.js filter through this. Covers every browser family we target:
//   chrome:// chrome-extension://  — Chromium family
//   about:   moz-extension://      — Firefox
//   safari-extension://            — Safari web extensions
//   edge://                        — Edge's own scheme alias

const SYSTEM_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "moz-extension://",
  "edge://",
  "safari-web-extension://",
  "safari-extension://"
];

export function isSystemUrl(url) {
  if (typeof url !== "string" || !url) return false;
  return SYSTEM_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}
