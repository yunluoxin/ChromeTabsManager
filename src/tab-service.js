import {
  createBookmark,
  discardTab,
  focusWindow,
  getCurrentWindow,
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
import { groupTabsByWindow } from "./window-grouping.js";

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
    createdByVersion: chrome.runtime.getManifest().version,
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
    createdByVersion: chrome.runtime.getManifest().version,
    updatedAt: now
  };
}

export async function getTabGroups({ mode = GROUPING_MODES.BY_AGE } = {}) {
  const metadata = await reconcileOpenTabs();
  const [tabs, currentWindow] = await Promise.all([queryTabs({}), getCurrentWindow().catch(() => null)]);
  const extensionOrigin = chrome.runtime.getURL("");
  const viewModels = tabs.map((tab) => createTabViewModel(tab, metadata[tab.id], currentWindow, extensionOrigin));

  const groups = mode === GROUPING_MODES.BY_WINDOW
    ? groupTabsByWindow(viewModels, { currentWindowId: currentWindow?.id ?? null })
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
  const isExtensionOwned = Boolean(tab.url?.startsWith(extensionOrigin));
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url || "Untitled tab",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
    audible: Boolean(tab.audible),
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

  return runPerTab(safeIds, async (tabId) => {
    const tab = tabsById.get(tabId);
    if (!tab) throw new SkipTabError("标签不存在");
    if (tab.isExtensionOwned || tab.url?.startsWith(chrome.runtime.getURL(""))) {
      throw new SkipTabError("扩展页面已跳过");
    }
    if (tab.windowId === safeTarget) throw new SkipTabError("已在目标窗口");
    await moveTabs([tabId], { windowId: safeTarget, index: -1 });
  });
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
