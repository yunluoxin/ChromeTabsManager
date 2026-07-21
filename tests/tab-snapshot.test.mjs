import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshotExport,
  captureSnapshot,
  formatSnapshotLabel,
  generateSnapshotId,
  parseSnapshotImport,
  planRestore,
  snapshotPrivacy,
  unwrapLazyTabUrl
} from "../src/tab-snapshot.js";

// Local alias so the incognito import test reads clearly next to its data.
const buildSnapshotExportForTest = buildSnapshotExport;

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
    favIconUrl: "https://a.com/f.ico",
    incognito: false
  });
});

test("captureSnapshot defaults favIconUrl to empty string", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "https://a.com", active: true }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.windows[0].tabs[0].favIconUrl, "");
});

test("captureSnapshot unwraps lazy-tab placeholders back to the real page", () => {
  // A restored-but-never-activated tab: URL is the extension placeholder,
  // live title/favIconUrl are the placeholder's own (letter icon etc.).
  const lazyUrl =
    "chrome-extension://abc/lazy-tab.html?" +
    new URLSearchParams({
      url: "https://real.com/page?x=1",
      title: "真实标题",
      favIconUrl: "https://real.com/f.ico"
    }).toString();
  const tabs = [
    { windowId: 11, index: 0, url: "https://active.com", title: "Active", active: true, favIconUrl: "" },
    { windowId: 11, index: 1, url: lazyUrl, title: "真实标题", active: false, favIconUrl: "data:image/png;base64,xxx" }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.tabCount, 2);
  assert.deepEqual(snap.windows[0].tabs[1], {
    url: "https://real.com/page?x=1",
    title: "真实标题",
    pinned: false,
    index: 1,
    favIconUrl: "https://real.com/f.ico",
    incognito: false
  });
});

test("captureSnapshot still drops other extension pages", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "chrome-extension://abc/dashboard.html", active: true },
    { windowId: 11, index: 1, url: "chrome-extension://other/popup.html?url=https://x.com", active: false }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.tabCount, 0);
});

test("unwrapLazyTabUrl returns the embedded URL or null", () => {
  const lazy = "chrome-extension://abc/lazy-tab.html?url=" + encodeURIComponent("https://a.com/") + "&title=A";
  assert.equal(unwrapLazyTabUrl(lazy), "https://a.com/");
  assert.equal(unwrapLazyTabUrl("https://a.com/"), null);
  assert.equal(unwrapLazyTabUrl("chrome-extension://abc/lazy-tab.html"), null); // no query
  assert.equal(unwrapLazyTabUrl("chrome-extension://abc/lazy-tab.html?title=A"), null); // no url param
  assert.equal(unwrapLazyTabUrl(""), null);
  assert.equal(unwrapLazyTabUrl(null), null);
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

test("lazy-tab round-trip preserves hostile URLs and titles exactly", () => {
  // Simulate: buildLazyTabUrl encodes → unwrapLazyTabUrl decodes. Special
  // characters (& = ? # % + spaces, CJK, emoji) must survive byte-for-byte.
  const hostile = {
    url: "https://example.com/search?q=a%26b&x=1+2&lang=中文#frag%20ment?x=1",
    title: "A & B = 100% ✅ \"引号\" <标签>",
    favIconUrl: "https://example.com/f.ico?size=32&fmt=png"
  };
  const built =
    "chrome-extension://abc/lazy-tab.html?" +
    new URLSearchParams({ url: hostile.url, title: hostile.title, favIconUrl: hostile.favIconUrl }).toString();

  assert.equal(unwrapLazyTabUrl(built), hostile.url);

  const tabs = [{ windowId: 1, index: 0, url: built, title: hostile.title, active: true }];
  const snap = captureSnapshot(tabs, [{ id: 1 }], 1000);
  assert.equal(snap.windows[0].tabs[0].url, hostile.url);
  assert.equal(snap.windows[0].tabs[0].title, hostile.title);
  assert.equal(snap.windows[0].tabs[0].favIconUrl, hostile.favIconUrl);
});

test("lazy-tab round-trip survives a double restore (placeholder inside placeholder never happens)", () => {
  // Restoring a snapshot whose tab was itself unwrapped from a placeholder
  // must produce a REAL url in the next snapshot, never a nested lazy URL.
  const real = "https://a.com/?redirect=https%3A%2F%2Fb.com%2F%3Fnested%3D1";
  const lazy1 = "chrome-extension://abc/lazy-tab.html?" + new URLSearchParams({ url: real, title: "t", favIconUrl: "" }).toString();
  const snap1 = captureSnapshot([{ windowId: 1, index: 0, url: lazy1, active: true }], [{ id: 1 }], 1000);
  assert.equal(snap1.windows[0].tabs[0].url, real);
  // Re-wrap for a second restore, capture again: still the same real URL.
  const lazy2 = "chrome-extension://abc/lazy-tab.html?" + new URLSearchParams({ url: snap1.windows[0].tabs[0].url, title: "t", favIconUrl: "" }).toString();
  const snap2 = captureSnapshot([{ windowId: 1, index: 0, url: lazy2, active: true }], [{ id: 1 }], 2000);
  assert.equal(snap2.windows[0].tabs[0].url, real);
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

/* ---- incognito ---- */

test("captureSnapshot records tab and window incognito from the windows list", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "https://a.com", active: true, incognito: true },
    { windowId: 22, index: 0, url: "https://c.com", active: true, incognito: false }
  ];
  const snap = captureSnapshot(tabs, [{ id: 11, incognito: true }, { id: 22, incognito: false }], 1000);
  assert.equal(snap.windows[0].incognito, true);
  assert.equal(snap.windows[0].tabs[0].incognito, true);
  assert.equal(snap.windows[1].incognito, false);
  assert.equal(snap.windows[1].tabs[0].incognito, false);
});

test("captureSnapshot infers window incognito from tabs when the windows list omits it", () => {
  const tabs = [
    { windowId: 11, index: 0, url: "https://a.com", active: true, incognito: true }
  ];
  // Stub window with no incognito field (saveWindowSnapshot passes [{ id }]).
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.windows[0].incognito, true);
});

test("captureSnapshot treats missing incognito as normal (old-tab compatibility)", () => {
  const tabs = [{ windowId: 11, index: 0, url: "https://a.com", active: true }];
  const snap = captureSnapshot(tabs, [{ id: 11 }], 1000);
  assert.equal(snap.windows[0].incognito, false);
  assert.equal(snap.windows[0].tabs[0].incognito, false);
});

test("planRestore carries window incognito into the plan", () => {
  const snap = {
    windows: [
      { tabs: [{ url: "https://a.com" }], activeIndex: 0, incognito: true },
      { tabs: [{ url: "https://b.com" }], activeIndex: 0, incognito: false }
    ]
  };
  const plan = planRestore(snap);
  assert.equal(plan.windows[0].incognito, true);
  assert.equal(plan.windows[1].incognito, false);
});

test("planRestore with excludeIncognito drops private windows only", () => {
  const snap = {
    windows: [
      { tabs: [{ url: "https://priv.com" }], activeIndex: 0, incognito: true },
      { tabs: [{ url: "https://norm.com" }], activeIndex: 0, incognito: false }
    ]
  };
  const plan = planRestore(snap, { excludeIncognito: true });
  assert.equal(plan.windows.length, 1);
  assert.deepEqual(plan.windows[0].urls, ["https://norm.com"]);
});

test("planRestore with excludeIncognito yields an empty plan for a pure-incognito snapshot", () => {
  const snap = { windows: [{ tabs: [{ url: "https://p.com" }], activeIndex: 0, incognito: true }] };
  assert.deepEqual(planRestore(snap, { excludeIncognito: true }), { windows: [] });
});

test("planRestore with excludeIncognito keeps old (field-less) windows as normal", () => {
  const snap = { windows: [{ tabs: [{ url: "https://old.com" }], activeIndex: 0 }] };
  const plan = planRestore(snap, { excludeIncognito: true });
  assert.equal(plan.windows.length, 1);
  assert.equal(plan.windows[0].incognito, false);
});

test("planRestore with omitLazyTabs: true returns real URLs for every tab", () => {
  const snap = {
    windows: [
      {
        tabs: [
          { url: "https://a.com" },
          { url: "https://b.com" },
          { url: "https://c.com" }
        ],
        activeIndex: 1
      },
      {
        tabs: [{ url: "https://x.com" }, { url: "https://y.com" }],
        activeIndex: 0
      }
    ]
  };
  const lazyCalls = [];
  const plan = planRestore(snap, {
    lazyUrlFor: (tab) => { lazyCalls.push(tab.url); return `lazy:${tab.url}`; },
    omitLazyTabs: true
  });
  // No lazy wrapper invoked and no lazy URLs produced — even non-active tabs
  // keep their real URL.
  assert.deepEqual(lazyCalls, []);
  assert.deepEqual(plan.windows[0].urls, ["https://b.com", "https://a.com", "https://c.com"]);
  assert.deepEqual(plan.windows[1].urls, ["https://x.com", "https://y.com"]);
});

test("planRestore with omitLazyTabs predicate skips lazy only for matching windows", () => {
  const snap = {
    windows: [
      // Normal window: keeps lazy placeholders.
      {
        tabs: [{ url: "https://n1.com" }, { url: "https://n2.com" }],
        activeIndex: 0,
        incognito: false
      },
      // Incognito window: must use real URLs for every tab.
      {
        tabs: [{ url: "https://p1.com" }, { url: "https://p2.com" }, { url: "https://p3.com" }],
        activeIndex: 2,
        incognito: true
      }
    ]
  };
  const plan = planRestore(snap, {
    lazyUrlFor: (tab) => `lazy:${tab.url}`,
    omitLazyTabs: (window) => window.incognito === true
  });
  // Normal window: active tab real, the other wrapped.
  assert.deepEqual(plan.windows[0].urls, ["https://n1.com", "lazy:https://n2.com"]);
  // Incognito window: active tab (p3) moved to position 0, all real URLs.
  assert.deepEqual(plan.windows[1].urls, ["https://p3.com", "https://p1.com", "https://p2.com"]);
});

test("planRestore with omitLazyTabs predicate still honors activeIndex reordering", () => {
  // incognito window whose active tab is at index 2 → real URL of that tab
  // must still land at urls[0]; the rest are the remaining real URLs in their
  // original order.
  const snap = {
    windows: [{
      tabs: [{ url: "https://a.com" }, { url: "https://b.com" }, { url: "https://c.com" }],
      activeIndex: 2,
      incognito: true
    }]
  };
  const plan = planRestore(snap, {
    lazyUrlFor: () => "SHOULD-NOT-APPEAR",
    omitLazyTabs: (window) => window.incognito === true
  });
  assert.deepEqual(plan.windows[0].urls, ["https://c.com", "https://a.com", "https://b.com"]);
});

test("planRestore omitLazyTabs: true is a no-op when lazyUrlFor is absent", () => {
  // Without a lazy builder every tab is real anyway, so omitting lazy tabs
  // must produce the exact same plan as the default.
  const snap = {
    windows: [{
      tabs: [{ url: "https://a.com" }, { url: "https://b.com" }],
      activeIndex: 1
    }]
  };
  const base = planRestore(snap);
  const forced = planRestore(snap, { omitLazyTabs: true });
  assert.deepEqual(forced, base);
  assert.deepEqual(forced.windows[0].urls, ["https://b.com", "https://a.com"]);
});

test("snapshotPrivacy classifies normal, mixed, and pure-incognito snapshots", () => {
  const mixed = { windows: [{ incognito: true }, { incognito: false }] };
  assert.deepEqual(snapshotPrivacy(mixed), {
    hasIncognito: true, hasNormal: true, incognitoWindowCount: 1, normalWindowCount: 1
  });

  const pure = { windows: [{ incognito: true }, { incognito: true }] };
  const p = snapshotPrivacy(pure);
  assert.equal(p.hasIncognito, true);
  assert.equal(p.hasNormal, false);

  // Old snapshot: no incognito field → all normal.
  const old = { windows: [{}, {}] };
  const o = snapshotPrivacy(old);
  assert.equal(o.hasIncognito, false);
  assert.equal(o.hasNormal, true);

  assert.deepEqual(snapshotPrivacy(null), {
    hasIncognito: false, hasNormal: false, incognitoWindowCount: 0, normalWindowCount: 0
  });
});

test("parseSnapshotImport preserves tab and window incognito", () => {
  const doc = buildSnapshotExportForTest([{
    id: "snap-x",
    createdAt: 100,
    label: "t",
    windows: [
      { activeIndex: 0, incognito: true, tabs: [{ url: "https://p.com", title: "P", incognito: true }] }
    ]
  }]);
  const result = parseSnapshotImport(JSON.stringify(doc), { createdAt: 1 });
  const w = result.snapshots[0].windows[0];
  assert.equal(w.incognito, true);
  assert.equal(w.tabs[0].incognito, true);
});
