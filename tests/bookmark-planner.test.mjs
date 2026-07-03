import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOKMARK_MODES,
  createBookmarkPlan,
  defaultFolderName,
  formatDate
} from "../src/bookmark-planner.js";

const DATE = new Date("2026-07-03T12:00:00+08:00");

test("formats default bookmark folder names", () => {
  assert.equal(formatDate(DATE), "2026-07-03");
  assert.equal(defaultFolderName({ groupLabel: "上周", date: DATE }), "2026-07-03 上周");
  assert.equal(defaultFolderName({ isMultiGroup: true, date: DATE }), "2026-07-03 Chrome Tabs");
  assert.equal(defaultFolderName({ customName: "  Research Dump  ", date: DATE }), "Research Dump");
});

test("filters unbookmarkable extension and chrome URLs", () => {
  const plan = createBookmarkPlan(
    [
      { title: "Docs", url: "https://example.com", groupKey: "last-week", groupLabel: "上周" },
      { title: "Chrome", url: "chrome://extensions", groupKey: "last-week", groupLabel: "上周" },
      { title: "Extension", url: "chrome-extension://abc/dashboard.html", groupKey: "last-week", groupLabel: "上周" }
    ],
    { mode: BOOKMARK_MODES.FLAT, date: DATE }
  );

  assert.equal(plan.tabs.length, 1);
  assert.equal(plan.tabs[0].url, "https://example.com");
});

test("creates grouped bookmark plan metadata", () => {
  const plan = createBookmarkPlan(
    [
      { title: "A", url: "https://a.test", groupKey: "last-week", groupLabel: "上周" },
      { title: "B", url: "https://b.test", groupKey: "older", groupLabel: "更早" }
    ],
    { mode: BOOKMARK_MODES.GROUPED, folderName: "", date: DATE, parentId: "2" }
  );

  assert.equal(plan.mode, BOOKMARK_MODES.GROUPED);
  assert.equal(plan.parentId, "2");
  assert.equal(plan.rootFolderTitle, "2026-07-03 Chrome Tabs");
  assert.deepEqual(
    plan.groups.map((group) => group.key),
    ["last-week", "older"]
  );
});

