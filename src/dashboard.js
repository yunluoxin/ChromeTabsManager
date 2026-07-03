import { formatActionSummary } from "./action-summary.js";

const state = {
  tabs: [],
  groups: [],
  currentWindowId: null,
  selectedTabIds: new Set()
};

const elements = {
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
  folderName: document.querySelector("#folderName")
};

init();

async function init() {
  bindEvents();
  await loadTabs();
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
  elements.groups.addEventListener("change", handleGroupChange);
  elements.groups.addEventListener("click", handleGroupClick);
}

async function loadTabs({ preserveStatus = false } = {}) {
  setStatus("正在读取标签…");
  const payload = await sendMessage({ type: "getTabs" });
  state.tabs = payload.tabs;
  state.groups = payload.groups;
  state.currentWindowId = payload.currentWindowId;
  state.selectedTabIds = new Set([...state.selectedTabIds].filter((tabId) => state.tabs.some((tab) => tab.tabId === tabId)));
  render();
  if (!preserveStatus) {
    setStatus("");
  }
}

function render() {
  const visibleTabs = getVisibleTabs();
  elements.summary.textContent = `全部 ${state.tabs.length} 个 · 可见 ${visibleTabs.length} 个 · 已选 ${state.selectedTabIds.size} 个`;

  const groups = groupVisibleTabs(visibleTabs);
  elements.groups.innerHTML = groups.length
    ? groups.map(renderGroup).join("")
    : `<div class="empty">没有匹配的标签。</div>`;
}

function renderGroup(group) {
  return `
    <article class="tab-group">
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
  return `
    <div class="tab-row ${tab.isExtensionOwned ? "protected" : ""}">
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
  if (confirmAction && type === "discardTabs" && !confirm(`释放 ${tabIds.length} 个后台标签的内存？活动/固定标签会跳过。`)) return;

  const message = { type, tabIds };
  if (type === "bookmarkTabs") {
    message.options = {
      mode: elements.bookmarkMode.value,
      folderName: elements.folderName.value
    };
  }

  setStatus("执行中…");
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[character];
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
