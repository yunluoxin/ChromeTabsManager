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
  // function stretches the WHOLE bbox onto the work area, not "leave
  // alone because W1 happens to peek onto SCREEN". The old anyVisible
  // rule did the latter, which stranded W2 off-screen.
  //   scaleX = 1920/3620 ≈ 0.530, scaleY = 1080/2740 ≈ 0.394
  const w1 = { width: 720, height: 800, left: 100, top: 60 };
  const w2 = { width: 720, height: 800, left: 3000, top: 2000 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN);
  assert.deepEqual(out, [
    { width: 382, height: 315, left: 0, top: 0 },
    { width: 382, height: 315, left: 1538, top: 765 }
  ]);
});

test("adjustBoundsForScreen scales and translates to a secondary monitor on the RIGHT", () => {
  // Two side-by-side windows saved on the primary (bbox 1440×800).
  // Restoring on SCREEN_RIGHT — independent axes:
  //   scaleX = 1920/1440 ≈ 1.333, scaleY = 1080/800 = 1.35
  // Each window becomes 960×1080 and lands at left=1920 / left=2880 —
  // fills the new screen edge-to-edge on BOTH axes (uniform scale would
  // have left height at 1067 and a vertical gap).
  const w1 = { width: 720, height: 800, left: 0, top: 0 };
  const w2 = { width: 720, height: 800, left: 720, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 960, height: 1080, left: 1920, top: 0 },
    { width: 960, height: 1080, left: 2880, top: 0 }
  ]);
});

test("adjustBoundsForScreen scales and translates to a secondary monitor sitting to the LEFT", () => {
  // Mirror of the right-secondary test: saved on the primary at (0..1440),
  // restoring on SCREEN_LEFT (-1920..0). Same per-axis scales, translated
  // to the negative availLeft.
  const w1 = { width: 720, height: 800, left: 0, top: 0 };
  const w2 = { width: 720, height: 800, left: 720, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_LEFT);
  assert.deepEqual(out, [
    { width: 960, height: 1080, left: -1920, top: 0 },
    { width: 960, height: 1080, left: -960, top: 0 }
  ]);
});

test("adjustBoundsForScreen anchors the layout to the new screen's top-left, not the saved offset", () => {
  // Saved windows sat 100px below the primary's top. The bbox's top is
  // 100; after fitting, both windows land at top=0 on the new screen
  // (the bbox origin anchors to the screen's top-left). Preserving the
  // 100px-from-top offset on the new screen would only make sense if we
  // knew the new screen had a similar dead zone at the top — we can't tell.
  const w1 = { width: 720, height: 800, left: 0, top: 100 };
  const w2 = { width: 720, height: 800, left: 720, top: 100 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 960, height: 1080, left: 1920, top: 0 },
    { width: 960, height: 1080, left: 2880, top: 0 }
  ]);
});

test("adjustBoundsForScreen scales DOWN when the saved layout is wider than the new screen", () => {
  // Saved layout was two 960×900 windows side-by-side (bbox 1920×900).
  // Restoring on a 1280×720 screen:
  //   scaleX = 1280/1920 ≈ 0.667, scaleY = 720/900 = 0.8
  // Each window becomes 640×720 — fills both axes of the small screen.
  const small = { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 720 };
  const w1 = { width: 960, height: 900, left: 0, top: 0 };
  const w2 = { width: 960, height: 900, left: 960, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], small);
  assert.deepEqual(out, [
    { width: 640, height: 720, left: 0, top: 0 },
    { width: 640, height: 720, left: 640, top: 0 }
  ]);
});

test("adjustBoundsForScreen scales DOWN a single oversized window without stretching the other axis", () => {
  // Single 960×1200 window on a 1280×720 screen. Uniform scale capped at 1:
  //   scale = min(1, 1280/960, 720/1200) = 0.6 → 576×720.
  // Must NOT stretch width up to 1280 (that was the old multi-window
  // edge-to-edge path leaking into single-window restores).
  const small = { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 720 };
  const w1 = { width: 960, height: 1200, left: 0, top: 0 };
  const out = adjustBoundsForScreen([w1], small);
  assert.deepEqual(out, [
    { width: 576, height: 720, left: 0, top: 0 }
  ]);
});

test("adjustBoundsForScreen scales UP to fill a bigger screen", () => {
  // Saved full-height side-by-side on A, restoring on bigger B with the
  // same aspect ratio. scaleX = scaleY = 2560/1920 = 1440/1080 ≈ 1.333.
  // Each window grows from 960×1080 to 1280×1440 — fills B edge-to-edge.
  const big = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 };
  const w1 = { width: 960, height: 1080, left: 0, top: 0 };
  const w2 = { width: 960, height: 1080, left: 960, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], big);
  assert.deepEqual(out, [
    { width: 1280, height: 1440, left: 0, top: 0 },
    { width: 1280, height: 1440, left: 1280, top: 0 }
  ]);
});

test("adjustBoundsForScreen stretches height when saved side-by-side is slightly shorter than availHeight", () => {
  // The real user bug: left/right split that visually filled A, but
  // chrome.windows reported height a bit under availHeight (1052 vs
  // 1080). Uniform min(sx,sy) would fill width and leave a vertical
  // gap on B; independent axes stretch height to the full work area.
  const big = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 };
  const w1 = { width: 960, height: 1052, left: 0, top: 0 };
  const w2 = { width: 960, height: 1052, left: 960, top: 0 };
  const out = adjustBoundsForScreen([w1, w2], big);
  assert.deepEqual(out, [
    { width: 1280, height: 1440, left: 0, top: 0 },
    { width: 1280, height: 1440, left: 1280, top: 0 }
  ]);
});

test("adjustBoundsForScreen keeps single-window size when translating to another screen", () => {
  // Single-window snapshots (dashboard「保存本组」、popup「保存当前窗口」)
  // must NOT stretch to fill the target screen — that turns a half-screen
  // window into a full-screen one and looks like "maximized". Off-screen
  // single windows only translate; size and state stay put.
  const w1 = { width: 720, height: 800, left: 0, top: 0, state: "normal" };
  const out = adjustBoundsForScreen([w1], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { width: 720, height: 800, left: 1920, top: 0, state: "normal" }
  ]);
});

test("adjustBoundsForScreen does not stretch a single half-screen window on the same screen", () => {
  // Regression: saved left-half window on the same display must restore
  // at half width. The old edge-to-edge scale treated the half as the
  // full bbox and blew it up to availWidth (= looks maximized).
  const half = { width: 960, height: 1080, left: 0, top: 0, state: "normal" };
  assert.deepEqual(adjustBoundsForScreen([half], SCREEN), [half]);
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
  // scale for the normal windows sitting alongside. With only one normal
  // geometric entry, the single-window path applies: translate, don't stretch.
  const maxWithGeom = { state: "maximized", width: 1920, height: 1080, left: 0, top: 0 };
  const normal = { width: 720, height: 800, left: 0, top: 0 };
  const out = adjustBoundsForScreen([maxWithGeom, normal], SCREEN_RIGHT);
  assert.deepEqual(out, [
    { state: "maximized", width: 1920, height: 1080, left: 0, top: 0 },
    { width: 720, height: 800, left: 1920, top: 0 }
  ]);
});

test("adjustBoundsForScreen scales only the geometric subset when some entries are state-override", () => {
  // Mixed list — fullscreen passes through; the lone normal window only
  // translates (single-window path), keeping its saved size.
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

test("adjustBoundsForScreen is a no-op only when the saved bbox exactly matches the new screen", () => {
  // The only true no-op: the saved bbox already has the same origin AND
  // size as the new screen's work area. This is the "restoring on the
  // same screen with a perfectly matching layout" fast path. Anything off
  // (offset, different size) triggers at least a translate or scale.
  const w1 = { width: 960, height: 1080, left: 0, top: 0 };
  const w2 = { width: 960, height: 1080, left: 960, top: 0 };
  // bbox = (0, 0, 1920, 1080) matches SCREEN exactly.
  assert.deepEqual(adjustBoundsForScreen([w1, w2], SCREEN), [w1, w2]);
});

test("adjustBoundsForScreen scales up to fill when saved bbox is contained but smaller than the new screen", () => {
  // Saved bbox is contained inside SCREEN but offset and smaller.
  // Independent axes stretch it to fill the full work area:
  //   scaleX = 1920/1440 ≈ 1.333, scaleY = 1080/800 = 1.35
  // → 960×1080 each, starting at (0, 0).
  const w1 = { width: 720, height: 800, left: 100, top: 60 };
  const w2 = { width: 720, height: 800, left: 820, top: 60 };
  const out = adjustBoundsForScreen([w1, w2], SCREEN);
  assert.deepEqual(out, [
    { width: 960, height: 1080, left: 0, top: 0 },
    { width: 960, height: 1080, left: 960, top: 0 }
  ]);
});
