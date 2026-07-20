export const BOOKMARK_MODES = {
  FLAT: "flat",
  FOLDER: "folder",
  GROUPED: "grouped"
};

export function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultFolderName({ groupLabel, customName, date = new Date(), isMultiGroup = false } = {}) {
  const trimmedName = customName?.trim();
  if (trimmedName) return trimmedName;
  if (!isMultiGroup && groupLabel) return `${formatDate(date)} ${groupLabel}`;
  return `${formatDate(date)} Chrome Tabs`;
}

import { isSystemUrl } from "./system-urls.js";

export function sanitizeBookmarkTabs(tabs) {
  return tabs
    .filter((tab) => tab.url && !isSystemUrl(tab.url))
    .map((tab) => ({
      title: tab.title || tab.url,
      url: tab.url,
      groupKey: tab.groupKey || "unknown",
      groupLabel: tab.groupLabel || "未知/估算失败"
    }));
}

export function createBookmarkPlan(tabs, options = {}) {
  const bookmarkTabs = sanitizeBookmarkTabs(tabs);
  const mode = options.mode || BOOKMARK_MODES.FOLDER;
  const parentId = options.parentId || "1";
  const isMultiGroup = new Set(bookmarkTabs.map((tab) => tab.groupKey)).size > 1;
  const rootFolderTitle = defaultFolderName({
    customName: options.folderName,
    groupLabel: bookmarkTabs[0]?.groupLabel,
    isMultiGroup,
    date: options.date
  });

  return {
    mode,
    parentId,
    rootFolderTitle,
    tabs: bookmarkTabs,
    groups: groupBookmarkTabs(bookmarkTabs)
  };
}

export function groupBookmarkTabs(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    if (!groups.has(tab.groupKey)) {
      groups.set(tab.groupKey, {
        key: tab.groupKey,
        label: tab.groupLabel,
        tabs: []
      });
    }
    groups.get(tab.groupKey).tabs.push(tab);
  }
  return Array.from(groups.values());
}

