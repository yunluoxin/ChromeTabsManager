import {
  bookmarkTabs,
  activateTab,
  closeTabs,
  createWindowWithTabs,
  discardTabs,
  deleteSnapshot,
  deleteSnapshots,
  exportSnapshots,
  getSnapshot,
  getTabGroups,
  importSnapshots,
  listSnapshots,
  listWindows,
  moveTabsToWindow,
  reconcileOpenTabs,
  recordTabOpened,
  removeTabMetadata,
  renameSnapshot,
  replaceTabMetadata,
  restoreSnapshot,
  saveSnapshot,
  saveSelectedSnapshot,
  saveWindowSnapshot
} from "./tab-service.js";
import { api, createTab, getExtensionUrl } from "./chrome-api.js";

api.runtime.onInstalled.addListener(() => {
  reconcileOpenTabs();
});

api.runtime.onStartup.addListener(() => {
  reconcileOpenTabs();
});

api.tabs.onCreated.addListener((tab) => {
  recordTabOpened(tab);
});

api.tabs.onRemoved.addListener((tabId) => {
  removeTabMetadata(tabId);
});

// tabs.onReplaced is Chromium-only (prerender/instant-tab swaps). Firefox has
// no equivalent event — capability-detect so the listener simply doesn't
// register there; URL-based reconciliation in reconcileOpenTabs is the
// fallback that keeps ages correct anyway.
if (api.tabs.onReplaced) {
  api.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    replaceTabMetadata(addedTabId, removedTabId);
  });
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "getTabs":
      return getTabGroups({ mode: message.mode });
    case "getWindows":
      return listWindows();
    case "closeTabs":
      return closeTabs(message.tabIds || []);
    case "bookmarkTabs":
      return bookmarkTabs(message.tabIds || [], message.options || {});
    case "discardTabs":
      return discardTabs(message.tabIds || []);
    case "moveTabs":
      return moveTabsToWindow(message.tabIds || [], message.targetWindowId);
    case "createWindowWithTabs":
      return createWindowWithTabs(message.tabIds || []);
    case "openDashboard":
      return createTab({ url: getExtensionUrl("dashboard.html") });
    case "openSnapshotManager":
      return createTab({ url: getExtensionUrl("snapshots.html") });
    case "activateTab":
      return activateTab(message.tabId, message.windowId);
    case "saveSnapshot":
      return saveSnapshot();
    case "saveWindowSnapshot":
      return saveWindowSnapshot(message.windowId);
    case "saveSelectedSnapshot":
      return saveSelectedSnapshot(message.tabIds || []);
    case "listSnapshots":
      return listSnapshots();
    case "getSnapshot":
      return getSnapshot(message.id);
    case "deleteSnapshot":
      return deleteSnapshot(message.id);
    case "deleteSnapshots":
      return deleteSnapshots(message.ids || []);
    case "exportSnapshots":
      return exportSnapshots(message.ids || []);
    case "importSnapshots":
      return importSnapshots(message.json);
    case "renameSnapshot":
      return renameSnapshot(message.id, message.label);
    case "restoreSnapshot":
      return restoreSnapshot(message.id);
    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}
