import test from "node:test";
import assert from "node:assert/strict";
import { formatActionSummary } from "../src/action-summary.js";

test("formats successful action summary", () => {
  assert.equal(formatActionSummary({ succeeded: 3, skipped: 0, failed: 0, errors: [] }), "完成 3");
});

test("includes skipped and failed counts when present", () => {
  assert.equal(
    formatActionSummary({ succeeded: 2, skipped: 1, failed: 1, errors: ["#4: Active tab skipped"] }),
    "完成 2，跳过 1，失败 1，#4: Active tab skipped"
  );
});

