// Snapshot manager page controller. The popup's snapshot section links here;
// everything heavier than one-click restore (multi-select, export, import,
// preview) lives on this full page.
import { formatActionSummary } from "./action-summary.js";
import { api, sendMessage as sendExtensionMessage } from "./chrome-api.js";
import { formatSnapshotLabel } from "./tab-snapshot.js";
import { THEMES, applyTheme, getStoredTheme, setStoredTheme, subscribeThemeChange, subscribeSystemChange } from "./theme.js";
import { showToast } from "./toast.js";

const state = {
  snapshots: [],
  selectedIds: new Set(),
  query: "",
  previewId: null,
  previewSnapshot: null,
  currentWindowId: null
};

const elements = {
  summary: document.querySelector("#snapshotSummary"),
  search: document.querySelector("#search"),
  saveAll: document.querySelector("#saveAll"),
  saveCurrentWindow: document.querySelector("#saveCurrentWindow"),
  importButton: document.querySelector("#importButton"),
  importFile: document.querySelector("#importFile"),
  selectionBar: document.querySelector("#selectionBar"),
  selectAll: document.querySelector("#selectAll"),
  selectionCount: document.querySelector("#selectionCount"),
  exportSelected: document.querySelector("#exportSelected"),
  deleteSelected: document.querySelector("#deleteSelected"),
  list: document.querySelector("#snapshotList"),
  previewOverlay: document.querySelector("#previewOverlay"),
  previewPanel: document.querySelector(".snapshot-preview"),
  previewTitle: document.querySelector("#previewTitle"),
  previewStats: document.querySelector("#previewStats"),
  previewBody: document.querySelector("#previewBody"),
  closePreview: document.querySelector("#closePreview"),
  restorePreview: document.querySelector("#restorePreview"),
  refresh: document.querySelector("#refresh"),
  themeToggle: document.querySelector("#themeToggle")
};

init();

async function init() {
  await initTheme();
  bindEvents();
  // Live sync: popup (or another manager tab) mutating snapshots lands in
  // storage.local — reload the list so this page never goes stale.
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.tabSnapshots) loadSnapshots();
  });
  await Promise.all([loadSnapshots(), loadCurrentWindow()]);
}

async function initTheme() {
  const initial = await getStoredTheme();
  applyTheme(initial);
  refreshThemeToggle(initial);

  elements.themeToggle.addEventListener("click", handleThemeClick);
  subscribeThemeChange((next) => {
    applyTheme(next);
    refreshThemeToggle(next);
  });
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
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim().toLowerCase();
    renderList();
  });
  elements.saveAll.addEventListener("click", () => saveAllWindows());
  elements.saveCurrentWindow.addEventListener("click", () => saveCurrentWindow());
  elements.importButton.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", handleImportFile);
  elements.selectAll.addEventListener("change", handleSelectAll);
  elements.exportSelected.addEventListener("click", () => exportSnapshotsByIds([...state.selectedIds]));
  elements.deleteSelected.addEventListener("click", deleteSelectedSnapshots);
  elements.list.addEventListener("click", handleListClick);
  elements.list.addEventListener("change", handleListChange);
  elements.closePreview.addEventListener("click", closePreview);
  elements.restorePreview.addEventListener("click", restoreFromPreview);
  elements.refresh.addEventListener("click", () => loadSnapshots());
  // Backdrop click (outside the dialog) dismisses the preview.
  elements.previewOverlay.addEventListener("click", (event) => {
    if (event.target === elements.previewOverlay) closePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.previewId) closePreview();
  });
}

/* ---- Data loading ---- */

async function loadCurrentWindow() {
  try {
    const payload = await sendMessage({ type: "getTabs" });
    state.currentWindowId = payload.currentWindowId;
  } catch {
    state.currentWindowId = null;
  }
}

async function loadSnapshots() {
  try {
    state.snapshots = await sendMessage({ type: "listSnapshots" });
  } catch (error) {
    state.snapshots = [];
    showToast(error.message, { type: "error" });
  }
  // Drop selections pointing at rows that no longer exist.
  const alive = new Set(state.snapshots.map((snapshot) => snapshot.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => alive.has(id)));
  renderSummary();
  renderList();
  refreshPreview();
}

function renderSummary() {
  const count = state.snapshots.length;
  const tabs = state.snapshots.reduce((total, snapshot) => total + snapshot.tabCount, 0);
  elements.summary.textContent = count === 0
    ? "暂无快照 · 用上方按钮保存当前状态"
    : `共 ${count} 个快照 · ${tabs} 个标签`;
}

/* ---- List rendering ---- */

function filteredSnapshots() {
  if (!state.query) return state.snapshots;
  return state.snapshots.filter((snapshot) =>
    snapshot.label.toLowerCase().includes(state.query)
  );
}

function renderList() {
  const visible = filteredSnapshots();

  if (state.snapshots.length === 0) {
    elements.list.innerHTML = `<div class="empty">暂无快照 · 点上方「保存所有窗口」记录当前状态</div>`;
  } else if (visible.length === 0) {
    elements.list.innerHTML = `<div class="empty">没有匹配「${escapeHtml(state.query)}」的快照</div>`;
  } else {
    elements.list.innerHTML = visible.map(renderRow).join("");
  }

  renderSelectionBar(visible);
}

function renderRow(snapshot) {
  const checked = state.selectedIds.has(snapshot.id) ? "checked" : "";
  const isPreviewing = state.previewId === snapshot.id ? " is-previewing" : "";
  const label = escapeHtml(snapshot.label);
  const createdAtLabel = escapeHtml(formatSnapshotLabel(snapshot.createdAt));
  return `
    <div class="snapshot-row snapshot-manager-row${isPreviewing}" data-snapshot-id="${escapeAttribute(snapshot.id)}">
      <input type="checkbox" class="snapshot-row__check" aria-label="选择快照" ${checked}>
      <div class="snapshot-row__meta">
        <span class="snapshot-row__time">${label}</span>
        <span class="snapshot-row__stats">${snapshot.windowCount} 窗口 · ${snapshot.tabCount} 标签 · ${createdAtLabel}</span>
      </div>
      <div class="snapshot-row__actions">
        <button type="button" class="icon-button" data-action="restore" title="恢复" aria-label="恢复">⟳</button>
        <button type="button" class="icon-button" data-action="export" title="导出" aria-label="导出">⇩</button>
        <button type="button" class="icon-button" data-action="rename" title="修改名称" aria-label="修改名称">✎</button>
        <button type="button" class="icon-button icon-button--danger" data-action="delete" title="删除" aria-label="删除">×</button>
      </div>
    </div>
  `;
}

function renderSelectionBar(visible) {
  const count = state.selectedIds.size;
  elements.selectionBar.hidden = state.snapshots.length === 0;
  elements.selectionCount.textContent = count > 0 ? `已选 ${count} 个` : "未选择";
  elements.exportSelected.disabled = count === 0;
  elements.deleteSelected.disabled = count === 0;
  const visibleIds = visible.map((snapshot) => snapshot.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => state.selectedIds.has(id));
  elements.selectAll.checked = allChecked;
  elements.selectAll.indeterminate = !allChecked && visibleIds.some((id) => state.selectedIds.has(id));
}

/* ---- List events ---- */

function handleListChange(event) {
  const checkbox = event.target.closest(".snapshot-row__check");
  if (!checkbox) return;
  const row = checkbox.closest(".snapshot-manager-row");
  const id = row?.dataset.snapshotId;
  if (!id) return;
  if (checkbox.checked) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }
  renderSelectionBar(filteredSnapshots());
}

async function handleListClick(event) {
  const row = event.target.closest(".snapshot-manager-row");
  if (!row) return;
  const id = row.dataset.snapshotId;
  if (!id) return;
  if (event.target.closest(".snapshot-row__check")) return;

  // Row body click = restore: the preview dialog opens and the user
  // confirms inside it (same as the ⟳ button).
  const action = event.target.closest("button[data-action]")?.dataset.action ?? "restore";
  if (action === "restore") {
    await restoreSnapshotById(id);
  } else if (action === "export") {
    await exportSnapshotsByIds([id]);
  } else if (action === "rename") {
    await renameSnapshotById(id);
  } else if (action === "delete") {
    await deleteSnapshotById(id);
  }
}

function handleSelectAll() {
  const visible = filteredSnapshots();
  if (elements.selectAll.checked) {
    visible.forEach((snapshot) => state.selectedIds.add(snapshot.id));
  } else {
    visible.forEach((snapshot) => state.selectedIds.delete(snapshot.id));
  }
  renderList();
}

/* ---- Row actions ---- */

// Clicking restore opens the preview dialog first — the user sees exactly
// which windows/tabs will come back, then confirms inside the dialog.
async function restoreSnapshotById(id) {
  await openPreview(id);
}

// Only called from the preview dialog's own button, so the preview has
// already been seen and confirmed.
async function executeRestore(id) {
  showToast("正在恢复…");
  try {
    const result = await sendMessage({ type: "restoreSnapshot", id });
    showToast(`已恢复：${formatActionSummary(result)}`);
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

async function renameSnapshotById(id) {
  const target = state.snapshots.find((snapshot) => snapshot.id === id);
  if (!target) return;
  const next = window.prompt("修改快照名称", target.label);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed) {
    showToast("名称不能为空。", { type: "error" });
    return;
  }
  if (trimmed === target.label) return;
  try {
    const updated = await sendMessage({ type: "renameSnapshot", id, label: trimmed });
    state.snapshots = state.snapshots.map((snapshot) =>
      snapshot.id === id ? { ...snapshot, ...updated } : snapshot
    );
    renderSummary();
    renderList();
    refreshPreview();
    showToast("已更新名称。");
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
    state.selectedIds.delete(id);
    if (state.previewId === id) closePreview();
    renderSummary();
    renderList();
    showToast("已删除快照。");
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

async function deleteSelectedSnapshots() {
  const ids = [...state.selectedIds];
  if (ids.length === 0) return;
  if (!window.confirm(`删除选中的 ${ids.length} 个快照？删除后无法恢复。`)) return;
  try {
    const result = await sendMessage({ type: "deleteSnapshots", ids });
    const removed = new Set(ids);
    state.snapshots = state.snapshots.filter((snapshot) => !removed.has(snapshot.id));
    state.selectedIds.clear();
    if (state.previewId && removed.has(state.previewId)) closePreview();
    renderSummary();
    renderList();
    showToast(`已删除：${formatActionSummary(result)}`);
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

/* ---- Save (新增) ---- */

async function saveAllWindows() {
  try {
    const meta = await sendMessage({ type: "saveSnapshot" });
    showToast(`已保存：${meta.label} · ${meta.windowCount} 窗口 · ${meta.tabCount} 标签`);
    await loadSnapshots();
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

async function saveCurrentWindow() {
  if (state.currentWindowId == null) {
    showToast("无法确定当前窗口。", { type: "error" });
    return;
  }
  try {
    const meta = await sendMessage({ type: "saveWindowSnapshot", windowId: state.currentWindowId });
    showToast(`已保存：${meta.label} · ${meta.tabCount} 标签`);
    await loadSnapshots();
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

/* ---- Export ---- */

async function exportSnapshotsByIds(ids) {
  if (ids.length === 0) return;
  try {
    const result = await sendMessage({ type: "exportSnapshots", ids });
    downloadJson(result.doc, result.fileName);
    showToast(`已导出 ${result.count} 个快照到 ${result.fileName}`);
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

function downloadJson(doc, fileName) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* ---- Import ---- */

async function handleImportFile() {
  const file = elements.importFile.files?.[0];
  elements.importFile.value = ""; // re-picking the same file must re-fire change
  if (!file) return;
  let json;
  try {
    json = await file.text();
  } catch {
    showToast("无法读取文件。", { type: "error" });
    return;
  }
  try {
    const result = await sendMessage({ type: "importSnapshots", json });
    const skippedNote = result.skipped > 0 ? `，跳过 ${result.skipped} 个无效快照` : "";
    showToast(`已导入 ${result.imported} 个快照${skippedNote}`);
    await loadSnapshots();
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

/* ---- Preview ---- */

async function openPreview(id) {
  if (state.previewId === id) {
    closePreview();
    return;
  }
  state.previewId = id;
  state.previewSnapshot = null;
  renderList();
  renderPreviewLoading();
  try {
    const snapshot = await sendMessage({ type: "getSnapshot", id });
    if (state.previewId !== id) return; // user moved on while we were loading
    if (!snapshot) {
      showToast("快照不存在。", { type: "error" });
      closePreview();
      return;
    }
    state.previewSnapshot = snapshot;
    renderPreview();
  } catch (error) {
    if (state.previewId === id) closePreview();
    showToast(error.message, { type: "error" });
  }
}

function renderPreviewLoading() {
  elements.previewOverlay.hidden = false;
  elements.previewTitle.textContent = "载入中…";
  elements.previewStats.textContent = "";
  elements.previewBody.innerHTML = `<div class="empty">正在读取快照…</div>`;
}

function renderPreview() {
  const snapshot = state.previewSnapshot;
  if (!snapshot) return;
  elements.previewOverlay.hidden = false;
  elements.previewTitle.textContent = snapshot.label;
  elements.previewStats.textContent =
    `${snapshot.windowCount} 窗口 · ${snapshot.tabCount} 标签 · ${formatSnapshotLabel(snapshot.createdAt)}`;
  elements.previewBody.innerHTML = snapshot.windows
    .map((window, index) => renderPreviewWindow(window, index))
    .join("");
}

function renderPreviewWindow(window, index) {
  const tabs = Array.isArray(window.tabs) ? window.tabs : [];
  const rows = tabs.map((tab, tabIndex) => {
    const isActive = tabIndex === window.activeIndex;
    const favicon = tab.favIconUrl
      ? `<img class="preview-tab__icon" src="${escapeAttribute(tab.favIconUrl)}" alt="" loading="lazy">`
      : `<span class="preview-tab__icon preview-tab__icon--placeholder" aria-hidden="true"></span>`;
    const pinned = tab.pinned ? `<span class="preview-tab__badge">固定</span>` : "";
    const active = isActive ? `<span class="preview-tab__badge preview-tab__badge--active">活动</span>` : "";
    return `
      <li class="preview-tab">
        ${favicon}
        <span class="preview-tab__title" title="${escapeAttribute(tab.url)}">${escapeHtml(tab.title || tab.url)}</span>
        ${pinned}${active}
      </li>
    `;
  }).join("");
  return `
    <section class="preview-window">
      <h3>窗口 ${index + 1} <span class="muted">· ${tabs.length} 标签</span></h3>
      <ul class="preview-tab-list">${rows}</ul>
    </section>
  `;
}

// Keeps the open panel in sync after renames/reloads; closes when the
// underlying snapshot disappears.
function refreshPreview() {
  if (!state.previewId) return;
  const summary = state.snapshots.find((snapshot) => snapshot.id === state.previewId);
  if (!summary) {
    closePreview();
    return;
  }
  if (state.previewSnapshot) {
    state.previewSnapshot.label = summary.label;
    elements.previewTitle.textContent = summary.label;
  }
}

function closePreview() {
  state.previewId = null;
  state.previewSnapshot = null;
  elements.previewOverlay.hidden = true;
  renderList();
}

async function restoreFromPreview() {
  if (!state.previewId) return;
  const id = state.previewId;
  closePreview();
  await executeRestore(id);
}

/* ---- Helpers ---- */

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
  return sendExtensionMessage(message);
}
