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

test("adjustBoundsForScreen scales the layout when the bbox overflows, even if one window is on-screen", () => {
  // W1 sits on SCREEN, but W2 is far off in global coords. The saved
  // layout's bbox (3620×2740) overflows SCREEN in both axes — so the
  // function scales the WHOLE bbox down to fit, not "leave alone because
  // W1 happens to peek onto SCREEN". The old anyVisible-based rule did
  // the latter, which meant W2 stayed stranded off-screen and defeated the
  // whole point of cross-screen restore.
  //   scale = min(1, 1920/3620, 1080/2740) = min(1, 0.530, 0.394) ≈ 0.394
  const w1 = { width: 720, height: 800, left: 100, top: 60 };
  const w2 = { width: 720, height: 800, left: 3000, top: 2000 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN);
  assert.deepEqual(out, [
    { width: 284, height: 315, left: 0, top: 0 },
    { width: 284, height: 315, left: 1143, top: 765 }
  ]);
});

test("adjustBoundsForScreen translates to a secondary monitor on the RIGHT when fully off-screen", () => {
  // Two side-by-side windows saved on the primary monitor (bbox 1440×800).
  // Restoring from SCREEN_RIGHT (availLeft=1920) — the bbox fits inside
  // SCREEN_RIGHT (1440 < 1920 width-wise, 800 < 1080 height-wise) but is
  // offset (bboxLeft=0 vs screenLeft=1920), so case 4 applies: no scaling,
  // translate the bbox so its top-left lands at SCREEN_RIGHT's work-area
  // origin. The side-by-side arrangement is preserved.
  const w1 = { width: 720, height: 800, left: 0, top: 0 };
  const w2 = { width: 720, height: 800, left: 720, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: 1920, top: 0 },
    { width: 720, height: 800, left: 2640, top: 0 }
  ]);
});

test("adjustBoundsForScreen translates to a secondary monitor sitting to the LEFT", () => {
  // Mirror of the right-secondary test: saved on the primary at (0..1440),
  // restoring on SCREEN_LEFT (-1920..0). Translate by -1920 to put the
  // bbox at SCREEN_LEFT's origin. No scaling because the bbox fits.
  const w1 = { width: 720, height: 800, left: 0, top: 0 };
  const w2 = { width: 720, height: 800, left: 720, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_LEFT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: -1920, top: 0 },
    { width: 720, height: 800, left: -1200, top: 0 }
  ]);
});

test("adjustBoundsForScreen anchors the layout to the new screen's top-left, not the saved offset", () => {
  // Saved windows sat 100px below the primary's top. The bbox's top is
  // 100; after translating to the new screen's origin, both windows land
  // at top=0. Preserving the 100px-from-top offset on the new screen would
  // only make sense if we knew the new screen had a similar dead zone at
  // the top — we can't tell.
  const w1 = { width: 720, height: 800, left: 0, top: 100 };
  const w2 = { width: 720, height: 800, left: 720, top: 100 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: 1920, top: 0 },
    { width: 720, height: 800, left: 2640, top: 0 }
  ]);
});

test("adjustBoundsForScreen scales DOWN when the saved layout is wider than the new screen", () => {
  // Saved layout was two 960×900 windows side-by-side on a 1920×1080
  // monitor. Restoring on a 1280×720 screen — bbox width 1920 > screen
  // width 1280, so case 3 applies. Uniform scale capped at 1:
  //   scale = min(1, 1280/1920, 720/900) = min(1, 0.667, 0.8) = 0.667
  // Each window drops to 640×600; the side-by-side arrangement still
  // fills the 1280 width exactly.
  const small = { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 720 };
  const w1 = { width: 960, height: 900, left: 0, top: 0 };
  const w2 = { width: 960, height: 900, left: 960, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], small);
  assert.deepEqual(out, [
    { width: 640, height: 600, left: 0, top: 0 },
    { width: 640, height: 600, left: 640, top: 0 }
  ]);
});

test("adjustBoundsForScreen scales DOWN to fit when the bbox overflows only the height axis", () => {
  // Saved 1200-tall layout on a 1920×1080 screen; restoring on a 1280×720
  // screen where only the height overflows. Uniform scale is still capped
  // at 1 per dimension, so the width-only axis would have scale 1.067 but
  // height-axis needs 0.6; the smaller wins (0.6). Each window shrinks to
  // 576×450.
  const small = { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 720 };
  const w1 = { width: 960, height: 1200, left: 0, top: 0 };
  const out = adjustBoundsForScreen([w1], small);
  assert.deepEqual(out, [
    { width: 576, height: 720, left: 0, top: 0 }
  ]);
});

test("adjustBoundsForScreen does NOT scale up when the saved layout fits comfortably in a bigger screen", () => {
  // Saved layout was two tiny 400×400 windows side-by-side on an 800×600
  // screen. Restoring on a 1920×1080 screen — the bbox (800×400) is
  // contained, case 2: leave alone. The user gets their original window
  // sizes back; if they want bigger, they resize manually. Scaling up
  // would be a UX surprise (windows bigger than they set).
  const big = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const w1 = { width: 400, height: 400, left: 0, top: 0 };
  const w2 = { width: 400, height: 400, left: 400, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], big);
  assert.deepEqual(out, [w1, w2]);
});

test("adjustBoundsForScreen preserves state and size fields when translating", () => {
  // "normal" state stays attached after translation —
  // applyBoundsToCreateData uses state="normal" to force Chrome into a
  // normal window (otherwise it can pick whatever default the OS suggests).
  const w1 = { width: 720, height: 800, left: 0, top: 0, state: "normal" };
  const out = adjustBoundsForScreen([w1], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: 1920, top: 0, state: "normal" }
  ]);
});

test("adjustBoundsForScreen passes maximized / fullscreen / minimized bounds through unchanged", () => {
  // The user's expectation: a saved "maximized" window stays maximized on
  // the new screen (Chrome honors state="maximized" verbatim). These
  // entries skip the bbox math entirely; applyBoundsToCreateData will only
  // forward `state`.
  const max = { state: "maximized" };
  const full = { state: "fullscreen" };
  const min = { state: "minimized" };
  const stub = { width: 0, height: 0 };
  const list = [max, full, min, stub];
  assert.deepEqual(adjustBoundsForScreen(list, SCREEN_RIGHT), list);
});

test("adjustBoundsForScreen leaves state-override windows alone even when they have geometry", () => {
  // Chrome still reports width/height/left/top for a maximized window — but
  // those are pixel values from the original screen. Including them in the
  // bbox would inflate the bbox to the full original screen and distort the
  // scale for the normal windows sitting alongside.
  const maxWithGeom = { state: "maximized", width: 1920, height: 1080, left: 0, top: 0 };
  const normal = { width: 720, height: 800, left: 0, top: 0 };
  const out = adjustBoundsForScreen([maxWithGeom, normal], SCREEN_RIGHT);
  // The maximized entry passes through untouched; the normal entry is
  // translated (bbox is just its own 720×800 rect, fits inside SCREEN_RIGHT).
  assert.deepEqual(out, [
    { state: "maximized", width: 1920, height: 1080, left: 0, top: 0 },
    { width: 720, height: 800, left: 1920, top: 0 }
  ]);
});

test("adjustBoundsForScreen translates only the geometric subset when some entries are state-override", () => {
  // Mixed list — the fullscreen window passes through untouched; the normal
  // window next to it is off-screen and gets translated.
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
  // are inside SCREEN, so the function shouldn't move anything (case 2).
  const w1 = { width: 720, height: 800, left: 100, top: 60 };
  const w2 = { width: 720, height: 800, left: 820, top: 60 };
  assert.deepEqual(adjustBoundsForScreen([w1, w2], SCREEN), [w1, w2]);
});
