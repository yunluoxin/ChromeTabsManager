export function callChrome(fn, ...args) {
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
  return callChrome(chrome.storage.local.get.bind(chrome.storage.local), keys);
}

export function setInStorage(value) {
  return callChrome(chrome.storage.local.set.bind(chrome.storage.local), value);
}

export function queryTabs(queryInfo = {}) {
  return callChrome(chrome.tabs.query.bind(chrome.tabs), queryInfo);
}

export function getCurrentWindow() {
  return callChrome(chrome.windows.getCurrent.bind(chrome.windows), {});
}

export function removeTabs(tabIds) {
  return callChrome(chrome.tabs.remove.bind(chrome.tabs), tabIds);
}

export function discardTab(tabId) {
  return callChrome(chrome.tabs.discard.bind(chrome.tabs), tabId);
}

export function updateTab(tabId, updateProperties) {
  return callChrome(chrome.tabs.update.bind(chrome.tabs), tabId, updateProperties);
}

export function focusWindow(windowId) {
  return callChrome(chrome.windows.update.bind(chrome.windows), windowId, { focused: true });
}

export function createBookmark(bookmark) {
  return callChrome(chrome.bookmarks.create.bind(chrome.bookmarks), bookmark);
}

export function searchHistory(query) {
  return callChrome(chrome.history.search.bind(chrome.history), query);
}

export function createTab(createProperties) {
  return callChrome(chrome.tabs.create.bind(chrome.tabs), createProperties);
}
