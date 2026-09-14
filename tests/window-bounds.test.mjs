import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustBoundsForScreen,
  applyBoundsToCreateData,
  formatBoundsLabel,
  formatBoundsSummary,
  formatWindowSizeLabel,
  isBoundsValidForScreen,
  sanitizeCapturedBounds
} from "../src/window-bounds.js";

// A 1920×1080 primary monitor with no taskbar offset.
const SCREEN = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };

// A 1920×1080 secondary monitor sitting to the right of SCREEN.
const SCREEN_RIGHT = { availLeft: 1920, availTop: 0, availWidth: 1920, availHeight: 1080 };

// A 1920×1080 secondary monitor sitting to the left of SCREEN (negative availLeft).
const SCREEN_LEFT = { availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1080 };

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

test("adjustBoundsForScreen passes through when no screen info is given", () => {
  // Same passthrough isBoundsValidForScreen uses — relies on Chrome/Firefox
  // to clamp impossible positions when we can't compute anything ourselves.
  const list = [{ width: 1440, height: 900, left: 0, top: 0 }];
  assert.deepEqual(adjustBoundsForScreen(list, null), list);
  assert.deepEqual(adjustBoundsForScreen(list, undefined), list);
  assert.deepEqual(adjustBoundsForScreen(list, {}), list);
});

test("adjustBoundsForScreen passes through when at least one window is visible", () => {
  // W1 sits on SCREEN already — even though W2 is off-screen, we leave the
  // layout alone (shifting would yank W1 off the visible area).
  const w1 = { width: 720, height: 800, left: 100, top: 60 };
  const w2 = { width: 720, height: 800, left: 3000, top: 2000 };
  const list = [w1, w2];
  assert.deepEqual(adjustBoundsForScreen(list, SCREEN), list);
});

test("adjustBoundsForScreen translates the layout as a unit when fully off-screen", () => {
  // Two side-by-side windows saved on the primary monitor (left=0..1440).
  // Restoring from SCREEN_RIGHT (left=1920) — both windows are entirely on
  // the primary, zero overlap with the secondary's work area. The whole
  // layout should shift by (1920, 0), preserving the side-by-side spacing.
  const w1 = { width: 720, height: 800, left: 0, top: 0 };
  const w2 = { width: 720, height: 800, left: 720, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: 1920, top: 0 },
    { width: 720, height: 800, left: 2640, top: 0 }
  ]);
});

test("adjustBoundsForScreen translates toward a secondary monitor sitting to the LEFT", () => {
  // Mirror of the right-secondary test: saved on the primary at (0..1440),
  // restoring on SCREEN_LEFT (-1920..0). Delta = (-1920 - 0) = -1920.
  const w1 = { width: 720, height: 800, left: 0, top: 0 };
  const w2 = { width: 720, height: 800, left: 720, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_LEFT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: -1920, top: 0 },
    { width: 720, height: 800, left: -1200, top: 0 }
  ]);
});

test("adjustBoundsForScreen anchors the layout to the new screen's top-left, not the saved offset", () => {
  // Saved windows sat 100px below the primary's top (the user had dragged
  // them down). Restoring on SCREEN_RIGHT, the whole layout gets shifted
  // so its bbox's top-left lands at the new screen's (availLeft=1920,
  // availTop=0) corner — meaning both windows now sit at top=0 on the new
  // screen. This is by design: the alternative would be keeping the old
  // 100px-from-top offset, which would only make sense if the new screen
  // happened to have a similar dead zone at the top, and we can't tell.
  const w1 = { width: 720, height: 800, left: 0, top: 100 };
  const w2 = { width: 720, height: 800, left: 720, top: 100 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: 1920, top: 0 },
    { width: 720, height: 800, left: 2640, top: 0 }
  ]);
});

test("adjustBoundsForScreen preserves state and size fields when translating", () => {
  // "normal" state stays attached after translation — applyBoundsToCreateData
  // uses state="normal" to force Chrome into a normal window (otherwise it
  // can pick whatever default the OS suggests).
  const w1 = { width: 720, height: 800, left: 0, top: 0, state: "normal" };
  const out = adjustBoundsForScreen([w1], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: 1920, top: 0, state: "normal" }
  ]);
});

test("adjustBoundsForScreen passes maximized / fullscreen / minimized bounds through unchanged", () => {
  // These states have no usable geometry — width/height/left/top may be
  // missing or zero. Translating them would just be noise (Chrome ignores
  // geometry when state is set to one of these).
  const max = { state: "maximized" };
  const full = { state: "fullscreen" };
  const min = { state: "minimized" };
  const stub = { width: 0, height: 0 };
  const list = [max, full, min, stub];
  assert.deepEqual(adjustBoundsForScreen(list, SCREEN_RIGHT), list);
});

test("adjustBoundsForScreen translates the geometric subset when some windows have no geometry", () => {
  // Mixed list — the fullscreen window has no geometry and is passed through
  // untouched; the normal window next to it is off-screen and gets translated.
  const normal = { width: 720, height: 800, left: 0, top: 0, state: "normal" };
  const fullscreen = { state: "fullscreen" };
  const out = adjustBoundsForScreen([normal, fullscreen], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: 1920, top: 0, state: "normal" },
    fullscreen
  ]);
});

test("adjustBoundsForScreen returns a new array; does not mutate the input", () => {
  // Pure-helper contract — callers in tab-service.js may reuse the original
  // bounds objects for other purposes (e.g. formatting), so we must not
  // rewrite them in place.
  const w1 = { width: 720, height: 800, left: 0, top: 0 };
  const w2 = { width: 720, height: 800, left: 720, top: 0 };
  const input = [w1, w2];
  const snapshot = input.slice();
  const out = adjustBoundsForScreen(input, SCREEN_RIGHT);
  assert.deepEqual(input, snapshot);
  assert.notEqual(out, input);
  assert.notEqual(out[0], w1);
  assert.notEqual(out[1], w2);
});

test("adjustBoundsForScreen is a no-op when the saved layout is already on the new screen", () => {
  // Same display, restore from a popup on the same screen — both windows
  // are inside SCREEN, so the function shouldn't move anything.
  const w1 = { width: 720, height: 800, left: 100, top: 60 };
  const w2 = { width: 720, height: 800, left: 820, top: 60 };
  assert.deepEqual(adjustBoundsForScreen([w1, w2], SCREEN), [w1, w2]);
});
