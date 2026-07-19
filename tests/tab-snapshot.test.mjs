import test from "node:test";
import assert from "node:assert/strict";
import {
  captureSnapshot,
  formatSnapshotLabel,
  generateSnapshotId,
  planRestore
} from "../src/tab-snapshot.js";

test("generateSnapshotId embeds the timestamp", () => {
  assert.equal(generateSnapshotId(1720954200000), "snap-1720954200000");
});

test("formatSnapshotLabel uses local YYYY-MM-DD HH:mm with zero padding", () => {
  // Use Date's local-time constructor to stay timezone-stable.
  const d1 = new Date(2026, 6, 14, 10, 30, 0); // Jul 14 2026 10:30 local
  assert.equal(formatSnapshotLabel(d1.getTime()), "2026-07-14 10:30");

  const d2 = new Date(2026, 0, 3, 9, 5, 0); // Jan 3 2026 09:05 local
  assert.equal(formatSnapshotLabel(d2.getTime()), "2026-01-03 09:05");
});

test("captureSnapshot groups tabs by windowId and sorts by index", () => {
  const tabs = [
    { windowId: 11, index: 1, url: "https://b.com", title: "B", active: false, pinned: false },
    { windowId: 11, index: 0, url: "https://a.com", title: "A", active: true, pinned: true },
    { windowId: 22, index: 0, url: "https://c.com", title: "C", active: true, pinned: false }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }, { id: 22 }], 1720954200000);

  assert.equal(snap.id, "snap-1720954200000");
  assert.equal(snap.createdAt, 1720954200000);
  assert.equal(snap.windowCount, 2);
  assert.equal(snap.tabCount, 3);

  assert.equal(snap.windows.length, 2);
  assert.equal(snap.windows[0].tabs.length, 2);
  assert.equal(snap.windows[0].tabs[0].url, "https://a.com"); // index 0 first
  assert.equal(snap.windows[0].tabs[1].url, "https://b.com");
  assert.equal(snap.windows[0].activeIndex, 0); // "A" was active

  assert.equal(snap.windows[1].tabs[0].url, "https://c.com");
  assert.equal(snap.windows[1].activeIndex, 0);
});

test("captureSnapshot filters chrome://, chrome-extension://, and empty URLs", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "https://ok.com", title: "ok", active: true, pinned: false },
    { windowId: 11, index: 1, url: "chrome://settings", title: "settings", active: false, pinned: false },
    { windowId: 11, index: 2, url: "chrome-extension://abc/popup.html", title: "popup", active: false, pinned: false },
    { windowId: 11, index: 3, url: "", title: "", active: false, pinned: false }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.tabCount, 1);
  assert.equal(snap.windows[0].tabs.length, 1);
  assert.equal(snap.windows[0].tabs[0].url, "https://ok.com");
  assert.equal(snap.windows[0].activeIndex, 0);
});

test("captureSnapshot drops tabs whose windowId is not in the windows list", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "https://a.com", active: true },
    { windowId: 99, index: 0, url: "https://ghost.com", active: true }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.windowCount, 1);
  assert.equal(snap.tabCount, 1);
});

test("captureSnapshot falls back to tab-derived windowIds when windows is empty", () => {
  const tabs = [
    { windowId: 5, index: 0, url: "https://a.com", active: true },
    { windowId: 6, index: 0, url: "https://b.com", active: true }
  ];
  const snap = captureSnapshot(tabs, [], 1000);
  assert.equal(snap.windowCount, 2);
});

test("captureSnapshot omits windows that became empty after URL filtering", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "chrome://settings", active: true },
    { windowId: 22, index: 0, url: "https://ok.com", active: true }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }, { id: 22 }], 1000);
  assert.equal(snap.windowCount, 1);
  assert.equal(snap.windows[0].tabs[0].url, "https://ok.com");
});

test("captureSnapshot records the active tab index per window", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "https://a.com", active: false },
    { windowId: 11, index: 1, url: "https://b.com", active: true },
    { windowId: 11, index: 2, url: "https://c.com", active: false }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.windows[0].activeIndex, 1);
});

test("captureSnapshot defaults activeIndex to 0 when no tab is active", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "https://a.com", active: false },
    { windowId: 11, index: 1, url: "https://b.com", active: false }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.windows[0].activeIndex, 0);
});

test("captureSnapshot stores pinned, index and favIconUrl fields faithfully", () => {
  const tabs = [
    { windowId: 11, index: 7, url: "https://a.com", title: "A", active: true, pinned: true, favIconUrl: "https://a.com/f.ico" }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.deepEqual(snap.windows[0].tabs[0], {
    url: "https://a.com",
    title: "A",
    pinned: true,
    index: 7,
    favIconUrl: "https://a.com/f.ico"
  });
});

test("captureSnapshot defaults favIconUrl to empty string", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "https://a.com", active: true }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.windows[0].tabs[0].favIconUrl, "");
});

test("planRestore moves the activeIndex URL to position 0", () => {
  const snap = {
    windows: [
      {
        tabs: [{ url: "https://a.com" }, { url: "https://b.com" }, { url: "https://c.com" }],
        activeIndex: 2
      }
    ]
  };
  const plan = planRestore(snap);
  assert.deepEqual(plan.windows[0].urls, ["https://c.com", "https://a.com", "https://b.com"]);
});

test("planRestore is a no-op when activeIndex is already 0", () => {
  const snap = {
    windows: [
      { tabs: [{ url: "https://a.com" }, { url: "https://b.com" }], activeIndex: 0 }
    ]
  };
  const plan = planRestore(snap);
  assert.deepEqual(plan.windows[0].urls, ["https://a.com", "https://b.com"]);
});

test("planRestore clamps an out-of-range activeIndex", () => {
  const snap = {
    windows: [
      { tabs: [{ url: "https://a.com" }, { url: "https://b.com" }], activeIndex: 99 }
    ]
  };
  const plan = planRestore(snap);
  // 99 clamped to length-1 (=1), so "b" is moved to position 0.
  assert.deepEqual(plan.windows[0].urls, ["https://b.com", "https://a.com"]);
});

test("planRestore handles an empty windows list and missing snapshot", () => {
  assert.deepEqual(planRestore({ windows: [] }), { windows: [] });
  assert.deepEqual(planRestore(null), { windows: [] });
  assert.deepEqual(planRestore(undefined), { windows: [] });
  assert.deepEqual(planRestore({}), { windows: [] });
});

test("planRestore plans each window independently", () => {
  const snap = {
    windows: [
      { tabs: [{ url: "https://a.com" }, { url: "https://b.com" }], activeIndex: 1 },
      { tabs: [{ url: "https://c.com" }, { url: "https://d.com" }], activeIndex: 0 }
    ]
  };
  const plan = planRestore(snap);
  assert.deepEqual(plan.windows[0].urls, ["https://b.com", "https://a.com"]);
  assert.deepEqual(plan.windows[1].urls, ["https://c.com", "https://d.com"]);
});

test("planRestore with lazyUrlFor keeps the active tab real and lazy-wraps the rest", () => {
  const snap = {
    windows: [
      {
        tabs: [
          { url: "https://a.com", title: "A" },
          { url: "https://b.com", title: "B" },
          { url: "https://c.com", title: "C" }
        ],
        activeIndex: 1
      }
    ]
  };
  const plan = planRestore(snap, { lazyUrlFor: (tab) => `lazy:${tab.url}` });
  // "b" was active → real URL at position 0; others go through the builder.
  assert.deepEqual(plan.windows[0].urls, ["https://b.com", "lazy:https://a.com", "lazy:https://c.com"]);
});

test("planRestore with lazyUrlFor receives the tab's title and favIconUrl", () => {
  const snap = {
    windows: [
      {
        tabs: [
          { url: "https://a.com", title: "A", favIconUrl: "https://a.com/f.ico" },
          { url: "https://b.com", title: "B", favIconUrl: "" }
        ],
        activeIndex: 0
      }
    ]
  };
  const seen = [];
  planRestore(snap, { lazyUrlFor: (tab) => { seen.push(tab); return "lazy"; } });
  // Only the non-active tab goes through the builder, with all its fields.
  assert.deepEqual(seen, [{ url: "https://b.com", title: "B", favIconUrl: "" }]);
});
