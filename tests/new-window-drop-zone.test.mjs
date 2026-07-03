import test from "node:test";
import assert from "node:assert/strict";
import {
  computeZonePosition,
  isZoneActive
} from "../src/new-window-drop-zone.js";

test("computeZonePosition: cursor far from dock returns dock position", () => {
  const result = computeZonePosition({ x: 1000, y: 500 }, { x: 100, y: 100 });
  assert.equal(result.x, 1000);
  assert.equal(result.y, 500);
  assert.equal(result.isDocked, true);
});

test("computeZonePosition: cursor exactly at dock stays at dock", () => {
  const result = computeZonePosition({ x: 1000, y: 500 }, { x: 1000, y: 500 });
  assert.equal(result.x, 1000);
  assert.equal(result.y, 500);
  assert.equal(result.isDocked, false);
});

test("computeZonePosition: cursor at half-magnet range reaches max offset", () => {
  const result = computeZonePosition({ x: 1000, y: 500 }, { x: 900, y: 500 });
  assert.equal(result.x, 880);
  assert.equal(result.y, 500);
  assert.equal(result.isDocked, false);
});

test("computeZonePosition: custom magnet radius honored", () => {
  const result = computeZonePosition(
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { magnetRadius: 100, magnetMaxOffset: 100 }
  );
  // dist=50, norm=0.5, sin(pi/2)=1, factor=100, angle=atan2(0,50)=0, cos=1 -> slides +x
  assert.equal(result.x, 100);
  assert.equal(result.y, 0);
});

test("computeZonePosition: cursor beyond magnet radius snaps to dock", () => {
  const result = computeZonePosition(
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { magnetRadius: 200 }
  );
  assert.equal(result.isDocked, true);
});

test("isZoneActive: true when cursor inside threshold", () => {
  const dock = { x: 100, y: 100 };
  assert.equal(isZoneActive(dock, { x: 100, y: 100 }), true);
  assert.equal(isZoneActive(dock, { x: 130, y: 100 }), true);
});

test("isZoneActive: false when cursor outside threshold", () => {
  const dock = { x: 100, y: 100 };
  assert.equal(isZoneActive(dock, { x: 200, y: 100 }), false);
  assert.equal(isZoneActive(dock, { x: 100, y: 137 }), false);
});

test("isZoneActive: custom threshold honored", () => {
  const dock = { x: 0, y: 0 };
  assert.equal(isZoneActive(dock, { x: 5, y: 0 }, { activeThreshold: 3 }), false);
  assert.equal(isZoneActive(dock, { x: 2, y: 0 }, { activeThreshold: 3 }), true);
});
