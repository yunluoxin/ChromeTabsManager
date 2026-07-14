import { isOldGroup } from "./age-grouping.js";
import { formatActionSummary } from "./action-summary.js";
import { THEMES, applyTheme, getStoredTheme, setStoredTheme, subscribeThemeChange, subscribeSystemChange } from "./theme.js";
import { showToast } from "./toast.js";

const state = {
  groups: [],
  tabs: [],
  currentWindowId: null,
  snapshotListOpen: false,
  snapshots: []
};

const elements = {
  summary: document.querySelector("#summary"),
  openDashboard: document.querySelector("#openDashboard"),
  discardAll: document.querySelector("#discardAll"),
  discardOld: document.querySelector("#discardOld"),
  saveAll: document.querySelector("#saveAll"),
  restoreAll: document.querySelector("#restoreAll"),
  snapshotList: document.querySelector("#snapshotList"),
  themeToggle: document.querySelector("#themeToggle")
};

init();

async function init() {
  await initTheme();
  bindEvents();
  await loadTabs();
}

async function initTheme() {
  const initial = await getStoredTheme();
  applyTheme(initial);
  refreshThemeToggle(initial);

  elements.themeToggle.addEventListener("click", handleThemeClick);
  // Cross-page sync: dashboard may flip the toggle while popup is open.
  subscribeThemeChange((next) => {
    applyTheme(next);
    refreshThemeToggle(next);
  });
  // OS-level theme change only matters when the user is on "system".
  subscribeSystemChange(() => {
    if (document.body.dataset.themeSource === THEMES.SYSTEM) {
      applyTheme(THEMES.SYSTEM);
    }
  });
}

async function handleThemeClick(event) {
  const button = event.target.closest("button[data-theme]");
  if (!button) return;
  const next = button.dataset.theme;
  if (!Object.values(THEMES).includes(next)) return;
  await setStoredTheme(next);
  applyTheme(next);
  refreshThemeToggle(next);
}

function refreshThemeToggle(current) {
  const buttons = elements.themeToggle.querySelectorAll("button[data-theme]");
  buttons.forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.theme === current));
  });
}

function bindEvents() {
  elements.openDashboard.addEventListener("click", () => sendMessage({ type: "openDashboard" }));
  elements.discardAll.addEventListener("click", () => discardAllTabs());
  elements.discardOld.addEventListener("click", () => discardOldTabs());
  elements.saveAll.addEventListener("click", () => saveAllTabs());
  elements.restoreAll.addEventListener("click", () => toggleSnapshotList());
  elements.snapshotList.addEventListener("click", handleSnapshotListClick);
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

async function loadTabs() {
  // The summary line doubles as the load indicator; render() will replace
  // it with the actual counts as soon as the data arrives.
  elements.summary.textContent = "正在读取标签…";
  const payload = await sendMessage({ type: "getTabs" });
  state.groups = payload.groups;
  state.tabs = payload.tabs;
  state.currentWindowId = payload.currentWindowId;
  render();
}

function render() {
  const currentWindowCount = state.tabs.filter((tab) => tab.windowId === state.currentWindowId).length;
  elements.summary.textContent = `全部 ${state.tabs.length} 个 · 当前窗口 ${currentWindowCount} 个`;
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
    showToast(emptyMessage);
    return;
  }

  setButtonState(button, "loading");
  try {
    const result = await sendMessage({ type: "discardTabs", tabIds });
    await loadTabs();
    showToast(formatActionSummary(result));
    setButtonState(button, "success");
  } catch (error) {
    setButtonState(button, "idle");
    throw error;
  }
}

async function saveAllTabs() {
  setButtonState(elements.saveAll, "loading");
  try {
    const meta = await sendMessage({ type: "saveSnapshot" });
    showToast(`已保存：${meta.label} · ${meta.windowCount} 窗口 · ${meta.tabCount} 标签`);
    if (state.snapshotListOpen) {
      await loadAndRenderSnapshots();
    }
    setButtonState(elements.saveAll, "success");
  } catch (error) {
    setButtonState(elements.saveAll, "idle");
    throw error;
  }
}

async function toggleSnapshotList() {
  state.snapshotListOpen = !state.snapshotListOpen;
  elements.snapshotList.hidden = !state.snapshotListOpen;
  if (state.snapshotListOpen) {
    await loadAndRenderSnapshots();
  }
}

async function loadAndRenderSnapshots() {
  try {
    state.snapshots = await sendMessage({ type: "listSnapshots" });
  } catch (error) {
    state.snapshots = [];
    showToast(error.message, { type: "error" });
  }
  renderSnapshotList();
}

function renderSnapshotList() {
  if (state.snapshots.length === 0) {
    elements.snapshotList.innerHTML = `<div class="snapshot-empty">暂无快照</div>`;
    return;
  }
  elements.snapshotList.innerHTML = state.snapshots
    .map((snapshot) => renderSnapshotRow(snapshot))
    .join("");
}

function renderSnapshotRow(snapshot) {
  // The label and counts are numbers from our own storage, but keep the
  // defensive escaping in case anything in the chain ever changes.
  const label = escapeHtml(snapshot.label);
  return `
    <div class="snapshot-row" data-snapshot-id="${escapeAttribute(snapshot.id)}">
      <div class="snapshot-row__meta">
        <span class="snapshot-row__time">${label}</span>
        <span class="snapshot-row__stats">${snapshot.windowCount} 窗口 · ${snapshot.tabCount} 标签</span>
      </div>
      <div class="snapshot-row__actions">
        <button type="button" class="icon-button" data-action="restore" title="恢复" aria-label="恢复">↺</button>
        <button type="button" class="icon-button icon-button--danger" data-action="delete" title="删除" aria-label="删除">×</button>
      </div>
    </div>
  `;
}

async function handleSnapshotListClick(event) {
  const row = event.target.closest(".snapshot-row");
  if (!row) return;
  const id = row.dataset.snapshotId;
  const action = event.target.closest("button[data-action]")?.dataset.action;
  if (!id || !action) return;
  if (action === "restore") {
    await restoreSnapshotById(id);
  } else if (action === "delete") {
    await deleteSnapshotById(id);
  }
}

async function restoreSnapshotById(id) {
  showToast("正在恢复…");
  try {
    const result = await sendMessage({ type: "restoreSnapshot", id });
    showToast(`已恢复：${formatActionSummary(result)}`);
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

async function deleteSnapshotById(id) {
  try {
    await sendMessage({ type: "deleteSnapshot", id });
    state.snapshots = state.snapshots.filter((snapshot) => snapshot.id !== id);
    renderSnapshotList();
    showToast("已删除快照。");
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
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
    showToast(error.message, { type: "error" });
    throw error;
  });
}
