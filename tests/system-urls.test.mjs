import { test } from "node:test";
import assert from "node:assert/strict";
import { isSystemUrl } from "../src/system-urls.js";

test("isSystemUrl flags Chromium internal schemes", () => {
  assert.equal(isSystemUrl("chrome://extensions"), true);
  assert.equal(isSystemUrl("chrome-extension://abcdef/popup.html"), true);
  assert.equal(isSystemUrl("edge://settings"), true);
});

test("isSystemUrl flags Firefox internal schemes", () => {
  assert.equal(isSystemUrl("about:config"), true);
  assert.equal(isSystemUrl("about:blank"), true);
  assert.equal(isSystemUrl("moz-extension://abcdef/popup.html"), true);
});

test("isSystemUrl flags Safari extension scheme", () => {
  assert.equal(isSystemUrl("safari-web-extension://abcdef/popup.html"), true);
});

test("isSystemUrl passes normal web URLs", () => {
  assert.equal(isSystemUrl("https://example.com"), false);
  assert.equal(isSystemUrl("http://localhost:3000/about:foo"), false);
  assert.equal(isSystemUrl("file:///Users/east/notes.txt"), false);
});

test("isSystemUrl handles empty and non-string input", () => {
  assert.equal(isSystemUrl(""), false);
  assert.equal(isSystemUrl(null), false);
  assert.equal(isSystemUrl(undefined), false);
});
