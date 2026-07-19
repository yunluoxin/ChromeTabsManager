import { formatActionSummary } from "./action-summary.js";
import { formatSnapshotLabel } from "./tab-snapshot.js";
import { THEMES, applyTheme, getStoredTheme, setStoredTheme, subscribeThemeChange, subscribeSystemChange } from "./theme.js";
import { showToast } from "./toast.js";

const state = {
  tabs: [],
  currentWindowId: null,
  snapshots: []
};

const elements = {
  windowCount: document.querySelector("#windowCount"),
  tabCount: document.querySelector("#tabCount"),
  openDashboard: document.querySelector("#openDashboard"),
  discardAll: document.querySelector("#discardAll"),
  saveAll: document.querySelector("#saveAll"),
  saveCurrentWindow: document.querySelector("#saveCurrentWindow"),
  snapshotList: document.querySelector("#snapshotList"),
  snapshotCount: document.querySelector("#snapshotCount"),
  openSnapshotManager: document.querySelector("#openSnapshotManager"),
  themeToggle: document.querySelector("#themeToggle")
};

init();

async function init() {
  await initTheme();
  bindEvents();
  // Snapshots and tab counts load in parallel; whichever resolves first
  // renders its own section.
  await Promise.all([loadTabs(), loadAndRenderSnapshots()]);
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
  elements.saveAll.addEventListener("click", () => saveAllTabs());
  elements.saveCurrentWindow.addEventListener("click", () => saveCurrentWindowTabs());
  elements.snapshotList.addEventListener("click", handleSnapshotListClick);
  elements.openSnapshotManager.addEventListener("click", () => sendMessage({ type: "openSnapshotManager" }));
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
  const payload = await sendMessage({ type: "getTabs" });
  state.tabs = payload.tabs;
  state.currentWindowId = payload.currentWindowId;
  render();
}

function render() {
  const windowCount = new Set(state.tabs.map((tab) => tab.windowId)).size;
  elements.windowCount.textContent = windowCount;
  elements.tabCount.textContent = state.tabs.length;
}

async function discardAllTabs() {
  const tabIds = state.tabs
    .filter((tab) => !tab.isExtensionOwned)
    .map((tab) => tab.tabId);
  if (tabIds.length === 0) {
    showToast("没有可释放的标签。");
    return;
  }

  setButtonState(elements.discardAll, "loading");
  try {
    const result = await sendMessage({ type: "discardTabs", tabIds });
    await loadTabs();
    showToast(formatActionSummary(result));
    setButtonState(elements.discardAll, "success");
  } catch (error) {
    setButtonState(elements.discardAll, "idle");
    throw error;
  }
}

async function saveAllTabs() {
  setButtonState(elements.saveAll, "loading");
  try {
    const meta = await sendMessage({ type: "saveSnapshot" });
    showToast(`已保存：${meta.label} · ${meta.windowCount} 窗口 · ${meta.tabCount} 标签`);
    await loadAndRenderSnapshots();
    setButtonState(elements.saveAll, "success");
  } catch (error) {
    setButtonState(elements.saveAll, "idle");
    throw error;
  }
}

async function saveCurrentWindowTabs() {
  if (state.currentWindowId == null) {
    showToast("无法确定当前窗口。", { type: "error" });
    return;
  }
  setButtonState(elements.saveCurrentWindow, "loading");
  try {
    const meta = await sendMessage({ type: "saveWindowSnapshot", windowId: state.currentWindowId });
    showToast(`已保存：${meta.label} · ${meta.tabCount} 标签`);
    await loadAndRenderSnapshots();
    setButtonState(elements.saveCurrentWindow, "success");
  } catch (error) {
    setButtonState(elements.saveCurrentWindow, "idle");
    throw error;
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
  elements.snapshotCount.textContent = state.snapshots.length > 0 ? `${state.snapshots.length} 个` : "";
  if (state.snapshots.length === 0) {
    elements.snapshotList.innerHTML = `<div class="snapshot-empty">暂无快照 · 点上方按钮保存当前状态</div>`;
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
  const createdAtLabel = escapeHtml(formatSnapshotLabel(snapshot.createdAt));
  return `
    <div class="snapshot-row" data-snapshot-id="${escapeAttribute(snapshot.id)}" title="点击恢复此快照">
      <div class="snapshot-row__meta">
        <span class="snapshot-row__time">${label}</span>
        <span class="snapshot-row__stats">${snapshot.windowCount} 窗口 · ${snapshot.tabCount} 标签 · ${createdAtLabel}</span>
      </div>
      <div class="snapshot-row__actions">
        <button type="button" class="icon-button" data-action="rename" title="修改名称" aria-label="修改名称">✎</button>
        <button type="button" class="icon-button icon-button--danger" data-action="delete" title="删除" aria-label="删除">×</button>
      </div>
    </div>
  `;
}

async function handleSnapshotListClick(event) {
  const row = event.target.closest(".snapshot-row");
  if (!row) return;
  const id = row.dataset.snapshotId;
  if (!id) return;
  // Row body click restores; icon buttons do their own thing.
  const action = event.target.closest("button[data-action]")?.dataset.action ?? "restore";
  if (action === "rename") {
    await renameSnapshotById(id);
  } else if (action === "delete") {
    await deleteSnapshotById(id);
  } else {
    await restoreSnapshotById(id);
  }
}

async function renameSnapshotById(id) {
  const target = state.snapshots.find((snapshot) => snapshot.id === id);
  if (!target) return;
  const next = window.prompt("修改快照名称", target.label);
  if (next === null) return; // user cancelled
  const trimmed = next.trim();
  if (!trimmed) {
    showToast("名称不能为空。", { type: "error" });
    return;
  }
  if (trimmed === target.label) return;
  try {
    const updated = await sendMessage({ type: "renameSnapshot", id, label: trimmed });
    // Replace the local copy so the next render picks up the new label without
    // a round-trip to the service worker.
    state.snapshots = state.snapshots.map((snapshot) =>
      snapshot.id === id ? { ...snapshot, ...updated } : snapshot
    );
    renderSnapshotList();
    showToast("已更新名称。");
  } catch (error) {
    showToast(error.message, { type: "error" });
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
  const target = state.snapshots.find((snapshot) => snapshot.id === id);
  const name = target?.label || "这个快照";
  if (!window.confirm(`删除快照「${name}」？删除后无法恢复。`)) return;
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
