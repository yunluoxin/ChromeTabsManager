import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustBoundsForScreen,
  applyBoundsToCreateData,
  formatBoundsLabel,
  formatBoundsSummary,
  formatWindowSizeLabel,
  isBoundsValidForScreen,
  sanitizeCapturedBounds,
  sanitizeCapturedScreen
} from "../src/window-bounds.js";

// A 1920×1080 primary monitor with no taskbar offset.
const SCREEN = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };

// A 1920×1080 secondary monitor sitting to the right of SCREEN.
const SCREEN_RIGHT = { availLeft: 1920, availTop: 0, availWidth: 1920, availHeight: 1080 };

test("sanitizeCapturedBounds keeps clean geometry", () => {
  assert.deepEqual(
    sanitizeCapturedBounds({ top: 50, left: 100, width: 1440, height: 900, state: "normal" }),
    { width: 1440, height: 900, left: 100, top: 50, state: "normal" }
  );
});

test("sanitizeCapturedBounds rounds sizes and offsets to integers", () => {
  assert.deepEqual(
    sanitizeCapturedBounds({ width: 1440.4, height: 899.6, left: 100.5, top: 49.5 }),
    { width: 1440, height: 900, left: 101, top: 50 }
  );
});

test("sanitizeCapturedBounds drops non-finite or non-positive sizes", () => {
  assert.deepEqual(
    sanitizeCapturedBounds({ width: 0, height: -10, left: 100, top: 50 }),
    { left: 100, top: 50 }
  );
  assert.equal(
    sanitizeCapturedBounds({ width: "1200", height: undefined, left: NaN, top: Infinity }),
    null
  );
});

test("sanitizeCapturedBounds drops illegal state strings but keeps the rest", () => {
  assert.deepEqual(
    sanitizeCapturedBounds({ width: 1440, height: 900, left: 0, top: 0, state: "frobnicate" }),
    { width: 1440, height: 900, left: 0, top: 0 }
  );
});

test("sanitizeCapturedBounds returns null when nothing usable remains", () => {
  assert.equal(sanitizeCapturedBounds(null), null);
  assert.equal(sanitizeCapturedBounds(undefined), null);
  assert.equal(sanitizeCapturedBounds({}), null);
  assert.equal(sanitizeCapturedBounds({ width: "no", state: "weird" }), null);
});

test("isBoundsValidForScreen accepts fully on-screen geometry", () => {
  assert.equal(
    isBoundsValidForScreen(
      { width: 1440, height: 900, left: 100, top: 60 },
      SCREEN
    ),
    true
  );
});

test("isBoundsValidForScreen rejects geometry entirely off-screen", () => {
  assert.equal(
    isBoundsValidForScreen(
      { width: 800, height: 600, left: 3000, top: 2000 },
      SCREEN
    ),
    false
  );
});

test("isBoundsValidForScreen accepts windows that mostly overlap the screen", () => {
  // Window overlaps 1280×900 inside a 1920×1080 screen.
  assert.equal(
    isBoundsValidForScreen(
      { width: 1440, height: 1000, left: 1280, top: 100 },
      SCREEN
    ),
    true
  );
});

test("isBoundsValidForScreen rejects windows with only a sliver visible", () => {
  // Only a 32×32 corner pokes onto the screen — below the 64×64 threshold.
  assert.equal(
    isBoundsValidForScreen(
      { width: 1440, height: 900, left: 1888, top: 1048 },
      SCREEN
    ),
    false
  );
});

test("isBoundsValidForScreen passes through when no screen info is given", () => {
  // We can't validate without a screen, so let the bounds through and rely on
  // Chrome itself to clamp impossible positions.
  assert.equal(
    isBoundsValidForScreen({ width: 1440, height: 900, left: -9999, top: -9999 }, null),
    true
  );
});

test("isBoundsValidForScreen passes through for null bounds", () => {
  assert.equal(isBoundsValidForScreen(null, SCREEN), true);
});

test("isBoundsValidForScreen accepts a negative-left window on a multi-monitor layout", () => {
  const secondary = { availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1080 };
  assert.equal(
    isBoundsValidForScreen(
      { width: 1440, height: 900, left: -1820, top: 60 },
      secondary
    ),
    true
  );
});

test("applyBoundsToCreateData is a no-op when bounds is null", () => {
  const data = { url: ["https://example.com"] };
  applyBoundsToCreateData(data, null);
  assert.deepEqual(data, { url: ["https://example.com"] });
});

test("applyBoundsToCreateData adds geometry for normal state", () => {
  const data = { url: ["https://example.com"] };
  applyBoundsToCreateData(data, { width: 1440, height: 900, left: 100, top: 50, state: "normal" });
  assert.deepEqual(data, {
    url: ["https://example.com"],
    width: 1440,
    height: 900,
    left: 100,
    top: 50,
    state: "normal"
  });
});

test("applyBoundsToCreateData strips geometry when state overrides it", () => {
  const data = { url: ["https://example.com"] };
  applyBoundsToCreateData(data, { width: 1440, height: 900, left: 100, top: 50, state: "maximized" });
  assert.deepEqual(data, { url: ["https://example.com"], state: "maximized" });
});

test("applyBoundsToCreateData preserves pre-existing keys like incognito", () => {
  const data = { url: ["https://example.com"], incognito: true };
  applyBoundsToCreateData(data, { width: 1440, height: 900 });
  assert.deepEqual(data, {
    url: ["https://example.com"],
    incognito: true,
    width: 1440,
    height: 900
  });
});

test("applyBoundsToCreateData only forwards fields that are actually present", () => {
  const data = { url: ["https://example.com"] };
  applyBoundsToCreateData(data, { width: 1440, height: 900 });
  assert.deepEqual(data, { url: ["https://example.com"], width: 1440, height: 900 });
});

test("formatBoundsLabel returns size + position for normal state", () => {
  assert.equal(
    formatBoundsLabel({ width: 1440, height: 900, left: 100, top: 50 }),
    "1440×900 (100, 50)"
  );
});

test("formatBoundsLabel returns only the state word for special states", () => {
  assert.equal(formatBoundsLabel({ state: "maximized" }), "最大化");
  assert.equal(formatBoundsLabel({ state: "fullscreen" }), "全屏");
  assert.equal(formatBoundsLabel({ state: "minimized" }), "最小化");
});

test("formatBoundsLabel returns size-only when position is missing", () => {
  assert.equal(formatBoundsLabel({ width: 1440, height: 900 }), "1440×900");
});

test("formatBoundsLabel returns empty string for null/missing bounds", () => {
  assert.equal(formatBoundsLabel(null), "");
  assert.equal(formatBoundsLabel(undefined), "");
  assert.equal(formatBoundsLabel({}), "");
});

test("formatBoundsSummary concatenates per-window labels with a dot separator", () => {
  const snap = {
    windows: [
      { bounds: { width: 1440, height: 900, left: 0, top: 0 } },
      { bounds: { state: "maximized" } },
      { bounds: null },
      {}
    ]
  };
  assert.equal(formatBoundsSummary(snap), "1440×900 (0, 0) · 最大化");
});

test("formatBoundsSummary returns an empty string when nothing is captured", () => {
  assert.equal(formatBoundsSummary(null), "");
  assert.equal(formatBoundsSummary({ windows: [] }), "");
  assert.equal(formatBoundsSummary({ windows: [{ tabs: [] }] }), "");
});

test("formatWindowSizeLabel returns width*height for normal windows", () => {
  assert.equal(
    formatWindowSizeLabel({ width: 720, height: 1080 }),
    "720*1080"
  );
});

test("formatWindowSizeLabel returns empty string for special window states", () => {
  // A maximized window has no meaningful captured size — the user wouldn't
  // see "1920*1080" land; it'd just snap to the full screen. Showing nothing
  // keeps the preview honest about what restore will actually do.
  assert.equal(formatWindowSizeLabel({ state: "maximized" }), "");
  assert.equal(formatWindowSizeLabel({ state: "fullscreen" }), "");
  assert.equal(formatWindowSizeLabel({ state: "minimized" }), "");
});

test("formatWindowSizeLabel returns empty when size is missing or partial", () => {
  assert.equal(formatWindowSizeLabel(null), "");
  assert.equal(formatWindowSizeLabel(undefined), "");
  assert.equal(formatWindowSizeLabel({}), "");
  assert.equal(formatWindowSizeLabel({ width: 1440 }), "");
  assert.equal(formatWindowSizeLabel({ height: 900 }), "");
});

test("adjustBoundsForScreen passes through when input is empty or non-array", () => {
  assert.deepEqual(adjustBoundsForScreen([], SCREEN), []);
  assert.equal(adjustBoundsForScreen(null, SCREEN), null);
  assert.equal(adjustBoundsForScreen(undefined, SCREEN), undefined);
});

test("adjustBoundsForScreen passes through when no target screen info is given", () => {
  const list = [{ width: 1440, height: 900, left: 0, top: 0 }];
  assert.deepEqual(adjustBoundsForScreen(list, null), list);
  assert.deepEqual(adjustBoundsForScreen(list, undefined), list);
  assert.deepEqual(adjustBoundsForScreen(list, {}), list);
});

test("adjustBoundsForScreen scales a centered quarter window onto a bigger screen", () => {
  // A: 1920×1080, window centered at 1/4 screen size → B: 2560×1440 still centered 1/4.
  const saved = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const target = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 };
  const w = { width: 480, height: 270, left: 720, top: 405, state: "normal" };
  const out = adjustBoundsForScreen([{ bounds: w, screen: saved }], target);
  assert.deepEqual(out, [
    { width: 640, height: 360, left: 960, top: 540, state: "normal" }
  ]);
});

test("adjustBoundsForScreen scales side-by-side halves independently of window count", () => {
  // Two half-width windows on A → same relative halves on B (single-window
  // path used to refuse scale-up; now every window uses the same formula).
  const saved = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const target = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 };
  const w1 = { width: 960, height: 1080, left: 0, top: 0 };
  const w2 = { width: 960, height: 1080, left: 960, top: 0 };
  const out = adjustBoundsForScreen(
    [{ bounds: w1, screen: saved }, { bounds: w2, screen: saved }],
    target
  );
  assert.deepEqual(out, [
    { width: 1280, height: 1440, left: 0, top: 0 },
    { width: 1280, height: 1440, left: 1280, top: 0 }
  ]);
});

test("adjustBoundsForScreen uses each window's own saved screen", () => {
  // W1 saved on primary, W2 on a right secondary — both map onto TARGET
  // using their own screen ratios (not a shared bbox).
  const primary = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const secondary = { availLeft: 1920, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const target = { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 720 };
  const w1 = { width: 960, height: 1080, left: 0, top: 0 };
  const w2 = { width: 960, height: 1080, left: 1920, top: 0 };
  const out = adjustBoundsForScreen(
    [{ bounds: w1, screen: primary }, { bounds: w2, screen: secondary }],
    target
  );
  assert.deepEqual(out, [
    { width: 640, height: 720, left: 0, top: 0 },
    { width: 640, height: 720, left: 0, top: 0 }
  ]);
});

test("adjustBoundsForScreen translates proportional layout onto a secondary monitor", () => {
  const saved = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const w1 = { width: 960, height: 1080, left: 0, top: 0 };
  const w2 = { width: 960, height: 1080, left: 960, top: 0 };
  const out = adjustBoundsForScreen(
    [{ bounds: w1, screen: saved }, { bounds: w2, screen: saved }],
    SCREEN_RIGHT
  );
  assert.deepEqual(out, [
    { width: 960, height: 1080, left: 1920, top: 0 },
    { width: 960, height: 1080, left: 2880, top: 0 }
  ]);
});

test("adjustBoundsForScreen preserves relative top offset (does not force bbox to y=0)", () => {
  // Window sat 100px below the work-area top (= ~9.26% of height). On a
  // same-size target that offset stays 100 — unlike the old bbox-anchor
  // path which pinned the layout to the screen top-left.
  const saved = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const w = { width: 960, height: 800, left: 0, top: 100 };
  const out = adjustBoundsForScreen([{ bounds: w, screen: saved }], SCREEN);
  assert.deepEqual(out, [{ width: 960, height: 800, left: 0, top: 100 }]);
});

test("adjustBoundsForScreen scales DOWN a single window when its saved screen was larger", () => {
  const saved = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 };
  const small = { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 720 };
  const w = { width: 1280, height: 720, left: 640, top: 360 };
  const out = adjustBoundsForScreen([{ bounds: w, screen: saved }], small);
  assert.deepEqual(out, [{ width: 640, height: 360, left: 320, top: 180 }]);
});

test("adjustBoundsForScreen scales a single half-screen window onto a bigger screen", () => {
  const saved = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const big = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 };
  const half = { width: 960, height: 1080, left: 0, top: 0, state: "normal" };
  const out = adjustBoundsForScreen([{ bounds: half, screen: saved }], big);
  assert.deepEqual(out, [
    { width: 1280, height: 1440, left: 0, top: 0, state: "normal" }
  ]);
});

test("adjustBoundsForScreen clamps legacy windows without saved screen", () => {
  // No `screen` → keep pixels, clamp into target. Off-screen left is pulled in.
  const w = { width: 720, height: 800, left: 3000, top: 2000 };
  const out = adjustBoundsForScreen([w], SCREEN);
  assert.deepEqual(out, [{ width: 720, height: 800, left: 1200, top: 280 }]);
});

test("adjustBoundsForScreen shrinks oversized legacy windows to fit the work area", () => {
  const w = { width: 3000, height: 2000, left: 0, top: 0 };
  const out = adjustBoundsForScreen([w], SCREEN);
  assert.deepEqual(out, [{ width: 1920, height: 1080, left: 0, top: 0 }]);
});

test("adjustBoundsForScreen passes maximized / fullscreen / minimized bounds through unchanged", () => {
  const max = { state: "maximized" };
  const full = { state: "fullscreen" };
  const min = { state: "minimized" };
  const list = [
    { bounds: max, screen: SCREEN },
    { bounds: full, screen: SCREEN },
    { bounds: min, screen: SCREEN }
  ];
  assert.deepEqual(adjustBoundsForScreen(list, SCREEN_RIGHT), [max, full, min]);
});

test("adjustBoundsForScreen leaves state-override geometry alone even with a saved screen", () => {
  const maxWithGeom = { state: "maximized", width: 1920, height: 1080, left: 0, top: 0 };
  const normal = { width: 960, height: 1080, left: 0, top: 0 };
  const out = adjustBoundsForScreen(
    [
      { bounds: maxWithGeom, screen: SCREEN },
      { bounds: normal, screen: SCREEN }
    ],
    SCREEN_RIGHT
  );
  assert.deepEqual(out, [
    maxWithGeom,
    { width: 960, height: 1080, left: 1920, top: 0 }
  ]);
});

test("adjustBoundsForScreen returns a new array; does not mutate the input", () => {
  const w1 = { width: 960, height: 1080, left: 0, top: 0 };
  const entry = { bounds: w1, screen: SCREEN };
  const input = [entry];
  const snapshot = [{ bounds: { ...w1 }, screen: { ...SCREEN } }];
  const out = adjustBoundsForScreen(input, SCREEN_RIGHT);
  assert.deepEqual(input, snapshot);
  assert.notEqual(out, input);
  assert.notEqual(out[0], w1);
});

test("adjustBoundsForScreen accepts workArea-shaped saved screens", () => {
  // chrome.system.display workArea uses left/top/width/height — sanitize
  // accepts both shapes so capture can pass either through.
  const savedWorkArea = { left: 0, top: 0, width: 1920, height: 1080 };
  const w = { width: 960, height: 540, left: 480, top: 270 };
  const out = adjustBoundsForScreen(
    [{ bounds: w, screen: savedWorkArea }],
    { availLeft: 0, availTop: 0, availWidth: 960, availHeight: 540 }
  );
  assert.deepEqual(out, [{ width: 480, height: 270, left: 240, top: 135 }]);
});

test("sanitizeCapturedScreen keeps a clean avail* work area", () => {
  assert.deepEqual(
    sanitizeCapturedScreen({ availLeft: 0, availTop: 25, availWidth: 1920, availHeight: 1055 }),
    { availLeft: 0, availTop: 25, availWidth: 1920, availHeight: 1055 }
  );
});

test("sanitizeCapturedScreen accepts workArea left/top/width/height aliases", () => {
  assert.deepEqual(
    sanitizeCapturedScreen({ left: 1920, top: 0, width: 1440, height: 900 }),
    { availLeft: 1920, availTop: 0, availWidth: 1440, availHeight: 900 }
  );
});

test("sanitizeCapturedScreen returns null when any field is missing or invalid", () => {
  assert.equal(sanitizeCapturedScreen(null), null);
  assert.equal(sanitizeCapturedScreen({}), null);
  assert.equal(sanitizeCapturedScreen({ availLeft: 0, availTop: 0, availWidth: 1920 }), null);
  assert.equal(
    sanitizeCapturedScreen({ availLeft: 0, availTop: 0, availWidth: 0, availHeight: 1080 }),
    null
  );
});
