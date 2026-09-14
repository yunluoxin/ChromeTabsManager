import {
  createBookmark,
  createWindow,
  discardTab,
  focusWindow,
  getCurrentWindow,
  getDisplays,
  getExtensionUrl,
  getExtensionVersion,
  getFromStorage,
  moveTabs,
  queryTabs,
  queryWindows,
  removeTabs,
  searchHistory,
  setInStorage,
  updateTab
} from "./chrome-api.js";
import { BOOKMARK_MODES, createBookmarkPlan } from "./bookmark-planner.js";
import { groupTabs } from "./age-grouping.js";
import { filterWindowsOnSameDisplay, filterWindowsOnSameDisplayVisible, pickDisplayForWindow } from "./screen-windows.js";
import { groupTabsByWindow } from "./window-grouping.js";
import { applyBoundsToCreateData, formatBoundsSummary, isBoundsValidForScreen } from "./window-bounds.js";
import {
  buildSnapshotExport,
  captureSnapshot,
  parseSnapshotImport,
  planRestore,
  snapshotExportFileName,
  snapshotPrivacy,
  unwrapLazyTabUrl
} from "./tab-snapshot.js";

const SNAPSHOTS_KEY = "tabSnapshots";

export const GROUPING_MODES = Object.freeze({
  BY_AGE: "by-age",
  BY_WINDOW: "by-window"
});

const METADATA_KEY = "tabAgeMetadata";

export async function getMetadata() {
  const stored = await getFromStorage({ [METADATA_KEY]: {} });
  return stored[METADATA_KEY] || {};
}

export async function saveMetadata(metadata) {
  await setInStorage({ [METADATA_KEY]: metadata });
}

export async function recordTabOpened(tab, openedAt = Date.now()) {
  if (!tab?.id) return;
  const metadata = await getMetadata();
  metadata[tab.id] = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || "",
    openedAt,
    estimatedOpenedAt: null,
    ageSource: "recorded",
    createdByVersion: getExtensionVersion(),
    updatedAt: Date.now()
  };
  await saveMetadata(metadata);
}

export async function removeTabMetadata(tabId) {
  const metadata = await getMetadata();
  delete metadata[tabId];
  await saveMetadata(metadata);
}

export async function replaceTabMetadata(addedTabId, removedTabId) {
  const metadata = await getMetadata();
  if (metadata[removedTabId]) {
    metadata[addedTabId] = { ...metadata[removedTabId], tabId: addedTabId, updatedAt: Date.now() };
    delete metadata[removedTabId];
    await saveMetadata(metadata);
  }
}

export async function reconcileOpenTabs() {
  const tabs = await queryTabs({});
  const metadata = await getMetadata();
  const nextMetadata = {};
  const oldMetadataByUrl = new Map(Object.values(metadata).map((entry) => [entry.url, entry]));

  for (const tab of tabs) {
    if (!tab.id) continue;
    const existing = metadata[tab.id];
    if (existing && existing.url === (tab.url || "")) {
      nextMetadata[tab.id] = { ...existing, windowId: tab.windowId, updatedAt: Date.now() };
      continue;
    }

    const matchedByUrl = oldMetadataByUrl.get(tab.url || "");
    if (matchedByUrl?.openedAt) {
      nextMetadata[tab.id] = {
        ...matchedByUrl,
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url || "",
        updatedAt: Date.now()
      };
      continue;
    }

    nextMetadata[tab.id] = await estimateMetadataForTab(tab);
  }

  await saveMetadata(nextMetadata);
  return nextMetadata;
}

export async function estimateMetadataForTab(tab) {
  const now = Date.now();
  let estimatedOpenedAt = null;

  if (tab.url && tab.url.startsWith("http")) {
    try {
      const visits = await searchHistory({
        text: tab.url,
        startTime: 0,
        maxResults: 1
      });
      estimatedOpenedAt = visits?.[0]?.lastVisitTime || null;
    } catch {
      estimatedOpenedAt = null;
    }
  }

  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || "",
    openedAt: null,
    estimatedOpenedAt,
    ageSource: estimatedOpenedAt ? "estimated" : "unknown",
    createdByVersion: getExtensionVersion(),
    updatedAt: now
  };
}

export async function getTabGroups({ mode = GROUPING_MODES.BY_AGE } = {}) {
  const metadata = await reconcileOpenTabs();
  const [tabs, currentWindow, windows] = await Promise.all([
    queryTabs({}),
    getCurrentWindow().catch(() => null),
    listWindows().catch(() => [])
  ]);
  const windowStates = new Map(windows.map((win) => [win.id, win]));
  const extensionOrigin = getExtensionUrl("");
  const viewModels = tabs.map((tab) => createTabViewModel(tab, metadata[tab.id], currentWindow, extensionOrigin));

  const groups = mode === GROUPING_MODES.BY_WINDOW
    ? groupTabsByWindow(viewModels, { currentWindowId: currentWindow?.id ?? null, windowStates })
    : groupTabs(viewModels);
  const groupedTabs = groups.flatMap((group) => group.tabs);

  return {
    tabs: groupedTabs,
    groups,
    currentWindowId: currentWindow?.id || null
  };
}

export function createTabViewModel(tab, metadata, currentWindow, extensionOrigin) {
  const ageTimestamp = metadata?.openedAt || metadata?.estimatedOpenedAt || null;
  const lazyRealUrl = unwrapLazyTabUrl(tab.url);
  // A lazy-tab placeholder IS a real page from the user's point of view: show
  // and treat it as the page it stands for. Title can come from the live tab
  // (the placeholder sets document.title to the real title); the favicon must
  // come from the query string because the live one is our generated letter
  // icon.
  let url = tab.url || "";
  let title = tab.title || tab.url || "Untitled tab";
  let favIconUrl = tab.favIconUrl || "";
  if (lazyRealUrl) {
    const params = new URLSearchParams(tab.url.slice(tab.url.indexOf("?") + 1));
    url = lazyRealUrl;
    title = tab.title || params.get("title") || lazyRealUrl;
    favIconUrl = params.get("favIconUrl") || "";
  }
  const isExtensionOwned = !lazyRealUrl && Boolean(tab.url?.startsWith(extensionOrigin));
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title,
    url,
    favIconUrl,
    isLazyPlaceholder: Boolean(lazyRealUrl),
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
    audible: Boolean(tab.audible),
    incognito: Boolean(tab.incognito),
    currentWindow: currentWindow ? tab.windowId === currentWindow.id : false,
    isExtensionOwned,
    ageTimestamp,
    ageSource: metadata?.ageSource || "unknown"
  };
}

export async function closeTabs(tabIds) {
  return runPerTab(tabIds, async (tabId) => {
    await removeTabs(tabId);
    await removeTabMetadata(tabId);
  });
}

export async function discardTabs(tabIds) {
  const tabs = await queryTabs({});
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));

  return runPerTab(tabIds, async (tabId) => {
    const tab = tabsById.get(tabId);
    if (!tab) throw new SkipTabError("标签不存在");
    if (tab.active) throw new SkipTabError("活动标签已跳过");
    if (tab.pinned) throw new SkipTabError("固定标签已跳过");
    if (tab.discarded) throw new SkipTabError("已经释放");
    // Lazy-tab placeholders are already memory-free; discarding them buys
    // nothing and Chrome may refuse to discard an extension page anyway.
    if (unwrapLazyTabUrl(tab.url)) throw new SkipTabError("休眠标签无需释放");
    await discardTab(tabId);
  });
}

export async function activateTab(tabId, windowId) {
  await updateTab(tabId, { active: true });
  if (windowId) {
    await focusWindow(windowId);
  }
  return { tabId, windowId };
}

export async function moveTabsToWindow(tabIds, targetWindowId) {
  const safeIds = (tabIds || []).map(Number).filter((id) => Number.isFinite(id));
  const safeTarget = Number(targetWindowId);
  if (!Number.isFinite(safeTarget)) {
    const summary = createSummary();
    summary.failed = safeIds.length;
    summary.errors.push("目标窗口无效");
    return summary;
  }

  const allTabs = await queryTabs({});
  const tabsById = new Map(allTabs.map((tab) => [tab.id, tab]));
  // Chrome/Firefox refuse to move a tab between a normal and a private window;
  // the underlying tabs.move rejects. Look up the target window's privacy so we
  // can skip incompatible tabs with a clear reason instead of letting the move
  // fail opaquely (which used to surface as a false "success").
  const windows = await queryWindows({}).catch(() => []);
  const targetWindow = windows.find((win) => win.id === safeTarget);

  return runPerTab(safeIds, async (tabId) => {
    const tab = tabsById.get(tabId);
    if (!tab) throw new SkipTabError("标签不存在");
    // Lazy-tab placeholders are movable — they stand for a real page.
    if (tab.url?.startsWith(getExtensionUrl("")) && !unwrapLazyTabUrl(tab.url)) {
      throw new SkipTabError("扩展页面已跳过");
    }
    if (tab.windowId === safeTarget) throw new SkipTabError("已在目标窗口");
    if (targetWindow && Boolean(tab.incognito) !== Boolean(targetWindow.incognito)) {
      throw new SkipTabError("隐私与普通窗口无法互移");
    }
    await moveTabs([tabId], { windowId: safeTarget, index: -1 });
  });
}

export async function createWindowWithTabs(tabIds) {
  const safeIds = (tabIds || []).map(Number).filter((id) => Number.isFinite(id));
  const summary = createSummary();
  if (safeIds.length === 0) {
    summary.failed = 1;
    summary.errors.push("没有要移动的标签");
    return summary;
  }

  const allTabs = await queryTabs({});
  const tabsById = new Map(allTabs.map((tab) => [tab.id, tab]));
  const extensionOrigin = getExtensionUrl("");

  const validIds = [];
  let seedIncognito = null;
  for (const tabId of safeIds) {
    const tab = tabsById.get(tabId);
    if (!tab) {
      summary.failed += 1;
      summary.errors.push(`#${tabId}: 标签不存在`);
      continue;
    }
    if (tab.url?.startsWith(extensionOrigin) && !unwrapLazyTabUrl(tab.url)) {
      summary.failed += 1;
      summary.errors.push(`#${tabId}: 扩展页面已跳过`);
      continue;
    }
    // The new window inherits the first valid tab's privacy; a tab from the
    // other kind of window can't be moved in (Chrome/Firefox reject it), so
    // fail it up front rather than letting the later moveTabs fail silently.
    if (seedIncognito === null) {
      seedIncognito = Boolean(tab.incognito);
    } else if (Boolean(tab.incognito) !== seedIncognito) {
      summary.failed += 1;
      summary.errors.push(`#${tabId}: 隐私与普通窗口无法互移`);
      continue;
    }
    validIds.push(tabId);
  }

  if (validIds.length === 0) return summary;

  let newWindow;
  try {
    // chrome.windows.create with tabId pulls the tab out of its source window
    // and seeds the new window; the new window also receives focus by default,
    // which matches the "drop creates a new visible window" expectation.
    newWindow = await createWindow({ tabId: validIds[0] });
  } catch (error) {
    summary.failed += validIds.length;
    summary.errors.push(`新建窗口失败: ${error.message}`);
    return summary;
  }
  summary.succeeded += 1;

  for (const tabId of validIds.slice(1)) {
    try {
      await moveTabs([tabId], { windowId: newWindow.id, index: -1 });
      summary.succeeded += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(`#${tabId}: ${error.message}`);
    }
  }

  return summary;
}

export async function listWindows() {
  return queryWindows({ populate: false });
}

export async function bookmarkTabs(tabIds, options = {}) {
  const { tabs } = await getTabGroups();
  const selectedTabs = tabs.filter((tab) => tabIds.includes(tab.tabId));
  const plan = createBookmarkPlan(selectedTabs, options);
  const summary = createSummary();

  try {
    if (plan.mode === BOOKMARK_MODES.FLAT) {
      for (const tab of plan.tabs) {
        await createBookmark({ parentId: plan.parentId, title: tab.title, url: tab.url });
        summary.succeeded += 1;
      }
    } else if (plan.mode === BOOKMARK_MODES.GROUPED) {
      const root = await createBookmark({ parentId: plan.parentId, title: plan.rootFolderTitle });
      for (const group of plan.groups) {
        const groupFolder = await createBookmark({ parentId: root.id, title: group.label });
        for (const tab of group.tabs) {
          await createBookmark({ parentId: groupFolder.id, title: tab.title, url: tab.url });
          summary.succeeded += 1;
        }
      }
    } else {
      const folder = await createBookmark({ parentId: plan.parentId, title: plan.rootFolderTitle });
      for (const tab of plan.tabs) {
        await createBookmark({ parentId: folder.id, title: tab.title, url: tab.url });
        summary.succeeded += 1;
      }
    }
  } catch (error) {
    summary.failed += 1;
    summary.errors.push(error.message);
  }

  summary.skipped = selectedTabs.length - plan.tabs.length;
  return summary;
}

async function runPerTab(tabIds, action) {
  const summary = createSummary();
  for (const tabId of tabIds) {
    try {
      await action(tabId);
      summary.succeeded += 1;
    } catch (error) {
      if (error instanceof SkipTabError) {
        summary.skipped += 1;
        summary.errors.push(`#${tabId}: ${error.message}`);
        continue;
      }
      summary.failed += 1;
      summary.errors.push(`#${tabId}: ${error.message}`);
    }
  }
  return summary;
}

class SkipTabError extends Error {}

function createSummary() {
  return {
    succeeded: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
}

async function readSnapshots() {
  const stored = await getFromStorage({ [SNAPSHOTS_KEY]: { snapshots: [] } });
  const raw = stored[SNAPSHOTS_KEY] || {};
  return Array.isArray(raw.snapshots) ? raw.snapshots : [];
}

async function writeSnapshots(snapshots) {
  await setInStorage({ [SNAPSHOTS_KEY]: { snapshots } });
}

function summarizeSnapshot(snapshot) {
  const privacy = snapshotPrivacy(snapshot);
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    label: snapshot.label,
    windowCount: snapshot.windowCount,
    tabCount: snapshot.tabCount,
    hasIncognito: privacy.hasIncognito,
    hasNormal: privacy.hasNormal,
    boundsSummary: formatBoundsSummary(snapshot)
  };
}

export async function saveSnapshot() {
  const [tabs, windows] = await Promise.all([queryTabs({}), queryWindows({})]);
  const snapshot = captureSnapshot(tabs, windows, Date.now());
  const snapshots = await readSnapshots();
  // Newest first so the popup doesn't need to sort.
  snapshots.unshift(snapshot);
  await writeSnapshots(snapshots);
  return summarizeSnapshot(snapshot);
}

export async function saveWindowSnapshot(windowId) {
  const safeWindowId = Number(windowId);
  if (!Number.isFinite(safeWindowId)) {
    const summary = createSummary();
    summary.failed = 1;
    summary.errors.push("窗口无效");
    return summary;
  }

  const allTabs = await queryTabs({});
  const windowTabs = allTabs.filter((tab) => tab.windowId === safeWindowId);
  // Look up the live window so captureSnapshot can read its geometry (bounds
  // / state). Fall back to a stub when the window vanished between the tab
  // query and here — the tabs are already filtered to that windowId so the
  // capture still finds them, just without geometry.
  const liveWindows = await queryWindows({}).catch(() => []);
  const liveWindow = liveWindows.find((win) => win?.id === safeWindowId);
  const snapshot = captureSnapshot(
    windowTabs,
    [liveWindow || { id: safeWindowId }],
    Date.now()
  );

  if (snapshot.windowCount === 0 || snapshot.tabCount === 0) {
    const summary = createSummary();
    summary.failed = 1;
    summary.errors.push("窗口内没有可保存的标签");
    return summary;
  }

  const snapshots = await readSnapshots();
  snapshots.unshift(snapshot);
  await writeSnapshots(snapshots);
  return summarizeSnapshot(snapshot);
}

// Saves only the windows sitting on the same physical display as the user's
// currently focused window. Requires `chrome.system.display` (Chromium-only);
// Firefox has no equivalent API, so on Firefox this function degrades to
// `saveWindowSnapshot(activeWindowId)` — the popup only offers this option
// when SUPPORTS_SCREEN_INFO is true, so the degraded path is the popup's
// `仅当前屏幕` button falling back to `仅当前窗口` semantics if the user
// upgrades mid-session.
//
// Other fallbacks (all routed through saveWindowSnapshot so callers see a
// normal summary shape):
//   - displays API missing → null
//   - displays is an empty array (Chrome kiosk / revoked permission)
//   - activeWindowId not in liveWindows (closed between query and now)
//   - active window's center outside every display (straddle, off-screen dock)
export async function saveScreenSnapshot(activeWindowId) {
  const safeWindowId = Number(activeWindowId);
  if (!Number.isFinite(safeWindowId)) {
    return saveWindowSnapshot(safeWindowId);
  }

  const [allTabs, liveWindows, displays] = await Promise.all([
    queryTabs({}),
    queryWindows({}).catch(() => []),
    getDisplays()
  ]);

  if (!Array.isArray(displays) || displays.length === 0) {
    return saveWindowSnapshot(safeWindowId);
  }

  const activeWindow = liveWindows.find((win) => win?.id === safeWindowId);
  if (!activeWindow) {
    return saveWindowSnapshot(safeWindowId);
  }

  const display = pickDisplayForWindow(activeWindow, displays);
  if (!display) {
    return saveWindowSnapshot(safeWindowId);
  }

  const sameDisplayWindows = filterWindowsOnSameDisplay(liveWindows, displays, display);
  const sameDisplayWindowIds = new Set(
    sameDisplayWindows.map((w) => w?.id).filter((id) => id != null)
  );
  const filteredTabs = allTabs.filter((tab) => sameDisplayWindowIds.has(tab.windowId));

  // Same geometry-preserving pattern as saveSelectedSnapshot: each window
  // comes from the live list when available, otherwise a stub so the snapshot
  // still records which windows the tabs came from.
  const liveById = new Map(liveWindows.map((win) => [win?.id, win]));
  const windows = [...sameDisplayWindowIds].map((id) => liveById.get(id) || { id });

  const snapshot = captureSnapshot(filteredTabs, windows, Date.now());

  if (snapshot.windowCount === 0 || snapshot.tabCount === 0) {
    const summary = createSummary();
    summary.failed = 1;
    summary.errors.push("当前屏幕内没有可保存的标签");
    return summary;
  }

  const snapshots = await readSnapshots();
  snapshots.unshift(snapshot);
  await writeSnapshots(snapshots);
  return summarizeSnapshot(snapshot);
}

// Like saveScreenSnapshot but additionally drops "duplicate-bounds"
// groups on the active display — windows that share their exact bounds
// with another window on the same screen. They can't all be visible at
// once, so we assume they're spread across macOS Spaces and keep only the
// active window's group (or, if the active isn't in such a group, drop
// the whole group on the assumption it's on a different Space from the
// user's current one).
//
// This is a heuristic — Chrome doesn't expose Space membership, so the
// only signal we have is "two windows at the same screen position can't
// both be visible". See filterWindowsOnSameDisplayVisible for the full
// logic and its limitations.
//
// Falls through to saveScreenSnapshot → saveWindowSnapshot on the usual
// degraded paths (no display API, no windows, etc.).
export async function saveScreenVisibleSnapshot(activeWindowId) {
  const safeWindowId = Number(activeWindowId);
  if (!Number.isFinite(safeWindowId)) {
    return saveWindowSnapshot(safeWindowId);
  }

  const [allTabs, liveWindows, displays] = await Promise.all([
    queryTabs({}),
    queryWindows({}).catch(() => []),
    getDisplays()
  ]);

  if (!Array.isArray(displays) || displays.length === 0) {
    return saveWindowSnapshot(safeWindowId);
  }

  const activeWindow = liveWindows.find((win) => win?.id === safeWindowId);
  if (!activeWindow) {
    return saveWindowSnapshot(safeWindowId);
  }

  const display = pickDisplayForWindow(activeWindow, displays);
  if (!display) {
    return saveWindowSnapshot(safeWindowId);
  }

  const sameDisplayWindows = filterWindowsOnSameDisplayVisible(
    liveWindows,
    displays,
    display,
    safeWindowId
  );
  const sameDisplayWindowIds = new Set(
    sameDisplayWindows.map((w) => w?.id).filter((id) => id != null)
  );

  // The visible filter can legitimately drop every window when the
  // active window's bounds are duplicated by another (kept) and no other
  // unique-bound windows exist on the display. In that edge case the
  // snapshot would have just the active window — fall through to the
  // current-window save so the user gets at least one window captured.
  if (sameDisplayWindowIds.size === 0) {
    return saveWindowSnapshot(safeWindowId);
  }

  const filteredTabs = allTabs.filter((tab) => sameDisplayWindowIds.has(tab.windowId));
  const liveById = new Map(liveWindows.map((win) => [win?.id, win]));
  const windows = [...sameDisplayWindowIds].map((id) => liveById.get(id) || { id });

  const snapshot = captureSnapshot(filteredTabs, windows, Date.now());

  if (snapshot.windowCount === 0 || snapshot.tabCount === 0) {
    const summary = createSummary();
    summary.failed = 1;
    summary.errors.push("当前屏幕没有可保存的可见窗口");
    return summary;
  }

  const snapshots = await readSnapshots();
  snapshots.unshift(snapshot);
  await writeSnapshots(snapshots);
  return summarizeSnapshot(snapshot);
}

// Same shape as saveWindowSnapshot, but accepts an explicit subset of tab IDs
// rather than the whole window. Tabs are bucketed by their own windowId, so a
// selection that spans N source windows produces a snapshot with N entries —
// one per source window, each holding only its selected tabs.
export async function saveSelectedSnapshot(tabIds) {
  const safeIds = (tabIds || []).map(Number).filter((id) => Number.isFinite(id));
  const summary = createSummary();

  if (safeIds.length === 0) {
    summary.failed = 1;
    summary.errors.push("没有选中的标签");
    return summary;
  }

  const allTabs = await queryTabs({});
  const tabsById = new Map(allTabs.map((tab) => [tab.id, tab]));
  const selectedTabs = safeIds
    .map((id) => tabsById.get(id))
    .filter((tab) => tab && tab.windowId != null);

  if (selectedTabs.length === 0) {
    summary.failed = 1;
    summary.errors.push("选中的标签都已失效");
    return summary;
  }

  // Mirrors saveWindowSnapshot: captureSnapshot needs the windows list to
  // keep its knownWindowIds filter narrow. Look up each source window so its
  // geometry is preserved with the snapshot; fall back to a stub when the
  // window has already been closed between the tab query and here.
  const windowIds = [...new Set(selectedTabs.map((tab) => tab.windowId))];
  const liveWindows = await queryWindows({}).catch(() => []);
  const liveById = new Map(liveWindows.map((win) => [win?.id, win]));
  const windows = windowIds.map((id) => liveById.get(id) || { id });

  const snapshot = captureSnapshot(selectedTabs, windows, Date.now());

  if (snapshot.windowCount === 0 || snapshot.tabCount === 0) {
    summary.failed = 1;
    summary.errors.push("没有可保存的标签");
    return summary;
  }

  const snapshots = await readSnapshots();
  snapshots.unshift(snapshot);
  await writeSnapshots(snapshots);
  return summarizeSnapshot(snapshot);
}

// Popup list: hides pure-incognito snapshots (every window is private). Mixed
// snapshots stay — the popup restore path only brings their normal windows
// back. The manager page uses listSnapshotDetails, which never filters.
// Popup list: hides pure-incognito snapshots (every window is private). Mixed
// snapshots stay — the popup restore path only brings their normal windows
// back. The manager page uses listAllSnapshots, which never filters.
export async function listSnapshots() {
  const snapshots = await readSnapshots();
  return snapshots
    .map(summarizeSnapshot)
    .filter((summary) => summary.hasNormal);
}

// Manager-page list: every snapshot, unfiltered, but still summary-only rows
// (privacy flags included). Full window/tab data comes from getSnapshot on
// preview.
export async function listAllSnapshots() {
  const snapshots = await readSnapshots();
  return snapshots.map(summarizeSnapshot);
}

export async function getSnapshot(id) {
  const snapshots = await readSnapshots();
  return snapshots.find((snapshot) => snapshot.id === id) || null;
}

export async function deleteSnapshot(id) {
  const snapshots = await readSnapshots();
  const next = snapshots.filter((snapshot) => snapshot.id !== id);
  if (next.length === snapshots.length) {
    const summary = createSummary();
    summary.failed = 1;
    summary.errors.push("快照不存在");
    return summary;
  }
  await writeSnapshots(next);
  return { id, succeeded: 1 };
}

// Trims and replaces the snapshot's label in-place. Returns the updated summary
// so the popup can refresh the row without re-listing everything. Rejects when
// the snapshot is missing or the new label is empty/whitespace-only so the row
// doesn't silently turn into a nameless placeholder.
export async function renameSnapshot(id, label) {
  const safeId = typeof id === "string" ? id.trim() : "";
  const safeLabel = typeof label === "string" ? label.trim() : "";
  if (!safeId) {
    const summary = createSummary();
    summary.failed = 1;
    summary.errors.push("快照不存在");
    return summary;
  }
  if (!safeLabel) {
    const summary = createSummary();
    summary.failed = 1;
    summary.errors.push("名称不能为空");
    return summary;
  }

  const snapshots = await readSnapshots();
  const target = snapshots.find((snapshot) => snapshot.id === safeId);
  if (!target) {
    const summary = createSummary();
    summary.failed = 1;
    summary.errors.push("快照不存在");
    return summary;
  }

  target.label = safeLabel;
  await writeSnapshots(snapshots);
  return summarizeSnapshot(target);
}

// Builds the placeholder URL a restored background tab points at. The real
// url/title/favIconUrl ride along in the query string; lazy-tab.js renders the
// tab's identity from them and location.replace()s to the real page on
// activation. Chrome-free logic stays in tab-snapshot.js — this builder needs
// chrome.runtime.getURL, so it lives here.
function buildLazyTabUrl(tab) {
  const params = new URLSearchParams({
    url: tab.url,
    title: tab.title || "",
    favIconUrl: tab.favIconUrl || ""
  });
  return `${getExtensionUrl("lazy-tab.html")}?${params.toString()}`;
}

export async function restoreSnapshot(id, { excludeIncognito = false, screen = null } = {}) {
  const summary = createSummary();
  const snapshot = await getSnapshot(id);
  if (!snapshot) {
    summary.failed = 1;
    summary.errors.push("快照不存在");
    return summary;
  }
  // Only each window's active tab loads for real; the rest come back as
  // near-free placeholder tabs pointing at this extension's own page. The
  // memory saving is the whole point of restoring. Chrome's manifest
  // declares "incognito": "split", and split-mode Chrome accepts
  // `chrome-extension://` placeholder URLs inside incognito `windows.create`
  // url lists — empirically verified after commit 1b107bc — so privacy
  // windows in a snapshot benefit from lazy loading too. When
  // excludeIncognito is set (popup path), private windows are dropped from
  // the plan entirely.
  const plan = planRestore(snapshot, {
    lazyUrlFor: buildLazyTabUrl,
    excludeIncognito
  });
  for (const window of plan.windows) {
    if (!window.urls || window.urls.length === 0) {
      summary.failed += 1;
      summary.errors.push("空窗口已跳过");
      continue;
    }
    try {
      // activeIndex is already at urls[0], so Chrome activates the right tab
      // without a follow-up tabs.update call. Private windows need
      // incognito:true — this throws if the user hasn't granted incognito
      // access, which we surface as a failure below.
      const createData = { url: window.urls };
      if (window.incognito) createData.incognito = true;
      // Geometry is best-effort: if the window would land off-screen (e.g.
      // the user's monitor layout changed since the snapshot was saved), we
      // silently drop the bounds and let Chrome pick a default. state and
      // width/height are mutually exclusive in the WebExtensions spec, so
      // applyBoundsToCreateData handles that internally.
      const usableBounds = isBoundsValidForScreen(window.bounds, screen)
        ? window.bounds
        : null;
      applyBoundsToCreateData(createData, usableBounds);
      await createWindow(createData);
      summary.succeeded += 1;
    } catch (error) {
      summary.failed += 1;
      const detail = window.incognito
        ? `隐私窗口恢复失败，请在扩展设置中允许隐私模式：${error.message}`
        : error.message;
      summary.errors.push(detail);
    }
  }
  return summary;
}

// Full snapshot records (windows + tabs) for the manager page's preview and
// export. listSnapshots stays summary-only for the popup's compact rows.
export async function listSnapshotDetails() {
  return readSnapshots();
}

// Restore a single window out of a multi-window snapshot. The preview panel
// uses this so the user can pick "just this window" rather than the whole
// bundle. `windowIndex` is the 0-based position the manager page renders.
//
// Privacy is preserved: a private source window always opens as a private
// destination window. We keep the same lazy-placeholder behavior as the full
// restore so opening one window still gives you the memory-saving benefit on
// the non-active tabs — Chrome's split-mode incognito allows
// `chrome-extension://` URLs in `windows.create({ incognito: true })` url
// lists (verified in commit 1b107bc), so incognito windows keep their placeholders.
export async function openSnapshotWindow(snapshotId, windowIndex, { screen = null } = {}) {
  const summary = createSummary();
  const snapshot = await getSnapshot(snapshotId);
  if (!snapshot) {
    summary.failed = 1;
    summary.errors.push("快照不存在");
    return summary;
  }

  const windows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
  const idx = Number(windowIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= windows.length) {
    summary.failed = 1;
    summary.errors.push("窗口不存在");
    return summary;
  }

  const target = windows[idx];
  // Reuse planRestore for the same privacy-aware url ordering and lazy
  // treatment — pass a one-window array-shaped snapshot so planRestore sees
  // exactly what we'd restore.
  const sliced = {
    ...snapshot,
    windows: [target],
    windowCount: 1,
    tabCount: Array.isArray(target.tabs) ? target.tabs.length : 0
  };
  const plan = planRestore(sliced, {
    lazyUrlFor: buildLazyTabUrl
  });
  const entry = plan.windows[0];
  if (!entry || !entry.urls || entry.urls.length === 0) {
    summary.failed = 1;
    summary.errors.push("窗口内没有可打开的标签");
    return summary;
  }

  try {
    const createData = { url: entry.urls };
    if (entry.incognito) createData.incognito = true;
    const usableBounds = isBoundsValidForScreen(entry.bounds, screen)
      ? entry.bounds
      : null;
    applyBoundsToCreateData(createData, usableBounds);
    await createWindow(createData);
    summary.succeeded = 1;
  } catch (error) {
    summary.failed = 1;
    summary.errors.push(entry.incognito
      ? `隐私窗口打开失败，请在扩展设置中允许隐私模式：${error.message}`
      : error.message);
  }
  return summary;
}

// Restore one tab from the snapshot into its own new window. The
// destination's privacy matches the source tab's privacy flag (which equals
// the source window's privacy since all tabs in a window share it). No lazy
// placeholders here — the user picked this tab on purpose, so it should
// actually load.
export async function openSnapshotTab(snapshotId, windowIndex, tabIndex, { screen = null } = {}) {
  const summary = createSummary();
  const snapshot = await getSnapshot(snapshotId);
  if (!snapshot) {
    summary.failed = 1;
    summary.errors.push("快照不存在");
    return summary;
  }

  const windows = Array.isArray(snapshot.windows) ? snapshot.windows : [];
  const wIdx = Number(windowIndex);
  const tIdx = Number(tabIndex);
  const targetWindow = windows[wIdx];
  const tabs = Array.isArray(targetWindow?.tabs) ? targetWindow.tabs : [];
  if (!targetWindow || !Number.isInteger(wIdx) || wIdx < 0 || wIdx >= windows.length) {
    summary.failed = 1;
    summary.errors.push("窗口不存在");
    return summary;
  }
  if (!Number.isInteger(tIdx) || tIdx < 0 || tIdx >= tabs.length) {
    summary.failed = 1;
    summary.errors.push("标签不存在");
    return summary;
  }
  const tab = tabs[tIdx];
  if (!tab || typeof tab.url !== "string" || !tab.url) {
    summary.failed = 1;
    summary.errors.push("标签缺少可用的链接");
    return summary;
  }

  const incognito = Boolean(tab.incognito ?? targetWindow.incognito);
  try {
    const createData = { url: [tab.url] };
    if (incognito) createData.incognito = true;
    await createWindow(createData);
    summary.succeeded = 1;
  } catch (error) {
    summary.failed = 1;
    summary.errors.push(incognito
      ? `隐私标签打开失败，请在扩展设置中允许隐私模式：${error.message}`
      : error.message);
  }
  return summary;
}

// Batch delete; missing ids count as skipped, not failures — the manager page
// multi-selects from a possibly-stale list, so a row vanishing mid-select is
// normal, not an error.
export async function deleteSnapshots(ids) {
  const safeIds = new Set((ids || []).map((id) => String(id)));
  const summary = createSummary();
  if (safeIds.size === 0) {
    summary.failed = 1;
    summary.errors.push("没有选中的快照");
    return summary;
  }
  const snapshots = await readSnapshots();
  const next = snapshots.filter((snapshot) => !safeIds.has(snapshot.id));
  const removed = snapshots.length - next.length;
  summary.succeeded = removed;
  summary.skipped = safeIds.size - removed;
  if (removed > 0) {
    await writeSnapshots(next);
  }
  return summary;
}

// Returns the export payload plus a suggested file name; the page builds the
// Blob and triggers the download itself (service workers can't touch the DOM).
export async function exportSnapshots(ids) {
  const snapshots = await readSnapshots();
  const wanted = Array.isArray(ids) && ids.length > 0 ? new Set(ids.map(String)) : null;
  const selected = wanted ? snapshots.filter((snapshot) => wanted.has(snapshot.id)) : snapshots;
  if (selected.length === 0) {
    throw new Error("没有可导出的快照");
  }
  const exportedAt = Date.now();
  return {
    doc: buildSnapshotExport(selected, exportedAt),
    fileName: snapshotExportFileName(selected, exportedAt),
    count: selected.length
  };
}

// Parses and validates the file in the pure layer, then merges. Existing
// snapshots win on id — imports always come in under a fresh id instead.
export async function importSnapshots(json) {
  const snapshots = await readSnapshots();
  const existingIds = new Set(snapshots.map((snapshot) => snapshot.id));
  const result = parseSnapshotImport(json, { existingIds });
  const merged = [...result.snapshots, ...snapshots];
  await writeSnapshots(merged);
  return {
    imported: result.imported,
    skipped: result.skipped,
    summaries: result.snapshots.map(summarizeSnapshot)
  };
}
