import test from "node:test";
import assert from "node:assert/strict";
import { groupTimestamp, groupTabs, isOldGroup } from "../src/age-grouping.js";

const NOW = new Date("2026-07-03T12:00:00+08:00");

function daysAgo(days) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).getTime();
}

test("groups timestamps into expected age buckets", () => {
  assert.equal(groupTimestamp(daysAgo(0), NOW).key, "today");
  assert.equal(groupTimestamp(daysAgo(1), NOW).key, "yesterday");
  assert.equal(groupTimestamp(daysAgo(3), NOW).key, "this-week");
  assert.equal(groupTimestamp(daysAgo(8), NOW).key, "last-week");
  assert.equal(groupTimestamp(daysAgo(18), NOW).key, "two-weeks-ago");
  assert.equal(groupTimestamp(daysAgo(35), NOW).key, "one-month-ago");
  assert.equal(groupTimestamp(daysAgo(90), NOW).key, "older");
  assert.equal(groupTimestamp(undefined, NOW).key, "unknown");
});

test("groups tab view models and preserves labels", () => {
  const groups = groupTabs(
    [
      { tabId: 1, title: "Fresh", ageTimestamp: daysAgo(0) },
      { tabId: 2, title: "Old", ageTimestamp: daysAgo(20) }
    ],
    NOW
  );

  assert.deepEqual(
    groups.map((group) => group.key),
    ["today", "two-weeks-ago"]
  );
  assert.equal(groups[1].tabs[0].groupLabel, "2 周前");
});

test("identifies old cleanup groups", () => {
  assert.equal(isOldGroup("today"), false);
  assert.equal(isOldGroup("this-week"), false);
  assert.equal(isOldGroup("last-week"), true);
  assert.equal(isOldGroup("older"), true);
});

