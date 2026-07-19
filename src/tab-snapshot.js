// Pure helpers for capturing and restoring tab snapshots.
//
// A snapshot is the persisted shape of "what windows/tabs were open at a given
// moment". Capture takes live chrome.tabs/chrome.windows data and projects it
// down to the fields we can faithfully restore later:
//
//   {
//     id, createdAt, label, windowCount, tabCount,
//     windows: [{ tabs: [{ url, title, pinned, index, favIconUrl }], activeIndex }]
//   }
//
// Restore planning turns a snapshot into a per-window `urls` list where the
// originally-active URL sits first, so `chrome.windows.create({ url: [...] })`
// makes Chrome activate the right tab without a follow-up `tabs.update` call.
// When a `lazyUrlFor` builder is supplied, every non-active URL is replaced by
// that builder's output (a local placeholder page) so only the active tab of
// each window actually loads on restore.

const NON_CAPTURABLE_PREFIXES = ["chrome://", "chrome-extension://"];

export function generateSnapshotId(createdAt) {
  return `snap-${createdAt}`;
}

export function formatSnapshotLabel(createdAt) {
  // Local clock — the user is looking at the popup in their own timezone.
  const d = new Date(createdAt);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isCapturableUrl(url) {
  if (!url) return false;
  return !NON_CAPTURABLE_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function pickTab(tab) {
  return {
    url: tab.url,
    title: tab.title || tab.url || "",
    pinned: Boolean(tab.pinned),
    index: typeof tab.index === "number" ? tab.index : 0,
    favIconUrl: tab.favIconUrl || ""
  };
}

export function captureSnapshot(tabs, windows, createdAt = Date.now()) {
  // Trust the windows list when given; otherwise the windowId set is whatever
  // the tabs report (the only window the user could capture from, after all).
  const knownWindowIds = windows && windows.length > 0
    ? new Set(windows.map((win) => win.id))
    : new Set(tabs.map((tab) => tab.windowId).filter((id) => id != null));

  // Bucket capturable tabs by windowId, then sort each bucket by tab.index.
  const byWindow = new Map();
  for (const tab of tabs) {
    if (!knownWindowIds.has(tab.windowId)) continue;
    if (!isCapturableUrl(tab.url)) continue;
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }

  // Stable window ordering: ascending windowId. This matches
  // window-grouping.js's choice and gives the restore plan a deterministic
  // order regardless of when chrome.tabs returns rows.
  const sortedWindowIds = [...byWindow.keys()].sort((a, b) => a - b);

  const capturedWindows = [];
  let tabCount = 0;

  for (const wid of sortedWindowIds) {
    const ordered = byWindow.get(wid)
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    const activeIndex = ordered.findIndex((tab) => tab.active);
    capturedWindows.push({
      tabs: ordered.map(pickTab),
      activeIndex: activeIndex >= 0 ? activeIndex : 0
    });
    tabCount += ordered.length;
  }

  return {
    id: generateSnapshotId(createdAt),
    createdAt,
    label: formatSnapshotLabel(createdAt),
    windowCount: capturedWindows.length,
    tabCount,
    windows: capturedWindows
  };
}

export function planRestore(snapshot, { lazyUrlFor } = {}) {
  const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
  return {
    windows: windows.map((window) => {
      const tabs = Array.isArray(window.tabs) ? window.tabs : [];
      const idx = Math.max(0, Math.min(window.activeIndex ?? 0, tabs.length - 1));
      const ordered = tabs.slice();
      if (idx > 0) {
        const [active] = ordered.splice(idx, 1);
        ordered.unshift(active);
      }
      // Position 0 is the tab Chrome will activate: always restore it for real.
      // Everything else may be swapped for a cheap placeholder that only loads
      // the real page when the user clicks the tab.
      const urls = ordered.map((tab, position) =>
        position === 0 || !lazyUrlFor ? tab.url : lazyUrlFor(tab)
      );
      return { urls };
    })
  };
}
