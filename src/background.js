import {
  bookmarkTabs,
  activateTab,
  closeTabs,
  createWindowWithTabs,
  discardTabs,
  deleteSnapshot,
  getTabGroups,
  listSnapshots,
  listWindows,
  moveTabsToWindow,
  reconcileOpenTabs,
  recordTabOpened,
  removeTabMetadata,
  replaceTabMetadata,
  restoreSnapshot,
  saveSnapshot,
  saveWindowSnapshot
} from "./tab-service.js";
import { createTab } from "./chrome-api.js";

chrome.runtime.onInstalled.addListener(() => {
  reconcileOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  reconcileOpenTabs();
});

chrome.tabs.onCreated.addListener((tab) => {
  recordTabOpened(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabMetadata(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  replaceTabMetadata(addedTabId, removedTabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      return createTab({ url: chrome.runtime.getURL("dashboard.html") });
    case "activateTab":
      return activateTab(message.tabId, message.windowId);
    case "saveSnapshot":
      return saveSnapshot();
    case "saveWindowSnapshot":
      return saveWindowSnapshot(message.windowId);
    case "listSnapshots":
      return listSnapshots();
    case "deleteSnapshot":
      return deleteSnapshot(message.id);
    case "restoreSnapshot":
      return restoreSnapshot(message.id);
    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}
