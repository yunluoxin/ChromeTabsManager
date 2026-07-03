import test from "node:test";
import assert from "node:assert/strict";
import { groupTabsByWindow, formatWindowLabel } from "../src/window-grouping.js";

const TABS = [
  { tabId: 1, windowId: 11, title: "A" },
  { tabId: 2, windowId: 11, title: "B" },
  { tabId: 3, windowId: 22, title: "C" }
];

test("formats window labels with current marker", () => {
  assert.equal(formatWindowLabel(42, {}), "窗口 #42");
  assert.equal(formatWindowLabel(42, { currentWindowId: 42 }), "窗口 #42 · 当前");
  assert.equal(formatWindowLabel(null), "未知窗口");
});

test("groups tabs by windowId and tags each tab", () => {
  const groups = groupTabsByWindow(TABS, { currentWindowId: 11 });

  const windows = groups.map((group) => group.windowId);
  assert.deepEqual(windows, [11, 22]);

  const firstGroup = groups[0];
  assert.equal(firstGroup.key, "11");
  assert.equal(firstGroup.label, "窗口 #11 · 当前");
  assert.equal(firstGroup.tabs.length, 2);
  assert.equal(firstGroup.tabs[0].groupKey, "11");
  assert.equal(firstGroup.tabs[0].groupLabel, "窗口 #11 · 当前");
});

test("places the current window first", () => {
  const groups = groupTabsByWindow(TABS, { currentWindowId: 22 });
  assert.equal(groups[0].windowId, 22);
});
