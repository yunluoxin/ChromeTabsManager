import { formatActionSummary } from "./action-summary.js";
import { NewWindowDropZone } from "./new-window-drop-zone.js";

const GROUPING_MODES = { BY_AGE: "by-age", BY_WINDOW: "by-window" };
const MODE_STORAGE_KEY = "dashboardMode";

const state = {
  tabs: [],
  groups: [],
  currentWindowId: null,
  selectedTabIds: new Set(),
  mode: GROUPING_MODES.BY_AGE,
  windows: [],
  dragCount: 0
};

let newWindowDropZone = null;

const elements = {
  body: document.body,
  summary: document.querySelector("#dashboardSummary"),
  status: document.querySelector("#dashboardStatus"),
  groups: document.querySelector("#tabGroups"),
  search: document.querySelector("#search"),
  windowFilter: document.querySelector("#windowFilter"),
  includeExtensionTabs: document.querySelector("#includeExtensionTabs"),
  refresh: document.querySelector("#refresh"),
  selectVisible: document.querySelector("#selectVisible"),
  selectAll: document.querySelector("#selectAll"),
  clearSelection: document.querySelector("#clearSelection"),
  bookmarkSelected: document.querySelector("#bookmarkSelected"),
  discardSelected: document.querySelector("#discardSelected"),
  closeSelected: document.querySelector("#closeSelected"),
  bookmarkMode: document.querySelector("#bookmarkMode"),
  folderName: document.querySelector("#folderName"),
  modeToggle: document.querySelector("#modeToggle"),
  moveSelectedTo: document.querySelector("#moveSelectedTo"),
  moveSelected: document.querySelector("#moveSelected")
};

init();

async function init() {
  state.mode = readStoredMode();
  applyModeAttribute();
  attachNewWindowDropZone();
  bindEvents();
  await Promise.all([loadTabs(), loadWindows()]);
}

function attachNewWindowDropZone() {
  newWindowDropZone = new NewWindowDropZone({
    onDrop: runCreateWindowWithTabs,
    getDraggedCount: () => state.dragCount
  });
  newWindowDropZone.attach();
}

function bindEvents() {
  elements.refresh.addEventListener("click", loadTabs);
  elements.search.addEventListener("input", render);
  elements.windowFilter.addEventListener("change", render);
  elements.includeExtensionTabs.addEventListener("change", render);
  elements.selectVisible.addEventListener("click", () => selectTabs(getVisibleTabs().filter((tab) => !tab.isExtensionOwned)));
  elements.selectAll.addEventListener("click", () => selectTabs(state.tabs.filter((tab) => !tab.isExtensionOwned)));
  elements.clearSelection.addEventListener("click", () => {
    state.selectedTabIds.clear();
    render();
  });
  elements.bookmarkSelected.addEventListener("click", () => runSelectedAction("bookmarkTabs"));
  elements.discardSelected.addEventListener("click", () => runSelectedAction("discardTabs"));
  elements.closeSelected.addEventListener("click", () => runSelectedAction("closeTabs"));
  elements.moveSelected.addEventListener("click", runSelectedMove);
  elements.groups.addEventListener("change", handleGroupChange);
  elements.groups.addEventListener("click", handleGroupClick);
  elements.groups.addEventListener("dragstart", handleDragStart);
  elements.groups.addEventListener("dragend", handleDragEnd);
  elements.groups.addEventListener("dragover", handleDragOver);
  elements.groups.addEventListener("dragleave", handleDragLeave);
  elements.groups.addEventListener("drop", handleDrop);
  elements.modeToggle.addEventListener("click", handleModeToggle);
}

function handleModeToggle(event) {
  const button = event.target.closest("button[data-mode]");
  if (!button) return;
  const nextMode = button.dataset.mode;
  if (nextMode === state.mode) return;
  state.mode = nextMode;
  persistMode(nextMode);
  applyModeAttribute();
  loadTabs();
}

function applyModeAttribute() {
  elements.body.dataset.mode = state.mode;
  for (const button of elements.modeToggle.querySelectorAll("button[data-mode]")) {
    button.setAttribute("aria-selected", String(button.dataset.mode === state.mode));
  }
}

function readStoredMode() {
  try {
    const stored = sessionStorage.getItem(MODE_STORAGE_KEY);
    return stored === GROUPING_MODES.BY_WINDOW ? GROUPING_MODES.BY_WINDOW : GROUPING_MODES.BY_AGE;
  } catch {
    return GROUPING_MODES.BY_AGE;
  }
}

function persistMode(mode) {
  try {
    sessionStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* sessionStorage may be unavailable; ignore. */
  }
}

async function loadTabs({ silent = false } = {}) {
  if (!silent) setStatus("正在读取标签…");
  try {
    const payload = await sendMessage({ type: "getTabs", mode: state.mode });
    state.tabs = payload.tabs;
    state.groups = payload.groups;
    state.currentWindowId = payload.currentWindowId;
    state.selectedTabIds = new Set([...state.selectedTabIds].filter((tabId) => state.tabs.some((tab) => tab.tabId === tabId)));
    render();
  } finally {
    if (!silent) setStatus("");
  }
}

async function loadWindows() {
  try {
    state.windows = await sendMessage({ type: "getWindows" });
  } catch {
    state.windows = [];
  }
  renderWindowOptions();
}

function renderWindowOptions() {
  const current = state.currentWindowId;
  const seenIds = new Set();
  const candidates = [];
  let number = 0;
  for (const windowGroup of state.groups) {
    if (windowGroup.windowId == null) continue;
    if (seenIds.has(windowGroup.windowId)) continue;
    seenIds.add(windowGroup.windowId);
    number++;
    candidates.push({
      windowId: windowGroup.windowId,
      label: formatWindowLabel(number, { isCurrent: windowGroup.windowId === current })
    });
  }
  for (const win of state.windows) {
    if (seenIds.has(win.id)) continue;
    seenIds.add(win.id);
    number++;
    candidates.push({ windowId: win.id, label: formatWindowLabel(number, { isCurrent: win.id === current }) });
  }

  elements.moveSelectedTo.innerHTML = candidates
    .map(({ windowId, label }) => {
      const disabled = windowId === current ? "disabled" : "";
      return `<option value="${windowId}" ${disabled}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function formatWindowLabel(index, { isCurrent = false } = {}) {
  if (index == null) return "未知窗口";
  return `窗口${index}${isCurrent ? " · 当前" : ""}`;
}

function render() {
  const visibleTabs = getVisibleTabs();
  const modeLabel = state.mode === GROUPING_MODES.BY_WINDOW ? "窗口" : "时间";
  elements.summary.textContent = `全部 ${state.tabs.length} 个 · 可见 ${visibleTabs.length} 个 · 已选 ${state.selectedTabIds.size} 个 · 排列 ${modeLabel}`;

  const groups = groupVisibleTabs(visibleTabs);
  elements.groups.innerHTML = groups.length
    ? groups.map(renderGroup).join("")
    : `<div class="empty">没有匹配的标签。</div>`;

  renderWindowOptions();
}

function renderGroup(group) {
  const draggableAttrs = state.mode === GROUPING_MODES.BY_WINDOW ? `data-window-id="${group.windowId}"` : "";
  const dragHint = state.mode === GROUPING_MODES.BY_WINDOW ? `title="拖到其它窗口即可移动"` : "";
  return `
    <article class="tab-group" ${draggableAttrs} ${dragHint}>
      <header class="group-header">
        <div>
          <h2>${escapeHtml(group.label)}</h2>
          <p>${group.tabs.length} 个标签</p>
        </div>
        <div class="group-actions">
          <button data-group-select="${group.key}">选择本组</button>
          <button data-group-bookmark="${group.key}">收藏本组</button>
          <button data-group-discard="${group.key}">释放本组</button>
          <button class="danger" data-group-close="${group.key}">关闭本组</button>
        </div>
      </header>
      <div class="tab-list">
        ${group.tabs.map(renderTab).join("")}
      </div>
    </article>
  `;
}

function renderTab(tab) {
  const checked = state.selectedTabIds.has(tab.tabId) ? "checked" : "";
  const disabled = tab.isExtensionOwned && !elements.includeExtensionTabs.checked ? "disabled" : "";
  const sourceLabel = tab.ageSource === "recorded" ? "真实记录" : tab.ageSource === "estimated" ? "历史估算" : "未知";
  const icon = tab.favIconUrl ? `<img src="${escapeAttribute(tab.favIconUrl)}" alt="">` : `<span class="favicon-fallback">•</span>`;
  const draggable = state.mode === GROUPING_MODES.BY_WINDOW && !tab.isExtensionOwned ? `draggable="true"` : "";
  return `
    <div class="tab-row ${tab.isExtensionOwned ? "protected" : ""}" data-tab-id="${tab.tabId}" ${draggable}>
      <input type="checkbox" data-tab-id="${tab.tabId}" ${checked} ${disabled}>
      ${icon}
      <span class="tab-main">
        <strong>${escapeHtml(tab.title)}</strong>
        <small>${escapeHtml(tab.url)}</small>
      </span>
      <span class="badge">${sourceLabel}</span>
      ${tab.pinned ? `<span class="badge">固定</span>` : ""}
      ${tab.discarded ? `<span class="badge">已释放</span>` : ""}
      <span class="row-actions" aria-label="单个标签操作">
        <button class="icon-button" title="跳转到标签" aria-label="跳转到标签" data-tab-open="${tab.tabId}" data-window-id="${tab.windowId}">↗</button>
        <button class="icon-button" title="释放此标签内存" aria-label="释放此标签内存" data-tab-discard="${tab.tabId}">◌</button>
        <button class="icon-button danger-icon" title="关闭此标签" aria-label="关闭此标签" data-tab-close="${tab.tabId}">×</button>
      </span>
    </div>
  `;
}

function getVisibleTabs() {
  const query = elements.search.value.trim().toLowerCase();
  return state.tabs.filter((tab) => {
    if (!elements.includeExtensionTabs.checked && tab.isExtensionOwned) return false;
    if (elements.windowFilter.value === "current" && tab.windowId !== state.currentWindowId) return false;
    if (!query) return true;
    return `${tab.title} ${tab.url}`.toLowerCase().includes(query);
  });
}

function groupVisibleTabs(visibleTabs) {
  const groups = [];
  for (const sourceGroup of state.groups) {
    const tabIds = new Set(sourceGroup.tabs.map((tab) => tab.tabId));
    const tabs = visibleTabs.filter((tab) => tabIds.has(tab.tabId));
    if (tabs.length) groups.push({ ...sourceGroup, tabs });
  }
  return groups;
}

function handleGroupChange(event) {
  const checkbox = event.target.closest("[data-tab-id]");
  if (!checkbox) return;
  const tabId = Number(checkbox.dataset.tabId);
  if (checkbox.checked) {
    state.selectedTabIds.add(tabId);
  } else {
    state.selectedTabIds.delete(tabId);
  }
  render();
}

async function handleGroupClick(event) {
  const button = event.target.closest("button");
  if (button) {
    const rowActionHandled = await handleRowAction(button);
    if (rowActionHandled) return;

    const groupKey = button.dataset.groupSelect || button.dataset.groupBookmark || button.dataset.groupDiscard || button.dataset.groupClose;
    if (!groupKey) return;

    const groupTabs = getVisibleTabs().filter((tab) => tab.groupKey === groupKey && !tab.isExtensionOwned);
    if (button.dataset.groupSelect) {
      selectTabs(groupTabs);
      return;
    }
    if (button.dataset.groupBookmark) await runAction("bookmarkTabs", groupTabs.map((tab) => tab.tabId));
    if (button.dataset.groupDiscard) await runAction("discardTabs", groupTabs.map((tab) => tab.tabId));
    if (button.dataset.groupClose) await runAction("closeTabs", groupTabs.map((tab) => tab.tabId));
    return;
  }

  // Clicking the row body (not a button, not the checkbox) toggles selection.
  // The native checkbox change handler still fires when the checkbox itself is clicked.
  const row = event.target.closest(".tab-row");
  if (!row) return;
  if (event.target.closest('input[type="checkbox"]')) return;
  const checkbox = row.querySelector('input[type="checkbox"]');
  if (!checkbox || checkbox.disabled) return;
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
}

async function handleRowAction(button) {
  if (button.dataset.tabOpen) {
    const tabId = Number(button.dataset.tabOpen);
    const windowId = Number(button.dataset.windowId);
    await sendMessage({ type: "activateTab", tabId, windowId });
    setStatus("已跳转到标签。");
    return true;
  }

  if (button.dataset.tabDiscard) {
    await runAction("discardTabs", [Number(button.dataset.tabDiscard)], { confirmAction: false });
    return true;
  }

  if (button.dataset.tabClose) {
    await runAction("closeTabs", [Number(button.dataset.tabClose)], { confirmAction: false });
    return true;
  }

  return false;
}

function selectTabs(tabs) {
  for (const tab of tabs) {
    state.selectedTabIds.add(tab.tabId);
  }
  render();
}

async function runSelectedAction(type) {
  await runAction(type, [...state.selectedTabIds]);
}

async function runAction(type, tabIds, { confirmAction = true } = {}) {
  if (tabIds.length === 0) {
    setStatus("没有选中的标签。");
    return;
  }

  if (confirmAction && type === "closeTabs" && !confirm(`关闭 ${tabIds.length} 个标签？这个操作不可撤销。`)) return;

  const message = { type, tabIds };
  if (type === "bookmarkTabs") {
    message.options = {
      mode: elements.bookmarkMode.value,
      folderName: elements.folderName.value
    };
  }

  setStatus("执行中…");
  const result = await sendMessage(message);
  await loadTabs({ silent: true });
  setStatus(formatActionSummary(result));
}

async function runSelectedMove() {
  if (state.mode !== GROUPING_MODES.BY_WINDOW) {
    setStatus("切换到「按窗口」模式才能移动标签。");
    return;
  }
  const tabIds = [...state.selectedTabIds].filter((tabId) => {
    const tab = state.tabs.find((entry) => entry.tabId === tabId);
    return tab && !tab.isExtensionOwned;
  });
  if (tabIds.length === 0) {
    setStatus("没有可移动的非扩展标签。");
    return;
  }
  const targetWindowId = Number(elements.moveSelectedTo.value);
  if (!Number.isFinite(targetWindowId)) {
    setStatus("请选择目标窗口。");
    return;
  }
  await runMove(tabIds, targetWindowId);
}

async function runMove(tabIds, targetWindowId) {
  setStatus("执行中…");
  const result = await sendMessage({ type: "moveTabs", tabIds, targetWindowId });
  await Promise.all([loadTabs({ silent: true }), loadWindows()]);
  setStatus(`移动完成：${formatActionSummary(result)}`);
}

async function runCreateWindowWithTabs(tabIds) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) return;
  setStatus("正在创建新窗口…");
  try {
    const result = await sendMessage({ type: "createWindowWithTabs", tabIds });
    await Promise.all([loadTabs({ silent: true }), loadWindows()]);
    setStatus(`新窗口已建：${formatActionSummary(result)}`);
  } catch (error) {
    setStatus(`新建窗口失败：${error.message}`);
  }
}

function handleDragStart(event) {
  if (state.mode !== GROUPING_MODES.BY_WINDOW) return;
  const row = event.target.closest(".tab-row");
  if (!row || !row.hasAttribute("draggable")) return;
  const draggedTabId = Number(row.dataset.tabId);
  const draggedTab = state.tabs.find((tab) => tab.tabId === draggedTabId);
  if (!draggedTab || draggedTab.isExtensionOwned) {
    event.preventDefault();
    return;
  }

  let tabIds;
  if (state.selectedTabIds.has(draggedTabId) && state.selectedTabIds.size > 1) {
    // Drag the whole selection (non-extension only).
    tabIds = [...state.selectedTabIds].filter((id) => {
      const tab = state.tabs.find((entry) => entry.tabId === id);
      return tab && !tab.isExtensionOwned;
    });
  } else {
    // Drag just this row. Don't re-render here: rebuilding the tab groups
    // mid-drag would tear down the dragged element and kill the drag.
    tabIds = [draggedTabId];
  }

  if (tabIds.length === 0) {
    event.preventDefault();
    return;
  }

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-tab-ids", JSON.stringify(tabIds));
  event.dataTransfer.setData("text/plain", tabIds.join(","));
  state.dragCount = tabIds.length;
}

function handleDragEnd() {
  for (const element of elements.groups.querySelectorAll(".tab-group.drag-over")) {
    element.classList.remove("drag-over");
  }
}

function handleDragOver(event) {
  if (state.mode !== GROUPING_MODES.BY_WINDOW) return;
  const group = event.target.closest(".tab-group");
  if (!group || !group.dataset.windowId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  group.classList.add("drag-over");
}

function handleDragLeave(event) {
  const group = event.target.closest(".tab-group");
  if (!group) return;
  if (event.relatedTarget && group.contains(event.relatedTarget)) return;
  group.classList.remove("drag-over");
}

async function handleDrop(event) {
  if (state.mode !== GROUPING_MODES.BY_WINDOW) return;
  const group = event.target.closest(".tab-group");
  if (!group) return;
  event.preventDefault();
  group.classList.remove("drag-over");

  const targetWindowId = Number(group.dataset.windowId);
  if (!Number.isFinite(targetWindowId)) return;

  const raw = event.dataTransfer.getData("application/x-tab-ids");
  let tabIds = [];
  if (raw) {
    try {
      tabIds = JSON.parse(raw);
    } catch {
      tabIds = [];
    }
  }
  if (!tabIds.length) {
    const fallback = event.dataTransfer.getData("text/plain");
    if (fallback) tabIds = fallback.split(",").map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
  }
  tabIds = tabIds.filter((tabId) => {
    const tab = state.tabs.find((entry) => entry.tabId === tabId);
    return tab && !tab.isExtensionOwned && tab.windowId !== targetWindowId;
  });
  if (tabIds.length === 0) return;

  await runMove(tabIds, targetWindowId);
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[character];
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
