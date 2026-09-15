import test from "node:test";
import assert from "node:assert/strict";
import {
  attachScreenToWindows,
  centerOf,
  filterWindowsOnSameDisplay,
  filterWindowsOnSameDisplayVisible,
  isInside,
  pickDisplayForPoint,
  pickDisplayForWindow,
  sameBoundsKey,
  screenFromDisplay
} from "../src/screen-windows.js";

test("centerOf computes the geometric midpoint", () => {
  assert.deepEqual(centerOf({ left: 0, top: 0, width: 100, height: 50 }), { x: 50, y: 25 });
  assert.deepEqual(
    centerOf({ left: 1920, top: 100, width: 2560, height: 1440 }),
    { x: 3200, y: 820 }
  );
});

test("centerOf prefers window.bounds over the deprecated flat fields", () => {
  // Modern Chrome populates bounds; the older flat properties might be
  // undefined or out of sync with the actual window position. Always read
  // bounds first so screen detection matches the rendered geometry.
  assert.deepEqual(
    centerOf({ bounds: { left: 100, top: 200, width: 800, height: 600 } }),
    { x: 500, y: 500 }
  );
});

test("centerOf falls back to flat fields when bounds is missing", () => {
  // Old Chrome versions or stub objects may only have the flat fields.
  assert.deepEqual(
    centerOf({ left: 100, top: 200, width: 800, height: 600 }),
    { x: 500, y: 500 }
  );
  // Mixed: bounds has some fields, flat fields have others. Each field
  // resolves independently so the result is the union.
  assert.deepEqual(
    centerOf(
      { bounds: { left: 100, top: 200 }, width: 800, height: 600 }
    ),
    { x: 500, y: 500 }
  );
});

test("centerOf returns NaN when geometry is missing", () => {
  // Minimized windows, special window types, and partial records all leave
  // some of left/top/width/height undefined. NaN propagates through
  // pickDisplayForWindow and the window gets correctly excluded.
  assert.ok(Number.isNaN(centerOf({ left: 0, top: 0 }).x));
  assert.ok(Number.isNaN(centerOf({ left: 0, top: 0 }).y));
  assert.ok(Number.isNaN(centerOf({ width: 100, height: 100 }).x));
  assert.ok(Number.isNaN(centerOf(null).x));
});

test("isInside treats the interval as half-open", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assert.equal(isInside(rect, { x: 50, y: 50 }), true);
  // Left/top edges are included so the rect claims its own origin.
  assert.equal(isInside(rect, { x: 0, y: 0 }), true);
  assert.equal(isInside(rect, { x: 99.99, y: 0 }), true);
  // Right/bottom edges are excluded so adjacent rects don't double-claim
  // the seam.
  assert.equal(isInside(rect, { x: 100, y: 50 }), false);
  assert.equal(isInside(rect, { x: 50, y: 100 }), false);
  assert.equal(isInside(rect, { x: 100, y: 100 }), false);
  // Outside the rect.
  assert.equal(isInside(rect, { x: -1, y: 50 }), false);
  assert.equal(isInside(rect, { x: 50, y: -1 }), false);
  assert.equal(isInside(rect, { x: 101, y: 50 }), false);
});

test("isInside works on rectangles with negative origin", () => {
  const rect = { left: -100, top: -50, width: 200, height: 100 };
  assert.equal(isInside(rect, { x: -50, y: 0 }), true);
  assert.equal(isInside(rect, { x: -100, y: 0 }), true);  // left edge included
  assert.equal(isInside(rect, { x: 100, y: 0 }), false);  // right edge excluded
  assert.equal(isInside(rect, { x: -101, y: 0 }), false);
});

test("isInside handles subpixel coordinates", () => {
  const rect = { left: 0, top: 0, width: 100.5, height: 100.5 };
  assert.equal(isInside(rect, { x: 100.25, y: 50.5 }), true);
  assert.equal(isInside(rect, { x: 100.5, y: 50 }), false); // right edge still excluded
  assert.equal(isInside(rect, { x: 100.6, y: 50 }), false);
});

test("isInside returns false for missing or non-numeric fields", () => {
  assert.equal(isInside(null, { x: 0, y: 0 }), false);
  assert.equal(isInside({}, { x: 0, y: 0 }), false);
  assert.equal(isInside({ left: 0, top: 0, width: 100, height: 100 }, null), false);
  assert.equal(
    isInside({ left: "0", top: 0, width: 100, height: 100 }, { x: 50, y: 50 }),
    false
  );
});

test("pickDisplayForPoint picks the matching display in a right-extended layout", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1920, height: 1080 } },
    { id: "secondary", workArea: { left: 1920, top: 0, width: 2560, height: 1440 } }
  ];
  assert.equal(pickDisplayForPoint({ x: 100, y: 100 }, displays).id, "primary");
  assert.equal(pickDisplayForPoint({ x: 1920, y: 500 }, displays).id, "secondary"); // seam → secondary
  assert.equal(pickDisplayForPoint({ x: 3000, y: 500 }, displays).id, "secondary");
});

test("pickDisplayForPoint handles a secondary display on the left (negative x)", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1920, height: 1080 } },
    { id: "left-of-primary", workArea: { left: -1920, top: 0, width: 1920, height: 1080 } }
  ];
  assert.equal(pickDisplayForPoint({ x: -1000, y: 500 }, displays).id, "left-of-primary");
  assert.equal(pickDisplayForPoint({ x: 0, y: 500 }, displays).id, "primary");
  // Seam at x=0: secondary's right edge is excluded (half-open), primary
  // starts here, so x=0 belongs to primary.
  assert.equal(pickDisplayForPoint({ x: -1, y: 500 }, displays).id, "left-of-primary");
});

test("pickDisplayForPoint returns null for points outside every display", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1920, height: 1080 } }
  ];
  assert.equal(pickDisplayForPoint({ x: 3000, y: 100 }, displays), null);
  assert.equal(pickDisplayForPoint({ x: -1, y: 100 }, displays), null);
  assert.equal(pickDisplayForPoint({ x: 100, y: 2000 }, displays), null);
});

test("pickDisplayForPoint returns null for empty or non-array displays", () => {
  assert.equal(pickDisplayForPoint({ x: 50, y: 50 }, []), null);
  assert.equal(pickDisplayForPoint({ x: 50, y: 50 }, null), null);
  assert.equal(pickDisplayForPoint({ x: 50, y: 50 }, undefined), null);
});

test("pickDisplayForWindow delegates to centerOf", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1000, height: 1000 } }
  ];
  const w = { left: 100, top: 100, width: 200, height: 200 };
  assert.equal(pickDisplayForWindow(w, displays).id, "primary");
});

test("pickDisplayForWindow returns null when the window has no geometry", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1000, height: 1000 } }
  ];
  assert.equal(pickDisplayForWindow({ left: 100, top: 100 }, displays), null);
  assert.equal(pickDisplayForWindow(null, displays), null);
});

test("pickDisplayForWindow returns null for a window straddling two displays", () => {
  // Two displays with a real 200px gap (rare but possible — user has
  // positioned them with a gap, or one display is currently disabled). The
  // 400-wide window at x=1900 has its center at x=2100 — in the gap, outside
  // both displays. This is the documented "straddle" behavior; callers fall
  // back to per-window saves.
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1920, height: 1080 } },
    { id: "secondary", workArea: { left: 2120, top: 0, width: 1920, height: 1080 } }
  ];
  const straddling = { left: 1900, top: 100, width: 400, height: 800 };
  assert.equal(pickDisplayForWindow(straddling, displays), null);
});

test("filterWindowsOnSameDisplay keeps only matching windows", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1000, height: 1000 } },
    { id: "secondary", workArea: { left: 1000, top: 0, width: 1000, height: 1000 } }
  ];
  const windows = [
    { id: 1, left: 0, top: 0, width: 800, height: 600 },      // center (400,300) → primary
    { id: 2, left: 1200, top: 100, width: 600, height: 800 }, // center (1500,500) → secondary
    { id: 3, left: 100, top: 100, width: 200, height: 200 }   // center (200,200) → primary
  ];
  const focused = displays[1];
  const result = filterWindowsOnSameDisplay(windows, displays, focused);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 2);
});

test("filterWindowsOnSameDisplay filters out windows with no geometry", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1000, height: 1000 } }
  ];
  const windows = [
    { id: 1, left: 0, top: 0, width: 500, height: 500 },     // valid → kept
    { id: 2 /* no geometry */ },                              // NaN center → excluded
    { id: 3, left: 200, top: 200, width: 100, height: 100 }  // valid → kept
  ];
  const focused = displays[0];
  const result = filterWindowsOnSameDisplay(windows, displays, focused);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((w) => w.id), [1, 3]);
});

test("filterWindowsOnSameDisplay returns [] when display is null", () => {
  const windows = [
    { id: 1, left: 0, top: 0, width: 100, height: 100 }
  ];
  assert.deepEqual(filterWindowsOnSameDisplay(windows, [], null), []);
  assert.deepEqual(filterWindowsOnSameDisplay(windows, [], undefined), []);
});

test("filterWindowsOnSameDisplay returns [] when windows is not an array", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1000, height: 1000 } }
  ];
  assert.deepEqual(filterWindowsOnSameDisplay(null, displays, displays[0]), []);
  assert.deepEqual(filterWindowsOnSameDisplay(undefined, displays, displays[0]), []);
});

// Real Chrome macOS layout: MacBook display (id="1", workArea [0, 38, 1512, 944])
// stacked below an external monitor (id="2", workArea [-219, -1055, 1920, 1055]).
// The horizontal overlap is intentional — both displays cover x in [0, 1512),
// so any window centered there must be classified by its Y coordinate alone.
test("filterWindowsOnSameDisplay on a real stacked MacBook + external layout", () => {
  const displays = [
    {
      id: "1",
      isPrimary: true,
      workArea: { left: 0, top: 38, width: 1512, height: 944 }
    },
    {
      id: "2",
      isPrimary: false,
      workArea: { left: -219, top: -1055, width: 1920, height: 1055 }
    }
  ];
  const liveWindows = [
    // 4 maximized windows on the MacBook display (y center ≈ 510).
    { id: "A", left: 0, top: 38, width: 1512, height: 944 },
    { id: "B", left: 0, top: 38, width: 1512, height: 944 },
    { id: "C", left: 0, top: 38, width: 1512, height: 944 },
    { id: "D", left: 0, top: 38, width: 1512, height: 944 },
    // 2 maximized + 2 split-half windows on the external display (y center ≈ -527).
    { id: "E", left: -219, top: -1055, width: 1920, height: 1055 },
    { id: "F", left: -219, top: -1055, width: 960, height: 1055 },
    { id: "G", left: 741, top: -1055, width: 960, height: 1055 },
    { id: "H", left: -219, top: -1055, width: 1920, height: 1055 }
  ];
  const external = displays[1];
  const result = filterWindowsOnSameDisplay(liveWindows, displays, external);
  // Only the four external-display windows should match.
  assert.deepEqual(
    result.map((w) => w.id).sort(),
    ["E", "F", "G", "H"]
  );
});

test("sameBoundsKey returns a stable signature for identical bounds", () => {
  const a = { left: 0, top: 0, width: 800, height: 600 };
  const b = { left: 0, top: 0, width: 800, height: 600 };
  assert.equal(sameBoundsKey(a), sameBoundsKey(b));
});

test("sameBoundsKey distinguishes different bounds", () => {
  assert.notEqual(
    sameBoundsKey({ left: 0, top: 0, width: 800, height: 600 }),
    sameBoundsKey({ left: 0, top: 0, width: 800, height: 700 })
  );
  assert.notEqual(
    sameBoundsKey({ left: 0, top: 0, width: 800, height: 600 }),
    sameBoundsKey({ left: 1, top: 0, width: 800, height: 600 })
  );
});

test("sameBoundsKey prefers window.bounds over flat fields", () => {
  // Bounds takes precedence when both are present; mismatched signatures
  // indicate Chrome versions where the API surface differs.
  assert.equal(
    sameBoundsKey({ bounds: { left: 1, top: 2, width: 3, height: 4 } }),
    "1|2|3|4"
  );
  // Falls back to flat fields when bounds is missing.
  assert.equal(
    sameBoundsKey({ left: 1, top: 2, width: 3, height: 4 }),
    "1|2|3|4"
  );
});

test("sameBoundsKey returns sentinels for missing geometry", () => {
  assert.equal(sameBoundsKey(null), "null");
  assert.equal(sameBoundsKey({}), "unknown");
  assert.equal(sameBoundsKey({ left: 0, top: 0 }), "unknown");
});

test("filterWindowsOnSameDisplayVisible drops duplicate-bounds group when active is not in it", () => {
  // Two windows share bounds on the primary display. The active window
  // is on a third window with unique bounds — the duplicate pair is on
  // a different Space and should be dropped.
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1000, height: 1000 } }
  ];
  const windows = [
    { id: 1, left: 0, top: 0, width: 1000, height: 1000 },
    { id: 2, left: 0, top: 0, width: 1000, height: 1000 },
    { id: 3, left: 0, top: 0, width: 500, height: 500 }
  ];
  const result = filterWindowsOnSameDisplayVisible(
    windows,
    displays,
    displays[0],
    3
  );
  assert.deepEqual(result.map((w) => w.id), [3]);
});

test("filterWindowsOnSameDisplayVisible keeps active window from a duplicate-bounds group", () => {
  // The active window IS one of two identical-bounds windows. The other
  // is on a different Space and should be dropped.
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1000, height: 1000 } }
  ];
  const windows = [
    { id: 1, left: 0, top: 0, width: 1000, height: 1000 },
    { id: 2, left: 0, top: 0, width: 1000, height: 1000 }
  ];
  const result = filterWindowsOnSameDisplayVisible(
    windows,
    displays,
    displays[0],
    1
  );
  assert.deepEqual(result.map((w) => w.id), [1]);
});

test("filterWindowsOnSameDisplayVisible keeps all unique-bound windows", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 2000, height: 2000 } }
  ];
  const windows = [
    { id: 1, left: 0, top: 0, width: 500, height: 500 },
    { id: 2, left: 500, top: 0, width: 500, height: 500 },
    { id: 3, left: 1000, top: 0, width: 500, height: 500 }
  ];
  const result = filterWindowsOnSameDisplayVisible(
    windows,
    displays,
    displays[0],
    2
  );
  assert.equal(result.length, 3);
});

test("filterWindowsOnSameDisplayVisible on the user's stacked layout: drops duplicate maximized, keeps 2 split-half normal", () => {
  // Real-world scenario from the bug report. Two full-screen windows
  // share bounds on display 2 (the external, above the MacBook) — they
  // must be on different Spaces. The user's active window is one of two
  // half-screen normal windows on the same display. Expected: only the
  // two normal windows are kept.
  const displays = [
    {
      id: "1",
      workArea: { left: 0, top: 38, width: 1512, height: 944 }
    },
    {
      id: "2",
      workArea: { left: -219, top: -1055, width: 1920, height: 1055 }
    }
  ];
  const liveWindows = [
    // 4 maximized on the MacBook display.
    { id: 171972216, left: 0, top: 38, width: 1512, height: 944 },
    { id: 171972221, left: 0, top: 38, width: 1512, height: 944 },
    { id: 171972232, left: 0, top: 38, width: 1512, height: 944 },
    { id: 171972583, left: 0, top: 38, width: 1512, height: 944 },
    // 2 maximized on the external display (duplicate-bounds pair).
    { id: 171972208, left: -219, top: -1055, width: 1920, height: 1055 },
    { id: 171972227, left: -219, top: -1055, width: 1920, height: 1055 },
    // 2 split-half normal on the external display (the user's current Space).
    { id: 171972620, left: -219, top: -1055, width: 960, height: 1055 },
    { id: 171972628, left: 741, top: -1055, width: 960, height: 1055 }
  ];
  const external = displays[1];
  // Active is the right-half normal window — NOT in the duplicate group.
  const result = filterWindowsOnSameDisplayVisible(
    liveWindows,
    displays,
    external,
    171972628
  );
  assert.deepEqual(
    result.map((w) => w.id).sort((a, b) => a - b),
    [171972620, 171972628]
  );
});

test("filterWindowsOnSameDisplayVisible returns [] when display is null", () => {
  const windows = [
    { id: 1, left: 0, top: 0, width: 100, height: 100 }
  ];
  assert.deepEqual(
    filterWindowsOnSameDisplayVisible(windows, [], null, 1),
    []
  );
});

test("screenFromDisplay maps workArea onto avail* shape", () => {
  assert.deepEqual(
    screenFromDisplay({ workArea: { left: 1920, top: 0, width: 1440, height: 900 } }),
    { availLeft: 1920, availTop: 0, availWidth: 1440, availHeight: 900 }
  );
  assert.equal(screenFromDisplay(null), null);
  assert.equal(screenFromDisplay({ workArea: { left: 0, top: 0, width: 100 } }), null);
});

test("attachScreenToWindows stamps each window with its display workArea", () => {
  const displays = [
    { id: "primary", workArea: { left: 0, top: 0, width: 1920, height: 1080 } },
    { id: "secondary", workArea: { left: 1920, top: 0, width: 1920, height: 1080 } }
  ];
  const windows = [
    { id: 1, left: 100, top: 100, width: 800, height: 600 },
    { id: 2, left: 2000, top: 100, width: 800, height: 600 }
  ];
  const out = attachScreenToWindows(windows, displays);
  assert.deepEqual(out[0].screen, {
    availLeft: 0,
    availTop: 0,
    availWidth: 1920,
    availHeight: 1080
  });
  assert.deepEqual(out[1].screen, {
    availLeft: 1920,
    availTop: 0,
    availWidth: 1920,
    availHeight: 1080
  });
  // Input not mutated.
  assert.equal(windows[0].screen, undefined);
});

test("attachScreenToWindows is a no-op without displays", () => {
  const windows = [{ id: 1, left: 0, top: 0, width: 100, height: 100 }];
  assert.equal(attachScreenToWindows(windows, null), windows);
  assert.equal(attachScreenToWindows(windows, []), windows);
});
