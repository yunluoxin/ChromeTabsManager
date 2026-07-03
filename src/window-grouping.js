// Group tabs by their owning Chrome window.
//
// Each returned group mirrors the shape produced by `age-grouping.js`:
//   { key, label, tabs: [{ ...tab, groupKey, groupLabel }] }
// so the existing dashboard renderer (which only reads `key`, `label`,
// and `tab.groupKey`/`tab.groupLabel`) keeps working unchanged.
//
// In addition, every group carries a `windowId` so the dashboard can
// wire drag-and-drop targets and the "move selected" dropdown.

export function formatWindowLabel(index, { isCurrent = false } = {}) {
  if (index == null) return "未知窗口";
  return `窗口${index}${isCurrent ? " · 当前" : ""}`;
}

export function groupTabsByWindow(tabs, { currentWindowId = null } = {}) {
  const byWindowId = new Map();

  for (const tab of tabs) {
    const windowId = tab.windowId ?? "unknown";
    if (!byWindowId.has(windowId)) {
      byWindowId.set(windowId, {
        key: String(windowId),
        windowId,
        label: "未知窗口",
        tabs: []
      });
    }
    byWindowId.get(windowId).tabs.push({
      ...tab,
      groupKey: String(windowId),
      groupLabel: "未知窗口"
    });
  }

  // Sort: current window first (so it sits at the top), then by windowId
  // ascending so the order is stable across reloads.
  const sorted = [...byWindowId.values()].sort((a, b) => {
    const aCurrent = a.windowId === currentWindowId;
    const bCurrent = b.windowId === currentWindowId;
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    return String(a.windowId).localeCompare(String(b.windowId), "en", { numeric: true });
  });

  // Assign sequential labels (窗口1, 窗口2, ...) based on sorted position.
  sorted.forEach((group, idx) => {
    if (group.windowId == null) return;
    const number = idx + 1;
    const label = formatWindowLabel(number, { isCurrent: group.windowId === currentWindowId });
    group.label = label;
    for (const tab of group.tabs) tab.groupLabel = label;
  });

  return sorted;
}
