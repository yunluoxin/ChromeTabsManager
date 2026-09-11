// Snapshot manager page controller. The popup's snapshot section links here;
// everything heavier than one-click restore (multi-select, export, import,
// preview) lives on this full page.
import { formatActionSummary } from "./action-summary.js";
import { api, queryLastFocusedActiveTab, sendMessage as sendExtensionMessage } from "./chrome-api.js";
import { formatSnapshotLabel } from "./tab-snapshot.js";
import { formatWindowSizeLabel } from "./window-bounds.js";
import { THEMES, applyTheme, getStoredTheme, setStoredTheme, subscribeThemeChange, subscribeSystemChange } from "./theme.js";
import { showToast } from "./toast.js";

const state = {
  snapshots: [],
  selectedIds: new Set(),
  query: "",
  previewId: null,
  previewSnapshot: null
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
  await loadSnapshots();
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
  elements.previewBody.addEventListener("click", handlePreviewBodyClick);
  // Keep open buttons pinned to the body's visible right edge while the user
  // scrolls horizontally (long tab titles push the list wider than the dialog).
  elements.previewBody.addEventListener("scroll", pinOpenButtons, { passive: true });
  window.addEventListener("resize", pinOpenButtons);
  // Backdrop click (outside the dialog) dismisses the preview.
  elements.previewOverlay.addEventListener("click", (event) => {
    if (event.target === elements.previewOverlay) closePreview();
  });
  // Lock vertical scroll on the page behind the overlay. Three cases:
  //   1. Wheel/Touch landing on the backdrop itself — always swallow, since
  //      the underlying list is what would otherwise take the scroll.
  //   2. Wheel/Touch landing inside the dialog (.snapshot-preview subtree)
  //      on an ancestor that CAN scroll in the wheel direction — let it
  //      propagate so the preview body scrolls as the user expects.
  //   3. Wheel/Touch landing inside the dialog but the body is already at
  //      its top/bottom (or the target is a non-scrollable decoration like
  //      the header/footer) — swallow so the page behind doesn't move.
  // The case-3 logic also catches pure vertical hits when the body fits in
  // the dialog without ever needing to scroll.
  elements.previewOverlay.addEventListener("wheel", lockBehindPreview, { passive: false });
  elements.previewOverlay.addEventListener("touchmove", lockBehindPreview, { passive: false });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.previewId) closePreview();
  });
}

/* ---- Data loading ---- */

async function loadSnapshots() {
  try {
    // Manager page shows every snapshot, including pure-incognito ones.
    state.snapshots = await sendMessage({ type: "listAllSnapshots" });
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
  const incognitoBadge = snapshot.hasIncognito
    ? `<span class="snapshot-row__badge" title="包含隐私窗口">🕶 隐身</span>`
    : "";
  return `
    <div class="snapshot-row snapshot-manager-row${isPreviewing}" data-snapshot-id="${escapeAttribute(snapshot.id)}">
      <input type="checkbox" class="snapshot-row__check" aria-label="选择快照" ${checked}>
      <div class="snapshot-row__meta">
        <span class="snapshot-row__time">${label}${incognitoBadge}</span>
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
    const result = await sendMessage({ type: "restoreSnapshot", id, screen: captureScreenInfo() });
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
  // Resolve the host window here, on click, instead of trusting the
  // currentWindowId from getTabGroups — Chrome MV3's service worker
  // returns a stale/wrong value for windows.getCurrent, so the only safe
  // source is the UI page's own tabs.query. Firefox returns the same value
  // either way, so this is a no-op there.
  const tab = await queryLastFocusedActiveTab().catch(() => null);
  if (!tab || tab.windowId == null) {
    showToast("无法确定当前窗口。", { type: "error" });
    return;
  }
  try {
    const meta = await sendMessage({ type: "saveWindowSnapshot", windowId: tab.windowId });
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
  // Reset cached button width + recompute pin positions.
  pinOpenButtons();
}

// Pure-CSS attempts to keep the open buttons anchored at the body's
// scroll-viewport right edge didn't survive overflow reliably across browsers,
// so the buttons sit absolute-positioned at each row's right edge and a small
// helper translates them so their right edge aligns with the body's visible
// content-box right edge. When the rows fit the body (most snapshots), the
// helper is a no-op. When a row is wider than the body, the helper pulls
// every button back into the viewport regardless of which row is widest.
//
// Math: button is `position: absolute; right: 0.45rem` against its row
// (`.preview-window` / `.preview-tab`, the closest positioned ancestor).
// Row's right edge in viewport coords = `rowRect.right`. So the button's
// natural right edge = `rowRect.right - 0.45rem`. We want it at the body's
// content-box right edge (`bodyContentRight`). translateX shifts by
// `-(naturalRight - target)`.

// Wheel/touchmove events inside the overlay must not fall through to the
// snapshot list behind the dialog.
//
// Cases:
//   • target == overlay backdrop → always preventDefault.
//   • target inside `.snapshot-preview` → only let the event scroll when an
//     ancestor of the target actually has room in the wheel direction. When
//     no such ancestor exists (e.g. the dialog body fits without scrolling,
//     or the user has already scrolled it to the top/bottom edge), the event
//     would otherwise bubble to the snapshot list behind the dialog.
//
// Touchmove doesn't carry a usable `deltaY`, so for those events the rule
// simplifies to "block unless a scrollable ancestor is found". The browser
// handles scroll gestures on a real scrollable element natively when we
// don't preventDefault.
function lockBehindPreview(event) {
  if (event.target === elements.previewOverlay) {
    event.preventDefault();
    return;
  }
  const scrollable = findScrollableAncestor(event.target);
  if (!scrollable) {
    event.preventDefault();
    return;
  }
  // Wheel events have deltaY; non-zero direction lets us detect the edge
  // case where the user keeps wheeling after the body is already at its
  // top/bottom and would otherwise scroll the page behind.
  const deltaY = event.deltaY;
  if (typeof deltaY !== "number" || deltaY === 0) return;
  const atTop = scrollable.scrollTop <= 0;
  const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight;
  if (deltaY < 0 && atTop) {
    event.preventDefault();
  } else if (deltaY > 0 && atBottom) {
    event.preventDefault();
  }
}

// Walk up from `node` looking for an ancestor that can scroll vertically.
// Stops at the dialog itself — ancestors above the dialog (the page behind)
// must NOT be returned, that's exactly what the lock guards against.
function findScrollableAncestor(node) {
  const dialog = elements.previewOverlay.querySelector(".snapshot-preview");
  let current = node;
  while (current && current !== dialog) {
    const style = getComputedStyle(current);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}
function pinOpenButtons() {
  const body = elements.previewBody;
  if (!body) return;
  const bodyRect = body.getBoundingClientRect();
  const bodyStyle = getComputedStyle(body);
  const bodyPadRight = parseFloat(bodyStyle.paddingRight) || 0;
  const bodyBorderRight = parseFloat(bodyStyle.borderRightWidth) || 0;
  // Right edge of body's visible content (border-box right minus padding).
  const bodyContentRight = bodyRect.right - bodyBorderRight - bodyPadRight;
  const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const buttonGutterPx = 0.45 * rootFont;

  const buttons = body.querySelectorAll(".preview-window__open, .preview-tab__open");
  buttons.forEach((button) => {
    const row = button.closest(".preview-window, .preview-tab");
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    // Button's natural absolute-position right edge (no transform).
    const naturalRight = rowRect.right - buttonGutterPx;
    const overshoot = naturalRight - bodyContentRight;
    // Sub-pixel safe cutoff to avoid jitter on fractional values.
    button.style.transform = overshoot > 0.5
      ? `translateX(${-overshoot}px)`
      : "";
  });
}

function renderPreviewWindow(window, index) {
  const tabs = Array.isArray(window.tabs) ? window.tabs : [];
  const isIncognito = window.incognito === true;
  const sizeLabel = formatWindowSizeLabel(window.bounds);
  const sizeSegment = sizeLabel
    ? ` <span class="preview-window__size">(${escapeHtml(sizeLabel)})</span>`
    : "";
  const rows = tabs.map((tab, tabIndex) => {
    const isActive = tabIndex === window.activeIndex;
    const favicon = tab.favIconUrl
      ? `<img class="preview-tab__icon" src="${escapeAttribute(tab.favIconUrl)}" alt="" loading="lazy">`
      : `<span class="preview-tab__icon preview-tab__icon--placeholder" aria-hidden="true"></span>`;
    const pinned = tab.pinned ? `<span class="preview-tab__badge">固定</span>` : "";
    const active = isActive ? `<span class="preview-tab__badge preview-tab__badge--active">活动</span>` : "";
    const incognito = tab.incognito ? `<span class="preview-tab__badge preview-tab__badge--incognito">🕶 隐身</span>` : "";
    const tabIncognitoClass = tab.incognito ? " incognito" : "";
    const openTitle = tab.incognito ? "在新隐私窗口打开此标签" : "在新窗口打开此标签";
    return `
      <li class="preview-tab${tabIncognitoClass}" data-tab-index="${tabIndex}">
        ${favicon}
        <span class="preview-tab__title" title="${escapeAttribute(tab.url)}">${escapeHtml(tab.title || tab.url)}</span>
        <span class="preview-tab__badges">${pinned}${active}${incognito}</span>
        <button type="button" class="preview-tab__open icon-button" data-action="open-tab" title="${openTitle}" aria-label="${openTitle}">↗</button>
      </li>
    `;
  }).join("");
  const windowIncognitoClass = isIncognito ? " incognito" : "";
  const windowBadge = isIncognito ? ` <span class="preview-window__badge">🕶 隐身窗口</span>` : "";
  const openWindowTitle = isIncognito ? "打开此隐私窗口" : "打开此窗口";
  return `
    <section class="preview-window${windowIncognitoClass}" data-window-index="${index}">
      <h3>窗口 ${index + 1} <span class="muted">· ${tabs.length} 标签</span>${sizeSegment}${windowBadge}</h3>
      <button type="button" class="preview-window__open icon-button" data-action="open-window" title="${openWindowTitle}" aria-label="${openWindowTitle}">↗ 打开</button>
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

// Per-row open buttons inside the preview overlay. They don't dismiss the
// overlay — the user is likely planning several openings in a row.
async function handlePreviewBodyClick(event) {
  const windowButton = event.target.closest("button[data-action='open-window']");
  if (windowButton) {
    event.stopPropagation();
    const winEl = windowButton.closest(".preview-window");
    const wIdx = Number(winEl?.dataset.windowIndex);
    if (!Number.isInteger(wIdx)) return;
    await openWindowFromPreview(wIdx);
    return;
  }
  const tabButton = event.target.closest("button[data-action='open-tab']");
  if (tabButton) {
    event.stopPropagation();
    const tabEl = tabButton.closest(".preview-tab");
    const winEl = tabButton.closest(".preview-window");
    const wIdx = Number(winEl?.dataset.windowIndex);
    const tIdx = Number(tabEl?.dataset.tabIndex);
    if (!Number.isInteger(wIdx) || !Number.isInteger(tIdx)) return;
    await openTabFromPreview(wIdx, tIdx);
  }
}

async function openWindowFromPreview(windowIndex) {
  if (!state.previewId) return;
  const id = state.previewId;
  try {
    const result = await sendMessage({ type: "openSnapshotWindow", id, windowIndex, screen: captureScreenInfo() });
    showToast(`已打开：${formatActionSummary(result)}`);
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
}

async function openTabFromPreview(windowIndex, tabIndex) {
  if (!state.previewId) return;
  const id = state.previewId;
  try {
    const result = await sendMessage({ type: "openSnapshotTab", id, windowIndex, tabIndex, screen: captureScreenInfo() });
    showToast(`已打开：${formatActionSummary(result)}`);
  } catch (error) {
    showToast(error.message, { type: "error" });
  }
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

// Snapshot of the user's current screen work area, passed to the background so
// it can refuse to restore windows that would land off-screen (e.g. on a
// monitor that's no longer connected). window.screen is always present in
// extension pages — we never need a fallback.
function captureScreenInfo() {
  const screen = typeof window !== "undefined" ? window.screen : null;
  if (!screen) return null;
  return {
    availLeft: screen.availLeft,
    availTop: screen.availTop,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight
  };
}
