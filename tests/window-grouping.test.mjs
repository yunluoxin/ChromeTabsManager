import test from "node:test";
import assert from "node:assert/strict";
import { groupTabsByWindow, formatWindowLabel } from "../src/window-grouping.js";

const TABS = [
  { tabId: 1, windowId: 11, title: "A" },
  { tabId: 2, windowId: 11, title: "B" },
  { tabId: 3, windowId: 22, title: "C" }
];

test("formats window labels with current marker", () => {
  assert.equal(formatWindowLabel(1, {}), "窗口1");
  assert.equal(formatWindowLabel(2, { isCurrent: true }), "窗口2 · 当前");
  assert.equal(formatWindowLabel(null), "未知窗口");
});

test("groups tabs by windowId and tags each tab", () => {
  const groups = groupTabsByWindow(TABS, { currentWindowId: 11 });

  const windows = groups.map((group) => group.windowId);
  assert.deepEqual(windows, [11, 22]);

  const firstGroup = groups[0];
  assert.equal(firstGroup.key, "11");
  assert.equal(firstGroup.label, "窗口1 · 当前");
  assert.equal(firstGroup.tabs.length, 2);
  assert.equal(firstGroup.tabs[0].groupKey, "11");
  assert.equal(firstGroup.tabs[0].groupLabel, "窗口1 · 当前");

  // non-current window keeps sequential numbering
  assert.equal(groups[1].windowId, 22);
  assert.equal(groups[1].label, "窗口2");
});

test("places the current window first", () => {
  const groups = groupTabsByWindow(TABS, { currentWindowId: 22 });
  assert.equal(groups[0].windowId, 22);
  assert.equal(groups[0].label, "窗口1 · 当前");
  assert.equal(groups[1].windowId, 11);
  assert.equal(groups[1].label, "窗口2");
});

test("appends （后台） to minimized windows", () => {
  const windowStates = new Map([
    [11, { id: 11, state: "minimized" }],
    [22, { id: 22, state: "normal" }]
  ]);
  const groups = groupTabsByWindow(TABS, { currentWindowId: 22, windowStates });
  // Current window first, so 22 is index 0 (normal), 11 is index 1 (minimized)
  assert.equal(groups[0].windowId, 22);
  assert.equal(groups[0].label, "窗口1 · 当前");
  assert.equal(groups[1].windowId, 11);
  assert.equal(groups[1].label, "窗口2（后台）");
  // Tab-level groupLabel mirrors the group label
  assert.equal(groups[1].tabs[0].groupLabel, "窗口2（后台）");
});

test("current + minimized produces both markers", () => {
  const windowStates = new Map([[11, { id: 11, state: "minimized" }]]);
  const groups = groupTabsByWindow(TABS, { currentWindowId: 11, windowStates });
  assert.equal(groups[0].windowId, 11);
  assert.equal(groups[0].label, "窗口1 · 当前（后台）");
});

test("ignores unknown window state values", () => {
  const windowStates = new Map([[11, { id: 11, state: "maximized" }]]);
  const groups = groupTabsByWindow(TABS, { currentWindowId: 11, windowStates });
  assert.equal(groups[0].label, "窗口1 · 当前");
});

test("formatWindowLabel accepts isMinimized", () => {
  assert.equal(formatWindowLabel(2, { isMinimized: true }), "窗口2（后台）");
  assert.equal(formatWindowLabel(3, { isCurrent: true, isMinimized: true }), "窗口3 · 当前（后台）");
});
