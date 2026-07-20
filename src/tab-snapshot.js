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

import { isSystemUrl } from "./system-urls.js";

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
  return !isSystemUrl(url);
}

// A lazy-tab placeholder carries the original page in its query string
// (.../lazy-tab.html?url=<real>&title=...&favIconUrl=...). If a snapshot is
// re-saved while some restored tabs are still placeholders, unwrap them so
// the real URL — not the chrome-extension:// placeholder — is what persists.
export function unwrapLazyTabUrl(url) {
  if (typeof url !== "string" || !url.includes("/lazy-tab.html?")) return null;
  const query = url.slice(url.indexOf("?") + 1);
  const realUrl = new URLSearchParams(query).get("url");
  return realUrl || null;
}

function pickTab(tab) {
  const unwrappedUrl = unwrapLazyTabUrl(tab.url);
  if (unwrappedUrl) {
    // The placeholder page never loaded the real site, so its live favIconUrl
    // is our generated letter icon — keep the snapshot's original metadata by
    // re-reading it from the query string instead of the live tab.
    const params = new URLSearchParams(tab.url.slice(tab.url.indexOf("?") + 1));
    return {
      url: unwrappedUrl,
      title: params.get("title") || unwrappedUrl,
      pinned: Boolean(tab.pinned),
      index: typeof tab.index === "number" ? tab.index : 0,
      favIconUrl: params.get("favIconUrl") || ""
    };
  }
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
    // Our own lazy-tab placeholders pass the filter via their embedded real
    // URL; other chrome-extension:// pages are still dropped.
    if (!isCapturableUrl(tab.url) && !unwrapLazyTabUrl(tab.url)) continue;
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

/* ---- Export / import ----
 *
 * Snapshots export to a plain JSON file so the user can stash them outside
 * the browser or move them between machines:
 *
 *   { format: "chrome-tab-snapshots", version: 1, exportedAt, snapshots: [...] }
 *
 * Import validates the envelope, re-checks every tab with the same
 * capturability rules capture uses, rebuilds any missing counts, and
 * regenerates ids so an import can never collide with (or overwrite) an
 * existing snapshot. */

export const SNAPSHOT_EXPORT_FORMAT = "chrome-tab-snapshots";
export const SNAPSHOT_EXPORT_VERSION = 1;

export function buildSnapshotExport(snapshots, exportedAt = Date.now()) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  return {
    format: SNAPSHOT_EXPORT_FORMAT,
    version: SNAPSHOT_EXPORT_VERSION,
    exportedAt,
    snapshots: list
  };
}

// Download file names come from the exported snapshots' own timestamps so two
// exports of the same data produce the same name (Chrome just appends " (1)").
export function snapshotExportFileName(snapshots, exportedAt = Date.now()) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const format = (ts) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  };
  const times = list
    .map((snapshot) => snapshot?.createdAt)
    .filter((ts) => Number.isFinite(ts));
  if (list.length === 1 && times.length === 1) {
    return `tab-snapshot-${format(times[0])}.json`;
  }
  return `tab-snapshots-${format(exportedAt)}.json`;
}

function sanitizeImportTab(tab) {
  if (!tab || typeof tab !== "object") return null;
  const url = typeof tab.url === "string" ? tab.url.trim() : "";
  if (!isCapturableUrl(url)) return null;
  return {
    url,
    title: typeof tab.title === "string" ? tab.title : url,
    pinned: Boolean(tab.pinned),
    index: Number.isFinite(tab.index) ? tab.index : 0,
    favIconUrl: typeof tab.favIconUrl === "string" ? tab.favIconUrl : ""
  };
}

// `existingIds` lets the caller reserve ids it already holds; regenerated ids
// are guaranteed unique against both the reserve set and the import itself.
// createdAt is injectable purely so tests stay deterministic.
export function parseSnapshotImport(json, { existingIds = new Set(), createdAt = Date.now() } = {}) {
  let doc;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (!doc || typeof doc !== "object" || doc.format !== SNAPSHOT_EXPORT_FORMAT) {
    throw new Error("不是有效的快照导出文件");
  }
  if (!Array.isArray(doc.snapshots)) {
    throw new Error("导出文件中缺少快照列表");
  }

  const reserved = new Set(existingIds);
  const snapshots = [];
  let skipped = 0;

  for (const raw of doc.snapshots) {
    if (!raw || typeof raw !== "object") { skipped += 1; continue; }
    const rawWindows = Array.isArray(raw.windows) ? raw.windows : [];
    const windows = [];
    let tabCount = 0;
    for (const rawWindow of rawWindows) {
      const rawTabs = Array.isArray(rawWindow?.tabs) ? rawWindow.tabs : [];
      const tabs = rawTabs.map(sanitizeImportTab).filter(Boolean);
      if (tabs.length === 0) continue;
      const activeIndex = Number.isFinite(rawWindow?.activeIndex)
        ? Math.max(0, Math.min(rawWindow.activeIndex, tabs.length - 1))
        : 0;
      windows.push({ tabs, activeIndex });
      tabCount += tabs.length;
    }
    if (windows.length === 0) { skipped += 1; continue; }

    // Reuse the original id when it's free; otherwise mint a fresh one by
    // bumping the timestamp suffix until it clears the reserve set.
    let id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    if (!id || reserved.has(id)) {
      let bump = 0;
      do {
        id = generateSnapshotId(createdAt + bump);
        bump += 1;
      } while (reserved.has(id));
    }
    reserved.add(id);

    snapshots.push({
      id,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : createdAt,
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "导入的快照",
      windowCount: windows.length,
      tabCount,
      windows
    });
  }

  if (snapshots.length === 0) {
    throw new Error(skipped > 0 ? "文件中的快照都不可导入" : "文件中没有快照");
  }
  return { snapshots, imported: snapshots.length, skipped };
}
