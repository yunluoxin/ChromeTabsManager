// Single entry point for every WebExtension API call in this codebase.
//
// Two API namespaces exist in the wild:
//   browser.* — Firefox (and Safari), native Promise, no runtime.lastError
//   chrome.*  — Chromium family (Chrome/Edge/Brave/Arc/…), callback style
//               (MV3 methods also return a Promise when no callback is given)
// Firefox ships a chrome.* alias, but we want the Promise-native browser.*,
// so detection order matters: browser first.
//
// Business code must never touch `chrome`/`browser` directly — new API needs
// get a wrapper here, which keeps every browser difference confined to this
// file. Feature differences (e.g. tabs.onReplaced missing on Firefox) are
// handled by capability detection at the call site, never UA sniffing.

export const api = typeof browser !== "undefined" ? browser : chrome;

// True when running on the Promise-native namespace (Firefox/Safari).
const IS_PROMISE_NATIVE = typeof browser !== "undefined";

export function callChrome(fn, ...args) {
  if (IS_PROMISE_NATIVE) {
    return fn(...args);
  }
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

export function getFromStorage(keys) {
  return callChrome(api.storage.local.get.bind(api.storage.local), keys);
}

export function setInStorage(value) {
  return callChrome(api.storage.local.set.bind(api.storage.local), value);
}

export function queryTabs(queryInfo = {}) {
  return callChrome(api.tabs.query.bind(api.tabs), queryInfo);
}

// Returns the active tab of the most recently focused NORMAL window, or null
// if there is none. Used by UI pages (popup / snapshots manager) to resolve
// "the window the user is interacting with" — chrome.windows.getCurrent lies
// when called from the service worker, especially on Chrome MV3.
export async function queryLastFocusedActiveTab() {
  const tabs = await callChrome(
    api.tabs.query.bind(api.tabs),
    { active: true, lastFocusedWindow: true }
  );
  return tabs && tabs.length > 0 ? tabs[0] : null;
}

export function getCurrentWindow() {
  return callChrome(api.windows.getCurrent.bind(api.windows), {});
}

export function removeTabs(tabIds) {
  return callChrome(api.tabs.remove.bind(api.tabs), tabIds);
}

export function discardTab(tabId) {
  return callChrome(api.tabs.discard.bind(api.tabs), tabId);
}

export function updateTab(tabId, updateProperties) {
  return callChrome(api.tabs.update.bind(api.tabs), tabId, updateProperties);
}

export function focusWindow(windowId) {
  return callChrome(api.windows.update.bind(api.windows), windowId, { focused: true });
}

export function moveTabs(tabIds, moveProperties) {
  return callChrome(api.tabs.move.bind(api.tabs), tabIds, moveProperties);
}

export async function queryWindows(queryInfo = {}) {
  const result = await callChrome(api.windows.getAll.bind(api.windows), queryInfo);
  return result || [];
}

export function createBookmark(bookmark) {
  return callChrome(api.bookmarks.create.bind(api.bookmarks), bookmark);
}

export function searchHistory(query) {
  return callChrome(api.history.search.bind(api.history), query);
}

export function createTab(createProperties) {
  return callChrome(api.tabs.create.bind(api.tabs), createProperties);
}

export function createWindow(createData) {
  return callChrome(api.windows.create.bind(api.windows), createData);
}

export function getExtensionUrl(path) {
  return api.runtime.getURL(path);
}

export function getExtensionVersion() {
  return api.runtime.getManifest().version;
}

// Sender-side message channel shared by popup/dashboard/snapshots. Resolves
// with the payload on { ok: true }, rejects with the error message otherwise
// (mirrors background.js's response envelope).
export function sendMessage(message) {
  const respond = (response) => {
    if (!response?.ok) {
      throw new Error(response?.error || "Unknown extension error");
    }
    return response.payload;
  };
  if (IS_PROMISE_NATIVE) {
    return api.runtime.sendMessage(message).then(respond);
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      try {
        resolve(respond(response));
      } catch (err) {
        reject(err);
      }
    });
  });
}
