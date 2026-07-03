// Group tabs by their owning Chrome window.
//
// Each returned group mirrors the shape produced by `age-grouping.js`:
//   { key, label, tabs: [{ ...tab, groupKey, groupLabel }] }
// so the existing dashboard renderer (which only reads `key`, `label`,
// and `tab.groupKey`/`tab.groupLabel`) keeps working unchanged.
//
// In addition, every group carries a `windowId` so the dashboard can
// wire drag-and-drop targets and the "move selected" dropdown.

export function formatWindowLabel(index, { isCurrent = false, isMinimized = false } = {}) {
  if (index == null) return "未知窗口";
  const currentTag = isCurrent ? " · 当前" : "";
  const minimizedTag = isMinimized ? "（后台）" : "";
  return `窗口${index}${currentTag}${minimizedTag}`;
}

export function groupTabsByWindow(tabs, { currentWindowId = null, windowStates = null } = {}) {
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

  // Sort by windowId ascending ONLY. We deliberately do NOT push the current
  // window to the front, because the current window can change between
  // renders (e.g. after a move focuses the destination). If sorting changed,
  // the same windowId would get a different `窗口N` label and the user's
  // mental anchor would shift. Numbers stay tied to windowIds; "当前" is
  // just a floating suffix that walks with whichever window is current.
  const sorted = [...byWindowId.values()].sort((a, b) =>
    String(a.windowId).localeCompare(String(b.windowId), "en", { numeric: true })
  );

  // Assign sequential labels (窗口1, 窗口2, ...) based on sorted position.
  // Because the sort above is now stable (independent of currentWindowId),
  // the same windowId always gets the same number. Windows with
  // `state === "minimized"` get a `（后台）` suffix so users can see at a
  // glance which windows are hidden behind other apps.
  sorted.forEach((group, idx) => {
    if (group.windowId == null) return;
    const number = idx + 1;
    const isCurrent = group.windowId === currentWindowId;
    const isMinimized = isWindowMinimized(group.windowId, windowStates);
    const label = formatWindowLabel(number, { isCurrent, isMinimized });
    group.label = label;
    for (const tab of group.tabs) tab.groupLabel = label;
  });

  return sorted;
}

function isWindowMinimized(windowId, windowStates) {
  if (!windowStates || windowId == null) return false;
  return windowStates.get(windowId) === "minimized" || windowStates.get(windowId)?.state === "minimized";
}
