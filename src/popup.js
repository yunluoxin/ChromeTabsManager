import { isOldGroup } from "./age-grouping.js";
import { formatActionSummary } from "./action-summary.js";

const state = {
  groups: [],
  tabs: [],
  currentWindowId: null
};

const elements = {
  summary: document.querySelector("#summary"),
  groups: document.querySelector("#groups"),
  status: document.querySelector("#status"),
  openDashboard: document.querySelector("#openDashboard"),
  discardAll: document.querySelector("#discardAll"),
  discardOld: document.querySelector("#discardOld")
};

init();

async function init() {
  bindEvents();
  await loadTabs();
}

function bindEvents() {
  elements.openDashboard.addEventListener("click", () => sendMessage({ type: "openDashboard" }));
  elements.discardAll.addEventListener("click", () => discardAllTabs());
  elements.discardOld.addEventListener("click", () => discardOldTabs());
}

const resetTimers = new WeakMap();
const SUCCESS_DURATION_MS = 1400;

function setButtonState(button, state) {
  const pending = resetTimers.get(button);
  if (pending) {
    clearTimeout(pending);
    resetTimers.delete(button);
  }
  button.classList.remove("is-loading", "is-success");
  if (state === "loading") {
    button.classList.add("is-loading");
  } else if (state === "success") {
    button.classList.add("is-success");
    resetTimers.set(
      button,
      setTimeout(() => {
        button.classList.remove("is-loading", "is-success");
        resetTimers.delete(button);
      }, SUCCESS_DURATION_MS)
    );
  }
}

async function loadTabs({ preserveStatus = false } = {}) {
  setStatus("正在读取标签…");
  const payload = await sendMessage({ type: "getTabs" });
  state.groups = payload.groups;
  state.tabs = payload.tabs;
  state.currentWindowId = payload.currentWindowId;
  render();
  if (!preserveStatus) {
    setStatus("");
  }
}

function render() {
  const currentWindowCount = state.tabs.filter((tab) => tab.windowId === state.currentWindowId).length;
  elements.summary.textContent = `全部 ${state.tabs.length} 个 · 当前窗口 ${currentWindowCount} 个`;
  elements.groups.innerHTML = state.groups
    .map((group) => `<article class="summary-card"><span>${group.label}</span><strong>${group.tabs.length}</strong></article>`)
    .join("");
}

async function discardAllTabs() {
  const tabIds = state.tabs
    .filter((tab) => !tab.isExtensionOwned)
    .map((tab) => tab.tabId);
  await runDiscard(elements.discardAll, tabIds, "没有可释放的标签。");
}

async function discardOldTabs() {
  const tabIds = state.groups
    .filter((group) => isOldGroup(group.key))
    .flatMap((group) => group.tabs)
    .filter((tab) => !tab.isExtensionOwned)
    .map((tab) => tab.tabId);
  await runDiscard(elements.discardOld, tabIds, "没有可处理的旧标签。");
}

async function runDiscard(button, tabIds, emptyMessage) {
  if (tabIds.length === 0) {
    setStatus(emptyMessage);
    return;
  }

  setButtonState(button, "loading");
  try {
    const result = await sendMessage({ type: "discardTabs", tabIds });
    await loadTabs({ preserveStatus: true });
    setStatus(formatActionSummary(result));
    setButtonState(button, "success");
  } catch (error) {
    setButtonState(button, "idle");
    throw error;
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Unknown extension error"));
        return;
      }
      resolve(response.payload);
    });
  }).catch((error) => {
    setStatus(error.message);
    throw error;
  });
}
