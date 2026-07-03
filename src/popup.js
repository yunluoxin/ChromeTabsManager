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
  bookmarkOld: document.querySelector("#bookmarkOld"),
  discardOld: document.querySelector("#discardOld"),
  closeOld: document.querySelector("#closeOld")
};

init();

async function init() {
  bindEvents();
  await loadTabs();
}

function bindEvents() {
  elements.openDashboard.addEventListener("click", () => sendMessage({ type: "openDashboard" }));
  elements.bookmarkOld.addEventListener("click", () => actOnOldTabs("bookmarkTabs", "收藏旧标签？"));
  elements.discardOld.addEventListener("click", () => actOnOldTabs("discardTabs", "释放旧标签内存？"));
  elements.closeOld.addEventListener("click", () => actOnOldTabs("closeTabs", "关闭旧标签？这个操作不可撤销。"));
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

async function actOnOldTabs(type, confirmationText) {
  const oldTabIds = state.groups
    .filter((group) => isOldGroup(group.key))
    .flatMap((group) => group.tabs)
    .filter((tab) => !tab.isExtensionOwned)
    .map((tab) => tab.tabId);

  if (oldTabIds.length === 0) {
    setStatus("没有可处理的旧标签。");
    return;
  }

  if ((type === "closeTabs" || oldTabIds.length > 10) && !confirm(`${confirmationText}\n共 ${oldTabIds.length} 个标签。`)) {
    return;
  }

  const message = { type, tabIds: oldTabIds };
  if (type === "bookmarkTabs") {
    message.options = { mode: "folder" };
  }
  const result = await sendMessage(message);
  await loadTabs({ preserveStatus: true });
  setStatus(formatActionSummary(result));
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
